import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  peekMouseLinks,
  prefetchMouseLinks,
  primeMouseLinks,
  requestMouseLinks,
  resetMouseLinks,
  subscribeMouseLinks,
} from "../../src/components/results/mouseLinksStore";
import { useMouseLinks } from "../../src/components/results/useMouseLinks";
import type { MouseLinks } from "../../src/lib/contracts/commerce";

const LINKS: MouseLinks = {
  officialUrl: "https://maker.example/a",
  officialKind: "product",
  purchaseLinks: [{ label: "Shop A", url: "https://shop.example/a" }],
};
const OTHER: MouseLinks = { ...LINKS, officialUrl: "https://maker.example/b" };

type Init = { signal?: AbortSignal };
type Res = { ok: boolean; status?: number; json: () => Promise<unknown> };
const ok = (body: unknown): Res => ({
  ok: true,
  status: 200,
  json: async () => body,
});

/** A fetch whose answer the test releases by hand; it ignores the abort signal when `ignoreAbort`. */
function controlledFetch({ ignoreAbort = false } = {}) {
  const calls: {
    url: string;
    signal?: AbortSignal;
    finish: (r: Res) => void;
  }[] = [];
  const fetchImpl = vi.fn((url: string, init?: Init) => {
    return new Promise<Res>((resolve, reject) => {
      calls.push({ url, signal: init?.signal, finish: resolve });
      if (!ignoreAbort) {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }
    });
  });
  return { fetchImpl, calls };
}

afterEach(() => {
  resetMouseLinks();
  vi.restoreAllMocks();
});

