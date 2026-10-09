import { describe, expect, it, vi } from "vitest";
import {
  createInflightRequests,
  fitRequestKey,
  shouldRequestAnalysis,
} from "../../src/lib/results/requests";

describe("fitRequestKey", () => {
  it("is the scan and the attempt", () => {
    expect(fitRequestKey("a", 0)).not.toBe(fitRequestKey("a", 1));
    expect(fitRequestKey("a", 0)).not.toBe(fitRequestKey("b", 0));
    expect(fitRequestKey("a", 2)).toBe(fitRequestKey("a", 2));
  });
});

describe("createInflightRequests (one fit POST per scan, also under Strict Mode)", () => {
  it("starts one request and shares it with a second caller (effect, cleanup, effect)", async () => {
    const requests = createInflightRequests<string>();
    let resolve!: (v: string) => void;
    const start = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const first = requests.getOrStart("scan#0", start);
    const second = requests.getOrStart("scan#0", start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    resolve("fit");
    await expect(first).resolves.toBe("fit");
    await expect(second).resolves.toBe("fit");
  });

  it("starts again once the request has settled (a reload or a later visit asks again)", async () => {
    const requests = createInflightRequests<string>();
    const start = vi.fn(() => Promise.resolve("fit"));
    await requests.getOrStart("scan#0", start);
    await Promise.resolve(); // let the settle handler run
    expect(requests.size()).toBe(0);
    await requests.getOrStart("scan#0", start);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("forgets a request that failed too, so Try again can ask", async () => {
    const requests = createInflightRequests<string>();
    const start = vi.fn(() => Promise.reject(new Error("down")));
    await expect(requests.getOrStart("scan#0", start)).rejects.toThrow("down");
    await Promise.resolve();
    expect(requests.size()).toBe(0);
    await expect(requests.getOrStart("scan#0", start)).rejects.toThrow();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("keeps different scans and different attempts apart", async () => {
    const requests = createInflightRequests<string>();
    const start = vi.fn(() => new Promise<string>(() => {}));
    requests.getOrStart(fitRequestKey("a", 0), start);
    requests.getOrStart(fitRequestKey("b", 0), start);
    requests.getOrStart(fitRequestKey("a", 1), start);
    expect(start).toHaveBeenCalledTimes(3);
    expect(requests.size()).toBe(3);
  });
});

describe("shouldRequestAnalysis", () => {
  it("is yes only for the main page, and only the first time", () => {
    expect(shouldRequestAnalysis({ isMainPage: true, started: false })).toBe(
      true,
    );
    expect(shouldRequestAnalysis({ isMainPage: true, started: true })).toBe(
      false,
    );
  });

  it("is never yes for a detail page", () => {
    expect(shouldRequestAnalysis({ isMainPage: false, started: false })).toBe(
      false,
    );
    expect(shouldRequestAnalysis({ isMainPage: false, started: true })).toBe(
      false,
    );
  });
});
