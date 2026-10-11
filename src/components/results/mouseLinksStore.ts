/**
 * The page's client-side store of per-mouse links (2026-10-11): one
 * `GET /api/mice/<slug>/links` per mouse, ever. A static file on the CDN, so a
 * request costs no function run, but the page still asks for it only once:
 * - a finished answer is kept for the life of the page (`cache`), including
 *   "none" (`null`) for a 404, a network error or a body that fails
 *   `mouseLinksSchema`, so a broken answer is never asked for again in a loop;
 * - two callers asking for the same slug at the same time share one request;
 * - each caller gets a `release()`; when the last caller of an unfinished
 *   request lets go (the component went away), the request is aborted and
 *   nothing is cached, so a later visit asks again.
 * Never throws. `fetchImpl` is for tests.
 */
import { mouseLinksSchema, type MouseLinks } from "@/lib/contracts/commerce";
import { mouseLinksPath } from "@/lib/results/mouseLinks";

type FetchImpl = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

interface Pending {
  promise: Promise<MouseLinks | null>;
  controller: AbortController;
  refs: number;
}

const cache = new Map<string, MouseLinks | null>();
const pending = new Map<string, Pending>();

/** What is known without asking: the links, `null` for "none", `undefined` for "not asked yet". */
export function peekMouseLinks(slug: string): MouseLinks | null | undefined {
  return cache.get(slug);
}

/** Put an answer in the store (tests, and server-side rendering of a known page). */
export function primeMouseLinks(slug: string, links: MouseLinks | null): void {
  cache.set(slug, links);
}

/** Forget everything (tests). */
export function resetMouseLinks(): void {
  for (const p of pending.values()) p.controller.abort();
  pending.clear();
  cache.clear();
}

async function load(
  slug: string,
  signal: AbortSignal,
  fetchImpl: FetchImpl,
): Promise<MouseLinks | null> {
  try {
    const res = await fetchImpl(mouseLinksPath(slug), {
      signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const parsed = mouseLinksSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface MouseLinksRequest {
  /** Resolves to the links, or `null` for none (never rejects). */
  promise: Promise<MouseLinks | null>;
  /** Let go of the request; the last one to let go aborts it. Safe to call twice. */
  release: () => void;
}

export function requestMouseLinks(
  slug: string,
  fetchImpl: FetchImpl = (input, init) => fetch(input, init),
): MouseLinksRequest {
  if (cache.has(slug)) {
    return { promise: Promise.resolve(cache.get(slug) ?? null), release() {} };
  }
  let entry = pending.get(slug);
  if (!entry) {
    const controller = new AbortController();
    const created: Pending = {
      controller,
      refs: 0,
      promise: load(slug, controller.signal, fetchImpl).then((links) => {
        if (pending.get(slug) === created) pending.delete(slug);
        // An aborted request says nothing about the mouse: do not remember it.
        if (!controller.signal.aborted) cache.set(slug, links);
        return links;
      }),
    };
    pending.set(slug, created);
    entry = created;
  }
  entry.refs += 1;
  const mine = entry;
  let released = false;
  return {
    promise: mine.promise,
    release() {
      if (released) return;
      released = true;
      mine.refs -= 1;
      if (mine.refs === 0 && pending.get(slug) === mine) {
        pending.delete(slug);
        mine.controller.abort();
      }
    },
  };
}
