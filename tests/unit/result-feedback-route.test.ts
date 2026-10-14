/**
 * Wiring of `src/app/api/scans/[scanId]/feedback/route.ts`: the signed-in
 * user's id from `auth()`, a limiter with the feedback constants and its own
 * key prefix per method, the real repos, the scan id from the path, and the
 * route's own 500 when the dependencies cannot be built. The handlers'
 * behaviour is in result-feedback-service.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.fn();
vi.mock("../../src/auth", () => ({ auth: () => auth() }));

import { RESULT_FEEDBACK_NOTICE_VERSION } from "../../src/lib/contracts/result-feedback";
import type { ResultFeedbackRepo } from "../../src/server/result-feedback/repo";
import { sampleCatalogue, sampleOwnedScan } from "./fixtures/fake-fit-deps";

let buildError: Error | null = null;
let rated = false;
const stored: unknown[] = [];
const findOwnedScan = vi.fn(async () => sampleOwnedScan);
vi.mock("../../src/server/scans/drizzle-repo", () => ({
  createDrizzleScanRepo: () => ({ findOwnedScan }),
}));
vi.mock("../../src/server/fit/drizzle-repo", () => ({
  createDrizzleFitRepo: () => ({ loadCatalogue: async () => sampleCatalogue }),
}));
vi.mock("../../src/server/result-feedback/drizzle-repo", () => ({
  createDrizzleResultFeedbackRepo: (): ResultFeedbackRepo => {
    if (buildError) throw buildError;
    return {
      async recordFeedback(write) {
        if (rated) return "already_rated";
        rated = true;
        stored.push(write);
        return "stored";
      },
      async isRated() {
        return rated;
      },
      async withdrawFeedback() {
        return 0;
      },
    };
  },
}));

const allow = vi.fn<(key: string) => boolean>(() => true);
const createDrizzleRateLimiter = vi.fn<
  (options: unknown) => { allow: (key: string) => boolean }
>(() => ({ allow: (key) => allow(key) }));
vi.mock("../../src/server/analysis/drizzle-rate-limiter", () => ({
  createDrizzleRateLimiter: (options: unknown) =>
    createDrizzleRateLimiter(options),
}));

import {
  GET,
  POST,
  dynamic,
} from "../../src/app/api/scans/[scanId]/feedback/route";
import {
  RESULT_FEEDBACK_RATE_LIMIT_MAX,
  RESULT_FEEDBACK_RATE_LIMIT_WINDOW_MS,
  RESULT_FEEDBACK_READ_RATE_LIMIT_MAX,
  RESULT_FEEDBACK_READ_RATE_LIMIT_WINDOW_MS,
} from "../../src/server/scans/rate-limit-config";

const SCAN_ID = "10000000-0000-4000-8000-000000000001";
const context = (scanId = SCAN_ID) => ({ params: Promise.resolve({ scanId }) });
const IP = "203.0.113.7";

const post = (ip?: string) =>
  new Request("http://localhost/api/scans/x/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify({
      notice: RESULT_FEEDBACK_NOTICE_VERSION,
      stars: 3,
      locale: "en",
    }),
  });

beforeEach(() => {
  auth.mockReset();
  allow.mockReset();
  allow.mockReturnValue(true);
  createDrizzleRateLimiter.mockClear();
  findOwnedScan.mockClear();
  buildError = null;
  rated = false;
  stored.length = 0;
});

describe("/api/scans/{id}/feedback route", () => {
  it("is never cached or prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("POST gives the handler the signed-in user's id and the scan id of the path", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    const res = await POST(post(), context());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ stored: true, withdrawable: true });
    expect(stored[0]).toMatchObject({ userId: "user-1", scanId: SCAN_ID });
    expect(findOwnedScan).toHaveBeenCalledWith(
      SCAN_ID,
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("POST is 409 the second time, GET then says answered", async () => {
    auth.mockResolvedValue(null);
    expect((await POST(post(), context())).status).toBe(201);
    expect((await POST(post(), context())).status).toBe(409);
    const res = await GET(new Request("http://localhost/x"), context());
    expect(await res.json()).toEqual({ answered: true });
  });

  it("has no DELETE", async () => {
    const mod = await import("../../src/app/api/scans/[scanId]/feedback/route");
    expect("DELETE" in mod).toBe(false);
    expect("PUT" in mod).toBe(false);
  });

  it("builds a limiter per method with its own constants and key prefix", async () => {
    auth.mockResolvedValue(null);
    await POST(post(), context());
    expect(createDrizzleRateLimiter).toHaveBeenLastCalledWith({
      windowMs: RESULT_FEEDBACK_RATE_LIMIT_WINDOW_MS,
      limit: RESULT_FEEDBACK_RATE_LIMIT_MAX,
      keyPrefix: "result-feedback:",
    });
    await GET(new Request("http://localhost/x"), context());
    expect(createDrizzleRateLimiter).toHaveBeenLastCalledWith({
      windowMs: RESULT_FEEDBACK_READ_RATE_LIMIT_WINDOW_MS,
      limit: RESULT_FEEDBACK_READ_RATE_LIMIT_MAX,
      keyPrefix: "result-feedback-read:",
    });
  });

  it("answers 429 with nothing stored when the limiter refuses", async () => {
    auth.mockResolvedValue(null);
    allow.mockReturnValue(false);
    const res = await POST(post(IP), context());
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(stored).toHaveLength(0);
  });

  it("answers its own 500 when the dependencies cannot be built", async () => {
    buildError = new Error("DATABASE_URL is not set");
    const res = await POST(post(), context());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Something went wrong. Try again in a moment.",
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
