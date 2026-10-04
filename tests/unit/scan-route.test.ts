/**
 * Issue #52 wiring: `src/app/api/scans/route.ts` must give the submit handler
 * the signed-in user's id from `auth()`. The handler's own behaviour is in
 * scan-session-ownership.test.ts; this file only pins the seam between the
 * route and it, with `auth` and the repo stubbed.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.fn();
vi.mock("../../src/auth", () => ({ auth: () => auth() }));

import { createFakeRepo } from "./fixtures/fake-scan-repo";

let fake = createFakeRepo();
vi.mock("../../src/server/scans/drizzle-repo", () => ({
  createDrizzleScanRepo: () => fake.repo,
}));
vi.mock("../../src/server/analysis/drizzle-rate-limiter", () => ({
  createDrizzleRateLimiter: () => ({ allow: () => true }),
}));

import { MEASUREMENT_MODEL_VERSION } from "../../src/lib/contracts/measurement";
import { POST } from "../../src/app/api/scans/route";
import { SCAN_SESSION_COOKIE } from "../../src/server/scans/cookies";

const submission = {
  hand: "left",
  gripStyleStated: "palm",
  measurements: {
    handLengthMm: 180,
    palmLengthMm: 100,
    palmWidthMm: 85,
    thumbLengthMm: 60,
    indexLengthMm: 70,
    middleLengthMm: 75,
    ringLengthMm: 70,
    pinkyLengthMm: 55,
  },
  calibration: {
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.5,
    cardScaleRatio: 1.002,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
};

function post(cookieSessionId: string): Request {
  return new Request("http://localhost/api/scans", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SCAN_SESSION_COOKIE}=${cookieSessionId}`,
    },
    body: JSON.stringify(submission),
  });
}

/** An unclaimed, unexpired anonymous session the cookie can name. */
function anonymousSession(): string {
  const id = randomUUID();
  fake.sessions.set(id, {
    id,
    userId: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return id;
}

beforeEach(() => {
  fake = createFakeRepo();
  auth.mockReset();
});

describe("POST /api/scans route wiring", () => {
  it("passes the signed-in user's id from auth() to the handler", async () => {
    auth.mockResolvedValue({ user: { id: "user-route" } });
    const cookieId = anonymousSession();

    const res = await POST(post(cookieId));

    expect(res.status).toBe(201);
    expect(auth).toHaveBeenCalledTimes(1);
    // The handler looked the cookie up as that user and claimed it for them.
    expect(fake.repo.findValidSession).toHaveBeenCalledWith(
      cookieId,
      "user-route",
      expect.any(Date),
    );
    expect(fake.sessions.get(cookieId)).toMatchObject({
      userId: "user-route",
      expiresAt: null,
    });
    expect(fake.insertedScans[0]?.sessionId).toBe(cookieId);
  });

  it.each([
    ["no session", null],
    ["a session without a user", {}],
    ["a user without an id", { user: {} }],
  ])("treats %s as signed out", async (_label, session) => {
    auth.mockResolvedValue(session);
    const cookieId = anonymousSession();

    const res = await POST(post(cookieId));

    expect(res.status).toBe(201);
    expect(fake.repo.findValidSession).toHaveBeenCalledWith(
      cookieId,
      null,
      expect.any(Date),
    );
    expect(fake.repo.claimSession).not.toHaveBeenCalled();
    expect(fake.sessions.get(cookieId)?.userId).toBeNull();
  });

  it("lets an auth() failure fail the request, not fall back to anonymous", async () => {
    auth.mockRejectedValue(new Error("auth backend down"));
    const cookieId = anonymousSession();

    await expect(POST(post(cookieId))).rejects.toThrow("auth backend down");
    expect(fake.insertedScans).toHaveLength(0);
  });
});
