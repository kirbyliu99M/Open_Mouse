/**
 * Wiring of `src/app/api/scans/[scanId]/similar/route.ts`: that it gives the
 * handler the signed-in user's id from `auth()`, one per-IP limiter with the
 * similar-hand constants and its own key prefix, and the real repos. The
 * handler's own behaviour is in similar-service.test.ts; this file only pins
 * the seam between the route and it, with `auth`, the repos and the limiter
 * stubbed, and that a failure to build the dependencies is this route's own
 * 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.fn();
vi.mock("../../src/auth", () => ({ auth: () => auth() }));

let buildError: Error | null = null;
const findOwnedScan = vi.fn();
vi.mock("../../src/server/scans/drizzle-repo", () => ({
  createDrizzleScanRepo: () => {
    if (buildError) throw buildError;
    return { findOwnedScan };
  },
}));
vi.mock("../../src/server/fit/drizzle-repo", () => ({
  createDrizzleFitRepo: () => ({ loadCatalogue: async () => [] }),
}));
vi.mock("../../src/server/recommend/drizzle-repo", () => ({
  createDrizzleSimilarRepo: () => ({ loadContributions: async () => [] }),
}));

const allow = vi.fn<(key: string) => boolean>(() => true);
const createDrizzleRateLimiter = vi.fn<
  (options: unknown) => { allow: (key: string) => boolean }
>(() => ({ allow: (key) => allow(key) }));
vi.mock("../../src/server/analysis/drizzle-rate-limiter", () => ({
  createDrizzleRateLimiter: (options: unknown) =>
    createDrizzleRateLimiter(options),
}));

import { GET, dynamic } from "../../src/app/api/scans/[scanId]/similar/route";
import {
  FIT_RATE_LIMIT_MAX,
  SIMILAR_RATE_LIMIT_MAX,
  SIMILAR_RATE_LIMIT_WINDOW_MS,
} from "../../src/server/scans/rate-limit-config";

const IP = "203.0.113.7";
const SCAN_ID = "00000000-0000-4000-8000-000000000001";

const call = (scanId = SCAN_ID, ip?: string) =>
  GET(
    new Request(`http://localhost/api/scans/${scanId}/similar`, {
      headers: ip ? { "x-forwarded-for": ip } : {},
    }),
    { params: Promise.resolve({ scanId }) },
  );

beforeEach(() => {
  auth.mockReset();
  findOwnedScan.mockReset();
  findOwnedScan.mockResolvedValue(null);
  createDrizzleRateLimiter.mockClear();
  allow.mockReset();
  allow.mockReturnValue(true);
  buildError = null;
});

describe("/api/scans/[scanId]/similar route", () => {
  it("is never cached or prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("gives the handler the signed-in user's id from auth()", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    expect((await call()).status).toBe(404);
    expect(findOwnedScan).toHaveBeenCalledWith(
      SCAN_ID,
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("treats a caller with no session as anonymous", async () => {
    auth.mockResolvedValue(null);
    await call();
    expect(findOwnedScan).toHaveBeenCalledWith(
      SCAN_ID,
      expect.objectContaining({ userId: null }),
    );
  });

  it("takes the scan id from the path and never asks the repo about a malformed one", async () => {
    auth.mockResolvedValue(null);
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(findOwnedScan).not.toHaveBeenCalled();
  });

  it("builds the limiter with the similar-hand constants and its own key prefix, so its budget is not shared with another route", async () => {
    auth.mockResolvedValue(null);
    await call();
    expect(createDrizzleRateLimiter).toHaveBeenCalledWith({
      windowMs: SIMILAR_RATE_LIMIT_WINDOW_MS,
      limit: SIMILAR_RATE_LIMIT_MAX,
      keyPrefix: "similar:",
    });
    // Candidate numbers (未拍板): the fit route's, under their own prefix.
    expect(SIMILAR_RATE_LIMIT_MAX).toBe(FIT_RATE_LIMIT_MAX);
    expect(SIMILAR_RATE_LIMIT_WINDOW_MS).toBe(10 * 60 * 1000);
  });

  it("answers 429 with no-store when the limiter refuses the caller's IP, before the scan is looked up", async () => {
    auth.mockResolvedValue(null);
    allow.mockReturnValue(false);
    const res = await call(SCAN_ID, IP);
    expect(allow).toHaveBeenLastCalledWith(IP);
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(findOwnedScan).not.toHaveBeenCalled();
  });

  it("answers its own 500, no-store and without the error's text, when the dependencies cannot be built", async () => {
    auth.mockResolvedValue(null);
    buildError = new Error(
      "Set DATABASE_URL to postgres://app:hunter2@db.example/prod",
    );
    const lines: string[] = [];
    const error = vi
      .spyOn(console, "error")
      .mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const res = await call();
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.clone().json()).toEqual({
        error: "Something went wrong. Try again in a moment.",
      });
      expect(await res.text()).not.toMatch(/DATABASE_URL|hunter2/);
    } finally {
      error.mockRestore();
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("similar.failed");
    expect(lines.join(" ")).not.toMatch(/hunter2|DATABASE_URL/);
  });
});
