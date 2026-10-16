/**
 * The page's client-side store of per-mouse links (2026-10-11): one
 * `GET /api/mice/<slug>/links` per mouse while the page lives. The answer is
 * cached by the CDN for a day, so a request rarely runs the function, but the
 * page still asks for it only once:
 * - a finished answer is kept for the life of the page (`cache`). Only an
 *   answer about the mouse is kept, `null` ("none") included: a 404, or a body
 *   that fails `mouseLinksSchema`. A network error or a 5xx says nothing about
 *   the mouse, so it is not kept: the caller gets `null` for now and the next
 *   visit asks again. One caller never retries on its own, so a failing server
 *   is not hit in a loop;
 * - two callers asking for the same slug at the same time share one request;
 * - each caller gets a `release()`; when the last caller of an unfinished
 *   request lets go (the component went away), the request is aborted, its
 *   answer is thrown away even if the network ignores the abort, and nothing is
 *   cached, so a later visit asks again.
 * Never throws. `fetchImpl` is for tests.
 */
import { mouseLinksSchema, type MouseLinks } from "@/lib/contracts/commerce";
import { mouseLinksPath } from "@/lib/results/mouseLinks";

type FetchImpl = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

interface Loaded {
  links: MouseLinks | null;
  /** True when the answer is about the mouse (found, 404, or an invalid body). */
  keep: boolean;
}

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

/**
 * Put an answer in the store. No page code calls this: it is for tests, which
 * use it to render a page with links already known (the server render never
 * asks the network).
 */
export function primeMouseLinks(slug: string, links: MouseLinks | null): void {
  cache.set(slug, links);
}

/** Forget everything and abort what is in flight (tests). */
export function resetMouseLinks(): void {
  for (const p of pending.values()) p.controller.abort();
  pending.clear();
  cache.clear();
}

async function load(
  slug: string,
  signal: AbortSignal,
  fetchImpl: FetchImpl,
): Promise<Loaded> {
  try {
    const res = await fetchImpl(mouseLinksPath(slug), {
      signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { links: null, keep: res.status === 404 };
    const parsed = mouseLinksSchema.safeParse(await res.json());
    return parsed.success
      ? { links: parsed.data, keep: true }
      : { links: null, keep: true };
  } catch {
    // Network error, or a 200 whose body is not JSON: nothing is known.
    return { links: null, keep: false };
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
      promise: load(slug, controller.signal, fetchImpl).then(
        ({ links, keep }) => {
          // An aborted request says nothing about the mouse, even if the
          // network ignored the abort and answered: drop the answer, and never
          // touch what a newer request for the same slug has put in the maps.
          if (controller.signal.aborted) return null;
          if (pending.get(slug) === created) pending.delete(slug);
          if (keep) cache.set(slug, links);
          return links;
        },
      ),
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

/**
 * Start asking for a mouse's links now and keep the request even though nobody
 * is looking yet: used before the page that needs them has rendered, so the
 * answer is usually in the cache by the first paint. Nothing waits on it.
 */
export function prefetchMouseLinks(slug: string, fetchImpl?: FetchImpl): void {
  void requestMouseLinks(slug, fetchImpl).promise;
}

/**
 * What `useMouseLinks` does in its effect, apart from React so it can be
 * tested: calls `onValue` once with the links (or `null` for none) as soon as
 * they are known, at once when they already are. The returned function is the
 * effect's cleanup: it stops `onValue` for good and lets go of the request.
 */
export function subscribeMouseLinks(
  slug: string,
  onValue: (links: MouseLinks | null) => void,
  fetchImpl?: FetchImpl,
): () => void {
  let live = true;
  const known = peekMouseLinks(slug);
  if (known !== undefined) {
    onValue(known);
    return () => {
      live = false;
    };
  }
  const request = requestMouseLinks(slug, fetchImpl);
  void request.promise.then((links) => {
    if (live) onValue(links);
  });
  return () => {
    live = false;
    request.release();
  };
}
