/**
 * `useMouseLinks`' wiring, run without a DOM: the repo has no jsdom or
 * testing-library, so `react` is replaced here by a tiny hook runtime (state
 * slots, effects with dependency lists and cleanups, re-render on a state
 * change) that is just enough for this one hook. The logic itself is tested in
 * mouse-links-store.test.ts (`subscribeMouseLinks`); this file pins that the
 * hook hands the right slug and dependencies to the effect, runs its cleanup,
 * and never shows one mouse's links for another.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Effect {
  fn: () => void | (() => void);
  deps: readonly unknown[] | undefined;
  cleanup?: void | (() => void);
}
const rt = vi.hoisted(() => ({
  slots: [] as unknown[],
  effects: [] as unknown[],
  index: 0,
  effectIndex: 0,
  dirty: false,
  pending: [] as {
    i: number;
    fn: () => void | (() => void);
    deps?: readonly unknown[];
  }[],
}));

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const i = rt.index++;
    if (!(i in rt.slots)) rt.slots[i] = initial;
    const set = (value: unknown) => {
      rt.slots[i] = value;
      rt.dirty = true;
    };
    return [rt.slots[i], set];
  },
  useEffect: (fn: Effect["fn"], deps?: readonly unknown[]) => {
    const i = rt.effectIndex++;
    const previous = rt.effects[i] as Effect | undefined;
    const changed =
      !previous ||
      deps === undefined ||
      previous.deps === undefined ||
      deps.length !== previous.deps.length ||
      deps.some((d, k) => !Object.is(d, previous.deps![k]));
    if (!changed) return;
    // Like React: the old cleanup runs, then the new effect, after the render.
    rt.pending.push({ i, fn, deps });
  },
}));

import {
  primeMouseLinks,
  resetMouseLinks,
} from "../../src/components/results/mouseLinksStore";
import { useMouseLinks } from "../../src/components/results/useMouseLinks";
import type { MouseLinks } from "../../src/lib/contracts/commerce";

// The hook is called outside a component here, on purpose: `react` is replaced
// by the runtime above. The alias keeps the rules-of-hooks lint from objecting.
const callHook: (slug: string | null | undefined) => MouseLinks | null =
  useMouseLinks;

const A: MouseLinks = {
  officialUrl: "https://maker.example/a",
  officialKind: "product",
  purchaseLinks: [],
};
const B: MouseLinks = { ...A, officialUrl: "https://maker.example/b" };

type Res = { ok: boolean; status?: number; json: () => Promise<unknown> };
const ok = (body: unknown): Res => ({
  ok: true,
  status: 200,
  json: async () => body,
});

/** Render the hook with `slug`, then flush its effects and any state they set. */
function render(slug: string | null | undefined): MouseLinks | null {
  let result: MouseLinks | null = null;
  for (let pass = 0; pass < 5; pass++) {
    rt.index = 0;
    rt.effectIndex = 0;
    rt.dirty = false;
    result = callHook(slug);
    flushEffects();
    if (!rt.dirty) break;
  }
  return result;
}

function flushEffects() {
  const batch = rt.pending.splice(0);
  for (const { i, fn, deps } of batch) {
    const previous = rt.effects[i] as Effect | undefined;
    if (typeof previous?.cleanup === "function") previous.cleanup();
    rt.effects[i] = { fn, deps, cleanup: fn() } satisfies Effect;
  }
}

/** The component goes away: every effect's cleanup runs. */
function unmount() {
  for (const e of rt.effects as Effect[]) {
    if (typeof e.cleanup === "function") e.cleanup();
  }
  rt.effects = [];
  rt.slots = [];
}

let requests: { url: string; signal?: AbortSignal; finish: (r: Res) => void }[];

beforeEach(() => {
  rt.slots = [];
  rt.effects = [];
  rt.pending.length = 0;
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Res>((resolve) => {
          requests.push({ url, signal: init?.signal, finish: resolve });
        }),
    ),
  );
});

afterEach(() => {
  unmount();
  resetMouseLinks();
  vi.unstubAllGlobals();
});

describe("useMouseLinks wiring", () => {
  it("is null at first, asks for the slug once, and shows the links when they arrive", async () => {
    expect(render("a")).toBeNull();
    expect(requests.map((r) => r.url)).toEqual(["/api/mice/a/links"]);
    requests[0]!.finish(ok(A));
    await vi.waitFor(() => expect(render("a")).toEqual(A));
    expect(requests).toHaveLength(1); // re-rendering does not ask again
  });

  it("asks nothing for no slug", () => {
    expect(render(null)).toBeNull();
    expect(render(undefined)).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("an unmount aborts the request that is still in flight", () => {
    render("a");
    expect(requests[0]!.signal?.aborted).toBe(false);
    unmount();
    expect(requests[0]!.signal?.aborted).toBe(true);
  });

  it("a slug change cancels the old request, asks for the new one, and never shows the old mouse's links for the new one", async () => {
    render("a");
    expect(render("b")).toBeNull(); // not A's links, not stale
    expect(requests.map((r) => r.url)).toEqual([
      "/api/mice/a/links",
      "/api/mice/b/links",
    ]);
    expect(requests[0]!.signal?.aborted).toBe(true);
    expect(requests[1]!.signal?.aborted).toBe(false);
    requests[0]!.finish(ok(A)); // the old answer, late
    requests[1]!.finish(ok(B));
    await vi.waitFor(() => expect(render("b")).toEqual(B));
    expect(render("b")?.officialUrl).toBe("https://maker.example/b");
  });

  it("does not re-run its effect on a re-render with the same slug", () => {
    render("a");
    render("a");
    render("a");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.signal?.aborted).toBe(false);
  });

  it("a mouse already known answers on the first render, and the early return still ends well", () => {
    primeMouseLinks("a", A);
    expect(render("a")).toEqual(A);
    expect(requests).toHaveLength(0);
    // The effect ran its early-return path and notified: state holds the answer too.
    expect(rt.slots[0]).toEqual({ slug: "a", links: A });
  });

  it("a mouse whose answer becomes known between the render and the effect is not left on null", () => {
    // Render with nothing known, then the answer lands before the effect runs.
    rt.index = 0;
    rt.effectIndex = 0;
    expect(callHook("a")).toBeNull();
    primeMouseLinks("a", A);
    flushEffects();
    rt.index = 0;
    rt.effectIndex = 0;
    expect(callHook("a")).toEqual(A);
  });
});
