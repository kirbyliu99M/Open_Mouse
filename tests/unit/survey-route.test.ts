/**
 * Wiring of `src/app/api/survey/route.ts`: that it gives the handlers the
 * signed-in user's id from `auth()`, one per-IP limiter with the survey
 * constants and its own key prefix, and the real repos. The handlers' own
 * behaviour is in survey-service.test.ts; this file only pins the seam between
 * the route and them, with `auth`, the repos and the limiter stubbed.
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
vi.mock("../../src/server/scans/drizzle-repo", () => ({
  createDrizzleScanRepo: () => world.scanRepo,
}));
vi.mock("../../src/server/survey/drizzle-repo", () => ({
  createDrizzleSurveyRepo: () => world.surveyRepo,
}));

const createDrizzleRateLimiter = vi.fn<
  (options: unknown) => { allow: () => boolean }
>(() => ({ allow: () => true }));
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
});

const submission = (scanId: string) =>
  new Request("http://localhost/api/survey", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
});