describe("requestMouseLinks", () => {
  it("asks /api/mice/<slug>/links and returns the links", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return ok(LINKS);
    });
    const req = requestMouseLinks("a", fetchImpl);
    await expect(req.promise).resolves.toEqual(LINKS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(urls).toEqual(["/api/mice/a/links"]);
  });

  it("keeps the answer: a second ask for the same slug sends no request", async () => {
    const fetchImpl = vi.fn(async () => ok(LINKS));
    await requestMouseLinks("a", fetchImpl).promise;
    await expect(requestMouseLinks("a", fetchImpl).promise).resolves.toEqual(
      LINKS,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(peekMouseLinks("a")).toEqual(LINKS);
  });

  it("shares one request between callers asking at the same time", async () => {
    const fetchImpl = vi.fn(async () => ok(LINKS));
    const first = requestMouseLinks("a", fetchImpl);
    const second = requestMouseLinks("a", fetchImpl);
    const [x, y] = await Promise.all([first.promise, second.promise]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(x).toEqual(LINKS);
    expect(y).toEqual(LINKS);
  });

  it("asks separately for different mice", async () => {
    const fetchImpl = vi.fn(async () => ok(LINKS));
    await requestMouseLinks("a", fetchImpl).promise;
    await requestMouseLinks("b", fetchImpl).promise;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  describe("an answer about the mouse is kept, even when it is 'none'", () => {
    it.each([
      [
        "a body that is not the contract",
        ok({ officialUrl: "http://insecure" }),
      ],
      ["a body with an unknown field", ok({ ...LINKS, extra: 1 })],
      ["a 404", { ok: false, status: 404, json: async () => ({}) }],
    ])("%s: null, and it is not asked again", async (_name, res) => {
      const fetchImpl = vi.fn(async () => res);
      await expect(
        requestMouseLinks("a", fetchImpl).promise,
      ).resolves.toBeNull();
      await requestMouseLinks("a", fetchImpl).promise;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(peekMouseLinks("a")).toBeNull();
    });
  });

  describe("a failure that says nothing about the mouse is not kept", () => {
    it.each([
      ["a 500", { ok: false, status: 500, json: async () => ({}) }],
      ["a 503", { ok: false, status: 503, json: async () => ({}) }],
      ["a 429", { ok: false, status: 429, json: async () => ({}) }],
    ])("%s: null now, asked again next time", async (_name, res) => {
      const failing = vi.fn(async () => res);
      await expect(requestMouseLinks("a", failing).promise).resolves.toBeNull();
      expect(peekMouseLinks("a")).toBeUndefined();
      const working = vi.fn(async () => ok(LINKS));
      await expect(requestMouseLinks("a", working).promise).resolves.toEqual(
        LINKS,
      );
      expect(working).toHaveBeenCalledTimes(1);
    });

    it("a network error: null now, asked again next time", async () => {
      const down = vi.fn(async () => {
        throw new TypeError("network");
      });
      await expect(requestMouseLinks("a", down).promise).resolves.toBeNull();
      expect(peekMouseLinks("a")).toBeUndefined();
      const working = vi.fn(async () => ok(LINKS));
      await expect(requestMouseLinks("a", working).promise).resolves.toEqual(
        LINKS,
      );
    });

    it("a 200 whose body is not JSON: null now, asked again next time", async () => {
      const garbled = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      }));
      await expect(requestMouseLinks("a", garbled).promise).resolves.toBeNull();
      expect(peekMouseLinks("a")).toBeUndefined();
    });

    it("never retries on its own: one caller, one request, however it fails", async () => {
      const down = vi.fn(async () => {
        throw new TypeError("network");
      });
      await requestMouseLinks("a", down).promise;
      await new Promise((r) => setTimeout(r, 10));
      expect(down).toHaveBeenCalledTimes(1);
    });
  });

  describe("letting go", () => {
    it("aborts the request when the only caller lets go, and remembers nothing", async () => {
      const { fetchImpl, calls } = controlledFetch();
      const req = requestMouseLinks("a", fetchImpl);
      expect(calls[0]!.signal?.aborted).toBe(false);
      req.release();
      expect(calls[0]!.signal?.aborted).toBe(true);
      await expect(req.promise).resolves.toBeNull();
      expect(peekMouseLinks("a")).toBeUndefined();
    });

    it("keeps the request going while another caller still wants it", async () => {
      const { fetchImpl, calls } = controlledFetch();
      const first = requestMouseLinks("a", fetchImpl);
      const second = requestMouseLinks("a", fetchImpl);
      first.release();
      first.release(); // twice is harmless
      expect(calls[0]!.signal?.aborted).toBe(false);
      calls[0]!.finish(ok(LINKS));
      await expect(second.promise).resolves.toEqual(LINKS);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("drops the answer of an aborted request even when the network ignores the abort", async () => {
      const { fetchImpl, calls } = controlledFetch({ ignoreAbort: true });
      const req = requestMouseLinks("a", fetchImpl);
      req.release();
      expect(calls[0]!.signal?.aborted).toBe(true);
      calls[0]!.finish(ok(LINKS)); // arrives late, after the abort
      await expect(req.promise).resolves.toBeNull();
      expect(peekMouseLinks("a")).toBeUndefined(); // not written to the cache
    });

    it("asks again after an abort, and a late answer of the old request never overwrites the new one", async () => {
      const { fetchImpl, calls } = controlledFetch({ ignoreAbort: true });
      const old = requestMouseLinks("a", fetchImpl);
      old.release(); // aborted
      const fresh = requestMouseLinks("a", fetchImpl);
      expect(fetchImpl).toHaveBeenCalledTimes(2); // a new request, not the dead one
      expect(calls[1]!.signal?.aborted).toBe(false);
      calls[1]!.finish(ok(LINKS));
      await expect(fresh.promise).resolves.toEqual(LINKS);
      calls[0]!.finish(ok(OTHER)); // the old one, late
      await expect(old.promise).resolves.toBeNull();
      expect(peekMouseLinks("a")).toEqual(LINKS);
    });

    it("resetMouseLinks aborts what is in flight and forgets it", async () => {
      const { fetchImpl, calls } = controlledFetch({ ignoreAbort: true });
      const req = requestMouseLinks("a", fetchImpl);
      resetMouseLinks();
      expect(calls[0]!.signal?.aborted).toBe(true);
      calls[0]!.finish(ok(LINKS));
      await expect(req.promise).resolves.toBeNull();
      expect(peekMouseLinks("a")).toBeUndefined();
    });
  });
});

describe("prefetchMouseLinks", () => {
  it("starts the request with no caller and keeps the answer", async () => {
    const { fetchImpl, calls } = controlledFetch();
    prefetchMouseLinks("a", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0]!.signal?.aborted).toBe(false);
    calls[0]!.finish(ok(LINKS));
    await vi.waitFor(() => expect(peekMouseLinks("a")).toEqual(LINKS));
    // The page that renders next finds it already there.
    const never = vi.fn();
    await expect(requestMouseLinks("a", never).promise).resolves.toEqual(LINKS);
    expect(never).not.toHaveBeenCalled();
  });

  it("a caller that arrives while it is in flight shares it, and letting go does not cancel the prefetch", async () => {
    const { fetchImpl, calls } = controlledFetch();
    prefetchMouseLinks("a", fetchImpl);
    const caller = requestMouseLinks("a", fetchImpl);
    caller.release();
    expect(calls[0]!.signal?.aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeMouseLinks (what the hook's effect does)", () => {
  it("calls back with the links when they arrive", async () => {
    const fetchImpl = vi.fn(async () => ok(LINKS));
    const seen: (MouseLinks | null)[] = [];
    subscribeMouseLinks("a", (l) => seen.push(l), fetchImpl);
    await vi.waitFor(() => expect(seen).toEqual([LINKS]));
  });

  it("calls back at once when the answer is already known, and sends no request", () => {
    primeMouseLinks("a", LINKS);
    const fetchImpl = vi.fn();
    const seen: (MouseLinks | null)[] = [];
    subscribeMouseLinks("a", (l) => seen.push(l), fetchImpl);
    expect(seen).toEqual([LINKS]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls back with null when the known answer is 'none'", () => {
    primeMouseLinks("a", null);
    const seen: (MouseLinks | null)[] = [];
    subscribeMouseLinks("a", (l) => seen.push(l));
    expect(seen).toEqual([null]);
  });

  it("the cleanup stops the callback for good and releases the request", async () => {
    const { fetchImpl, calls } = controlledFetch({ ignoreAbort: true });
    const seen: (MouseLinks | null)[] = [];
    const stop = subscribeMouseLinks("a", (l) => seen.push(l), fetchImpl);
    stop();
    expect(calls[0]!.signal?.aborted).toBe(true); // released: the only caller
    calls[0]!.finish(ok(LINKS));
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([]); // the unmounted component is never told
  });

  it("the cleanup of one subscriber leaves another one's request alone", async () => {
    const { fetchImpl, calls } = controlledFetch();
    const first: (MouseLinks | null)[] = [];
    const second: (MouseLinks | null)[] = [];
    const stopFirst = subscribeMouseLinks("a", (l) => first.push(l), fetchImpl);
    subscribeMouseLinks("a", (l) => second.push(l), fetchImpl);
    stopFirst();
    expect(calls[0]!.signal?.aborted).toBe(false);
    calls[0]!.finish(ok(LINKS));
    await vi.waitFor(() => expect(second).toEqual([LINKS]));
    expect(first).toEqual([]);
  });

  it("after a switch to another slug, the first slug's late answer never arrives", async () => {
    const { fetchImpl, calls } = controlledFetch({ ignoreAbort: true });
    const seen: [string, MouseLinks | null][] = [];
    const stopA = subscribeMouseLinks(
      "a",
      (l) => seen.push(["a", l]),
      fetchImpl,
    );
    stopA(); // the effect's cleanup, as the slug changes
    subscribeMouseLinks("b", (l) => seen.push(["b", l]), fetchImpl);
    calls[1]!.finish(ok(OTHER));
    calls[0]!.finish(ok(LINKS));
    await vi.waitFor(() => expect(seen).toEqual([["b", OTHER]]));
  });
});

describe("useMouseLinks, rendered on the server", () => {
  const Probe = ({ slug }: { slug: string | null }) =>
    createElement("p", null, JSON.stringify(useMouseLinks(slug)));
  const render = (slug: string | null) =>
    renderToStaticMarkup(createElement(Probe, { slug }));

  it("is null for a mouse nobody asked about, and sends no request", () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no network in a server render"));
    expect(render("a")).toBe("<p>null</p>");
    expect(render(null)).toBe("<p>null</p>");
    expect(spy).not.toHaveBeenCalled();
  });

  it("answers at once for a mouse already known, so moving between pages does not flash", () => {
    primeMouseLinks("a", { ...LINKS, purchaseLinks: [] });
    expect(render("a")).toContain("https://maker.example/a");
    expect(render("b")).toBe("<p>null</p>");
  });

  it("is null for a mouse the store knows has none", () => {
    primeMouseLinks("a", null);
    expect(render("a")).toBe("<p>null</p>");
  });
});
