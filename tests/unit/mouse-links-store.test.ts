import { afterEach, describe, expect, it, vi } from "vitest";
import {
  peekMouseLinks,
  primeMouseLinks,
  requestMouseLinks,
  resetMouseLinks,
} from "../../src/components/results/mouseLinksStore";
import { useMouseLinks } from "../../src/components/results/useMouseLinks";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const LINKS = {
  officialUrl: "https://maker.example/a",
  officialKind: "product",
  purchaseLinks: [{ label: "Shop A", url: "https://shop.example/a" }],
};

type Init = { signal?: AbortSignal };
const ok = (body: unknown) => ({ ok: true, json: async () => body });

afterEach(() => resetMouseLinks());

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

  it.each([
    ["a body that is not the contract", ok({ officialUrl: "http://insecure" })],
    ["a body with an unknown field", ok({ ...LINKS, extra: 1 })],
    ["a 404", { ok: false, json: async () => ({ error: "Not found" }) }],
  ])("gives null for %s, and does not ask again", async (_name, res) => {
    const fetchImpl = vi.fn(async () => res);
    await expect(requestMouseLinks("a", fetchImpl).promise).resolves.toBeNull();
    await requestMouseLinks("a", fetchImpl).promise;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(peekMouseLinks("a")).toBeNull();
  });

  it("gives null for a network error and for a body that is not JSON", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(requestMouseLinks("a", down).promise).resolves.toBeNull();
    const garbled = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }));
    await expect(requestMouseLinks("b", garbled).promise).resolves.toBeNull();
  });

  it("aborts the request when the only caller lets go, and remembers nothing", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: Init) => {
      signal = init?.signal;
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const req = requestMouseLinks("a", fetchImpl);
    expect(signal?.aborted).toBe(false);
    req.release();
    expect(signal?.aborted).toBe(true);
    await expect(req.promise).resolves.toBeNull();
    expect(peekMouseLinks("a")).toBeUndefined(); // not cached: a later visit asks again
  });

  it("keeps the request going while another caller still wants it", async () => {
    let signal: AbortSignal | undefined;
    let finish: (v: ReturnType<typeof ok>) => void = () => {};
    const fetchImpl = vi.fn((_url: string, init?: Init) => {
      signal = init?.signal;
      return new Promise<ReturnType<typeof ok>>((resolve) => {
        finish = resolve;
      });
    });
    const first = requestMouseLinks("a", fetchImpl);
    const second = requestMouseLinks("a", fetchImpl);
    first.release();
    first.release(); // twice is harmless
    expect(signal?.aborted).toBe(false);
    finish(ok(LINKS));
    await expect(second.promise).resolves.toEqual(LINKS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("useMouseLinks", () => {
  const Probe = ({ slug }: { slug: string | null }) =>
    createElement("p", null, JSON.stringify(useMouseLinks(slug)));
  const render = (slug: string | null) =>
    renderToStaticMarkup(createElement(Probe, { slug }));

  it("is null on the first render of a mouse nobody asked about (and sends nothing on the server)", () => {
    expect(render("a")).toBe("<p>null</p>");
    expect(render(null)).toBe("<p>null</p>");
  });

  it("answers at once for a mouse already known, so moving between pages does not flash", () => {
    primeMouseLinks("a", {
      officialUrl: "https://maker.example/a",
      officialKind: "product",
      purchaseLinks: [],
    });
    expect(render("a")).toContain("https://maker.example/a");
    expect(render("b")).toBe("<p>null</p>");
  });

  it("is null for a mouse the store knows has none", () => {
    primeMouseLinks("a", null);
    expect(render("a")).toBe("<p>null</p>");
  });
});
