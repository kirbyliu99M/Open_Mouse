/**
 * Wiring of `src/app/api/survey/route.ts`: that it gives the handlers the
 * signed-in user's id from `auth()`, one per-IP limiter with the survey
 * constants and its own key prefix, and the real repos. The handlers' own
 * behaviour is in survey-service.test.ts; this file only pins the seam between
 * the route and them, with `auth`, the repos and the limiter stubbed: also that
 * the limiter's refusal reaches the caller as a 429 with nothing written, and
 * that a failure to build the dependencies is the survey's own 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.fn();
vi.mock("../../src/auth", () => ({ auth: () => auth() }));

import {
  NOW,
  createFakeSurveyWorld,
  type SurveyWorld,
} from "./fixtures/survey-world";

let world: SurveyWorld;
/** Set to make building the survey repo throw, as `getDb()` does without a DATABASE_URL. */
let buildError: Error | null = null;
vi.mock("../../src/server/scans/drizzle-repo", () => ({
  createDrizzleScanRepo: () => world.scanRepo,
}));
vi.mock("../../src/server/survey/drizzle-repo", () => ({
  createDrizzleSurveyRepo: () => {
    if (buildError) throw buildError;
    return world.surveyRepo;
  },
}));

/** What the stubbed limiter answers; the route's own wiring decides what happens with it. */
const allow = vi.fn<(key: string) => boolean>(() => true);
const createDrizzleRateLimiter = vi.fn<
  (options: unknown) => { allow: (key: string) => boolean }
>(() => ({ allow: (key) => allow(key) }));
vi.mock("../../src/server/analysis/drizzle-rate-limiter", () => ({
  createDrizzleRateLimiter: (options: unknown) =>
    createDrizzleRateLimiter(options),
}));

import { DELETE, POST, dynamic } from "../../src/app/api/survey/route";
import { SURVEY_CONSENT_VERSION } from "../../src/lib/contracts/survey";
import {
  FIT_RATE_LIMIT_MAX,
  SURVEY_RATE_LIMIT_MAX,
  SURVEY_RATE_LIMIT_WINDOW_MS,
} from "../../src/server/scans/rate-limit-config";

beforeEach(async () => {
  world = createFakeSurveyWorld();
  await world.addUser("user-1");
  await world.addMouse("mouse-a");
  auth.mockReset();
  createDrizzleRateLimiter.mockClear();
  allow.mockReset();
  allow.mockReturnValue(true);
  buildError = null;
});

/** A request with no IP header is never limited (local dev), so a limiting case names one. */
const IP = "203.0.113.7";

const submission = (scanId: string, ip?: string) =>
  new Request("http://localhost/api/survey", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify({
      scanId,
      consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
      ratings: [{ slug: "mouse-a", satisfaction: 4 }],
    }),
  });

describe("/api/survey route", () => {
  it("is never cached or prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("POST gives the handler the signed-in user's id from auth()", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    const scan = await world.addScan({ userId: "user-1" });
    // The route takes its clock from the real one: the fake world's scans are
    // owned by a claimed session, which never expires, so `NOW` does not matter.
    void NOW;
    const res = await POST(submission(scan.scanId));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ stored: true, withdrawable: true });
    expect((await world.contributions())[0]).toMatchObject({
      userId: "user-1",
    });
  });

  it("POST treats a caller with no session as anonymous: a claimed scan is then a 404", async () => {
    auth.mockResolvedValue(null);
    const scan = await world.addScan({ userId: "user-1" });
    const res = await POST(submission(scan.scanId));
    expect(res.status).toBe(404);
  });

  it("DELETE is 401 without a session and 204 with one", async () => {
    auth.mockResolvedValue(null);
    const request = () =>
      new Request("http://localhost/api/survey", { method: "DELETE" });
    expect((await DELETE(request())).status).toBe(401);
    auth.mockResolvedValue({ user: { id: "user-1" } });
    expect((await DELETE(request())).status).toBe(204);
  });

  it("builds the limiter with the survey constants and its own key prefix, so the budget is not shared with the scan or fit routes", async () => {
    auth.mockResolvedValue(null);
    await DELETE(
      new Request("http://localhost/api/survey", { method: "DELETE" }),
    );
    expect(createDrizzleRateLimiter).toHaveBeenCalledWith({
      windowMs: SURVEY_RATE_LIMIT_WINDOW_MS,
      limit: SURVEY_RATE_LIMIT_MAX,
      keyPrefix: "survey:",
    });
    // Candidate numbers (未拍板): ten per ten minutes, well under the fit route's.
    expect(SURVEY_RATE_LIMIT_MAX).toBe(10);
    expect(SURVEY_RATE_LIMIT_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(SURVEY_RATE_LIMIT_MAX).toBeLessThan(FIT_RATE_LIMIT_MAX);
  });

  it("answers 429 with no-store and writes nothing when the limiter refuses the caller's IP, on POST and on DELETE", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    const first = await world.addScan({ userId: "user-1", handLengthMm: 181 });
    const second = await world.addScan({ userId: "user-1", handLengthMm: 192 });
    expect((await POST(submission(first.scanId, IP))).status).toBe(201);
    expect(allow).toHaveBeenLastCalledWith(IP);
    const before = await world.contributions();
    expect(before).toHaveLength(1);

    allow.mockReturnValue(false);
    const refused = await POST(submission(second.scanId, IP));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(await refused.json()).toEqual({
      error: "Too many requests. Try again shortly.",
    });
    expect(await world.scanMark(second.scanId)).toBeNull();

    const refusedDelete = await DELETE(
      new Request("http://localhost/api/survey", {
        method: "DELETE",
        headers: { "x-forwarded-for": IP },
      }),
    );
    expect(refusedDelete.status).toBe(429);
    expect(refusedDelete.headers.get("cache-control")).toBe("no-store");

    // Neither the second submission nor the withdrawal got through.
    expect(await world.contributions()).toEqual(before);
  });

  it("answers the survey's own 500, no-store and without the error's text, when the dependencies cannot be built", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } });
    const scan = await world.addScan({ userId: "user-1" });
    buildError = new Error(
      "Set DATABASE_URL to postgres://app:hunter2@db.example/prod",
    );
    const lines: string[] = [];
    const error = vi
      .spyOn(console, "error")
      .mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const post = await POST(submission(scan.scanId));
      const del = await DELETE(
        new Request("http://localhost/api/survey", { method: "DELETE" }),
      );
      for (const res of [post, del]) {
        expect(res.status).toBe(500);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.clone().json()).toEqual({
          error: "Something went wrong. Try again in a moment.",
        });
        expect(await res.text()).not.toMatch(/DATABASE_URL|hunter2/);
      }
    } finally {
      error.mockRestore();
    }
    // One log line each, naming the route and the operation, never the message.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("survey.failed");
    expect(lines[0]).toContain("/api/survey");
    expect(lines.join(" ")).not.toMatch(/hunter2|DATABASE_URL/);
    expect(await world.contributions()).toEqual([]);
  });
});
