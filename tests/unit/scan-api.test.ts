import { describe, expect, it, vi } from "vitest";
import { MEASUREMENT_MODEL_VERSION } from "../../src/lib/contracts/measurement";
import { MAX_SCAN_BODY_BYTES } from "../../src/server/scans/body-limit";
import {
  SCAN_SESSION_COOKIE,
  buildSessionCookie,
  parseCookieHeader,
  readSessionCookie,
} from "../../src/server/scans/cookies";
import { handleExpireSessions } from "../../src/server/scans/expire-cron";
import {
  isExpiredAnonymousSession,
  selectExpiredAnonymousSessionIds,
  type SessionRow,
} from "../../src/server/scans/expiry";
import { handleSessionDelete } from "../../src/server/scans/session";
import {
  handleScanSubmission,
  type SubmitScanDeps,
} from "../../src/server/scans/submit";
import { createSweepThrottle } from "../../src/server/scans/sweep";
import { createFakeRepo } from "./fixtures/fake-scan-repo";

/** Signed out unless a test says otherwise (see scan-session-ownership.test.ts). */
function submit(
  request: Request,
  deps: Omit<SubmitScanDeps, "getUserId"> &
    Partial<Pick<SubmitScanDeps, "getUserId">>,
): Promise<Response> {
  return handleScanSubmission(request, {
    getUserId: async () => null,
    ...deps,
  });
}

const validSubmission = {
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
    palmThicknessMm: 30,
    knuckleHeightMm: 20,
    gripApertureMm: 90,
    thumbAngleDeg: 45,
  },
  calibration: {
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.5,
    cardScaleRatio: 1.002,
    parallaxCorrected: true,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
} as const;

function scanRequest(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/scans", {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe("POST /api/scans — valid submission", () => {
  it("stores the scan, creates a session and sets its cookie", async () => {
    const { repo } = createFakeRepo();
    const res = await submit(scanRequest(validSubmission), {
      repo,
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.scanId).toEqual(expect.any(String));

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SCAN_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    // Session cookie: dies on browser close, so no Max-Age/Expires.
    expect(setCookie).not.toMatch(/Max-Age|Expires/i);

    expect(repo.createAnonymousSession).toHaveBeenCalledTimes(1);
    expect(repo.insertScanWithMeasurements).toHaveBeenCalledTimes(1);
    expect(repo.insertScanWithMeasurements).toHaveBeenCalledWith(
      expect.objectContaining({
        hand: "left",
        gripStyleStated: "palm",
        scaleCheckRatio: validSubmission.calibration.cardScaleRatio,
        measurements: expect.objectContaining({ handLengthMm: 180 }),
        // #63: the model and the calibration evidence are kept with the scan.
        measurementModelVersion: validSubmission.measurementModelVersion,
        calibrationMethod: "printed-sheet",
        calibrationEvidence: validSubmission.calibration,
      }),
    );
  });

  it("stores a null scale check for a plain-paper scan, which has no card", async () => {
    const { repo } = createFakeRepo();
    const res = await submit(
      scanRequest({
        ...validSubmission,
        calibration: {
          method: "paper-edge",
          paperSize: "a4",
          edgeFitResidualMm: 0.6,
          minSideCoverage: 0.72,
          parallaxCorrected: true,
        },
      }),
      { repo },
    );
    expect(res.status).toBe(201);
    expect(repo.insertScanWithMeasurements).toHaveBeenCalledWith(
      expect.objectContaining({
        scaleCheckRatio: null,
        calibrationMethod: "paper-edge",
        calibrationEvidence: expect.objectContaining({
          method: "paper-edge",
          paperSize: "a4",
          edgeFitResidualMm: 0.6,
        }),
      }),
    );
  });

  it("stores a user-length scan as user-length, finger lengths included", async () => {
    const { repo } = createFakeRepo();
    const res = await submit(
      scanRequest({
        ...validSubmission,
        measurements: {
          handLengthMm: 186,
          palmLengthMm: 106,
          palmWidthMm: 82,
          thumbLengthMm: 60,
          indexLengthMm: 75,
          middleLengthMm: 82,
          ringLengthMm: 77,
          pinkyLengthMm: 60,
        },
        calibration: {
          method: "user-length",
          referenceMeasurement: "handLengthMm",
          referenceMm: 186,
          parallaxCorrected: false,
        },
      }),
      { repo },
    );
    expect(res.status).toBe(201);
    expect(repo.insertScanWithMeasurements).toHaveBeenCalledWith(
      expect.objectContaining({
        scaleCheckRatio: null,
        calibrationMethod: "user-length",
        calibrationEvidence: expect.objectContaining({ referenceMm: 186 }),
      }),
    );
  });

  it("creates a session cookie on first call and reuses it afterwards", async () => {
    const { repo } = createFakeRepo();

    const first = await submit(scanRequest(validSubmission), {
      repo,
    });
    const setCookie = first.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const sessionId = setCookie!.split(";")[0]!.split("=")[1]!;

    const second = await submit(
      scanRequest(validSubmission, {
        cookie: `${SCAN_SESSION_COOKIE}=${sessionId}`,
      }),
      { repo },
    );

    expect(second.status).toBe(201);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(repo.createAnonymousSession).toHaveBeenCalledTimes(1);
    expect(repo.findValidSession).toHaveBeenCalledWith(
      sessionId,
      null,
      expect.any(Date),
    );
  });

  it("issues a fresh session when the cookie names an unknown or expired session", async () => {
    const { repo } = createFakeRepo();
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const res = await submit(
      scanRequest(validSubmission, {
        cookie: `${SCAN_SESSION_COOKIE}=${unknownId}`,
      }),
      { repo },
    );

    expect(res.status).toBe(201);
    expect(repo.findValidSession).toHaveBeenCalledWith(
      unknownId,
      null,
      expect.any(Date),
    );
    expect(res.headers.get("set-cookie")).toContain(SCAN_SESSION_COOKIE);
    expect(res.headers.get("set-cookie")).not.toContain(unknownId);
    expect(repo.createAnonymousSession).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/scans — strict-schema rejection", () => {
  it.each([
    ["an unrecognized field", { ...validSubmission, extra: "not-allowed" }],
    ["an invalid hand value", { ...validSubmission, hand: "up" }],
    [
      "an out-of-range measurement",
      {
        ...validSubmission,
        measurements: { ...validSubmission.measurements, handLengthMm: 5 },
      },
    ],
    [
      "a palm longer than the hand",
      {
        ...validSubmission,
        measurements: {
          ...validSubmission.measurements,
          palmLengthMm: 500,
        },
      },
    ],
    [
      "a stale measurement model version",
      { ...validSubmission, measurementModelVersion: "old-version" },
    ],
  ])("rejects %s with 400 and no DB writes", async (_label, payload) => {
    const { repo } = createFakeRepo();
    const res = await submit(scanRequest(payload), { repo });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(repo.createAnonymousSession).not.toHaveBeenCalled();
    expect(repo.insertScanWithMeasurements).not.toHaveBeenCalled();
  });

  it("never echoes the rejected request body back to the caller", async () => {
    const { repo } = createFakeRepo();
    const payload = { ...validSubmission, secretField: "s3cr3t-marker" };
    const res = await submit(scanRequest(payload), { repo });

    expect(res.status).toBe(400);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("s3cr3t-marker");
  });
});

describe("POST /api/scans — oversized body", () => {
  it("refuses a body over the size cap with 413 before it is ever parsed", async () => {
    const { repo } = createFakeRepo();
    // Not valid JSON — if the handler tried to parse it first this would
    // surface as a 400, not a 413, proving the size check runs first.
    const oversized = "x".repeat(MAX_SCAN_BODY_BYTES + 1024);
    const request = new Request("http://localhost/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
    });

    const res = await submit(request, { repo });

    expect(res.status).toBe(413);
    expect(repo.findValidSession).not.toHaveBeenCalled();
    expect(repo.createAnonymousSession).not.toHaveBeenCalled();
    expect(repo.insertScanWithMeasurements).not.toHaveBeenCalled();
  });
});

describe("POST /api/scans — per-IP rate limit (M2 hardening)", () => {
  it("429s with a no-store, user-facing error body when the limiter rejects the request, without creating a session or scan", async () => {
    const { repo } = createFakeRepo();

    const res = await submit(
      scanRequest(validSubmission, {
        "x-vercel-forwarded-for": "203.0.113.9",
      }),
      { repo, limiter: { allow: () => false } },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(repo.createAnonymousSession).not.toHaveBeenCalled();
    expect(repo.insertScanWithMeasurements).not.toHaveBeenCalled();
  });

  it("does not limit when the request carries no usable client IP (local dev)", async () => {
    const { repo } = createFakeRepo();

    const res = await submit(scanRequest(validSubmission), {
      repo,
      limiter: { allow: () => false },
    });

    expect(res.status).toBe(201);
  });

  it("keys the limiter on the caller's IP (x-vercel-forwarded-for)", async () => {
    const { repo } = createFakeRepo();
    const seen: string[] = [];

    await submit(
      scanRequest(validSubmission, {
        "x-vercel-forwarded-for": "203.0.113.9",
      }),
      {
        repo,
        limiter: {
          allow: (key) => {
            seen.push(key);
            return true;
          },
        },
      },
    );

    expect(seen).toEqual(["203.0.113.9"]);
  });
});

describe("DELETE /api/scans/session", () => {
  it("deletes the caller's session and clears the cookie", async () => {
    const { repo, sessions } = createFakeRepo();
    sessions.set("44444444-4444-4444-8444-444444444444", {
      id: "44444444-4444-4444-8444-444444444444",
      userId: null,
      expiresAt: new Date(Date.now() + 1000),
    });
    const request = new Request("http://localhost/api/scans/session", {
      method: "DELETE",
      headers: {
        cookie: `${SCAN_SESSION_COOKIE}=44444444-4444-4444-8444-444444444444`,
      },
    });

    const res = await handleSessionDelete(request, { repo });

    expect(res.status).toBe(204);
    expect(repo.deleteSession).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is a no-op but still clears the cookie when there is no session cookie", async () => {
    const { repo } = createFakeRepo();
    const request = new Request("http://localhost/api/scans/session", {
      method: "DELETE",
    });

    const res = await handleSessionDelete(request, { repo });

    expect(res.status).toBe(204);
    expect(repo.deleteSession).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("never deletes a session a signed-in user has claimed (beacon is anonymous-only, enforced server-side too)", async () => {
    const { repo, sessions } = createFakeRepo();
    const claimedId = "55555555-5555-4555-8555-555555555555";
    sessions.set(claimedId, {
      id: claimedId,
      userId: "user-1",
      expiresAt: null,
    });
    const request = new Request("http://localhost/api/scans/session", {
      method: "DELETE",
      headers: { cookie: `${SCAN_SESSION_COOKIE}=${claimedId}` },
    });

    const res = await handleSessionDelete(request, { repo });

    expect(res.status).toBe(204);
    expect(repo.deleteSession).toHaveBeenCalledWith(claimedId);
    expect(sessions.get(claimedId)).toBeDefined();
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("GET /api/cron/expire-sessions — auth", () => {
  it.each([
    ["no secret configured, no header", undefined, undefined],
    ["secret configured, no header", "secret", undefined],
    ["secret configured, wrong header", "secret", "Bearer wrong"],
    ["secret configured, missing Bearer prefix", "secret", "secret"],
  ] as const)("%s → 401", async (_label, cronSecret, authHeader) => {
    const { repo } = createFakeRepo();
    const headers: Record<string, string> = {};
    if (authHeader) headers.authorization = authHeader;
    const request = new Request("http://localhost/api/cron/expire-sessions", {
      headers,
    });

    const res = await handleExpireSessions(request, { repo, cronSecret });

    expect(res.status).toBe(401);
    expect(repo.deleteExpiredAnonymousSessions).not.toHaveBeenCalled();
  });

  it("runs the sweep when the bearer secret matches", async () => {
    const { repo } = createFakeRepo();
    const request = new Request("http://localhost/api/cron/expire-sessions", {
      headers: { authorization: "Bearer secret" },
    });

    const res = await handleExpireSessions(request, {
      repo,
      cronSecret: "secret",
    });

    expect(res.status).toBe(200);
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);
  });

  it("also sweeps ended rate-limit windows and reports both counts (L2 hardening)", async () => {
    const { repo } = createFakeRepo();
    repo.deleteExpiredAnonymousSessions = vi.fn(async () => 3);
    repo.deleteEndedRateLimitWindows = vi.fn(async () => 7);
    const request = new Request("http://localhost/api/cron/expire-sessions", {
      headers: { authorization: "Bearer secret" },
    });

    const res = await handleExpireSessions(request, {
      repo,
      cronSecret: "secret",
    });

    expect(res.status).toBe(200);
    expect(repo.deleteEndedRateLimitWindows).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ deleted: 3, rateLimitsDeleted: 7 });
  });
});

describe("expiry query — anonymous sessions past expires_at", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  const rows: SessionRow[] = [
    { id: "a", userId: null, expiresAt: new Date("2026-09-21T00:00:00Z") },
    { id: "b", userId: null, expiresAt: new Date("2026-09-23T00:00:00Z") },
    { id: "c", userId: "user-1", expiresAt: new Date("2026-09-21T00:00:00Z") },
    { id: "d", userId: null, expiresAt: null },
    { id: "e", userId: null, expiresAt: now },
  ];

  it.each([
    ["a", true], // anonymous, past expires_at
    ["b", false], // anonymous, not yet expired
    ["c", false], // signed-in (userId set) — M6 sessions never expire here
    ["d", false], // malformed (no expires_at) — left alone, not guessed at
    ["e", true], // exactly at the boundary is expired
  ] as const)("row %s → expired=%s", (id, expected) => {
    const row = rows.find((r) => r.id === id)!;
    expect(isExpiredAnonymousSession(row, now)).toBe(expected);
  });

  it("selects only the expired anonymous session ids", () => {
    expect(selectExpiredAnonymousSessionIds(rows, now)).toEqual(["a", "e"]);
  });
});

describe("scan session cookie", () => {
  it("round-trips a session id through Set-Cookie and Cookie headers", () => {
    const id = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    const cookieHeader = buildSessionCookie(id).split(";")[0]!;
    expect(readSessionCookie(cookieHeader)).toBe(id);
  });

  it("treats a non-UUID cookie value as no session, so it never reaches Postgres", () => {
    for (const value of ["session-123", "abc", "' OR 1=1 --", "%E0%A4%A"]) {
      expect(readSessionCookie(`${SCAN_SESSION_COOKIE}=${value}`)).toBeNull();
    }
  });

  it.each([
    [null, {}],
    ["", {}],
    ["a=1; b=2", { a: "1", b: "2" }],
    [
      `${SCAN_SESSION_COOKIE}=abc; other=xyz`,
      { scan_session: "abc", other: "xyz" },
    ],
  ] as const)("parseCookieHeader(%s)", (header, expected) => {
    expect(parseCookieHeader(header)).toEqual(expected);
  });

  it("treats an absent cookie as no session", () => {
    expect(readSessionCookie(null)).toBeNull();
    expect(readSessionCookie("unrelated=1")).toBeNull();
  });
});

describe("POST /api/scans — lazy sweep (issue #17 spec amendment)", () => {
  it("runs the expiry delete on a request, throttled by the injected sweep", async () => {
    const { repo } = createFakeRepo();
    const sweep = createSweepThrottle();
    const now = () => new Date("2026-09-22T12:00:00Z");

    await submit(scanRequest(validSubmission), {
      repo,
      sweep,
      now,
    });
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);

    // A second request one second later, inside the throttle window, does
    // not sweep again.
    await submit(scanRequest(validSubmission), {
      repo,
      sweep,
      now: () => new Date("2026-09-22T12:00:01Z"),
    });
    expect(repo.deleteExpiredAnonymousSessions).toHaveBeenCalledTimes(1);
  });

  it("a sweep failure never fails the scan submission (best-effort)", async () => {
    const { repo } = createFakeRepo();
    const throwingSweep = {
      maybeSweep: vi.fn(async () => {
        throw new Error("sweep boom");
      }),
    };

    const res = await submit(scanRequest(validSubmission), {
      repo,
      sweep: throwingSweep,
    });

    expect(res.status).toBe(201);
    expect(repo.insertScanWithMeasurements).toHaveBeenCalledTimes(1);
  });

  it("uses the shared default throttle when none is injected", async () => {
    const { repo } = createFakeRepo();
    const res = await submit(scanRequest(validSubmission), {
      repo,
    });
    expect(res.status).toBe(201);
    // Whatever the default throttle's state, this must not throw and must
    // not block the response — asserted above by the 201.
  });
});

describe("expired means gone — findValidSession never serves a stale session", () => {
  it("treats a cookie naming an expired session as if it had already been deleted", async () => {
    const { repo, sessions } = createFakeRepo();
    // The row still physically exists (not yet swept) but is past expiry.
    const staleId = "66666666-6666-4666-8666-666666666666";
    sessions.set(staleId, {
      id: staleId,
      userId: null,
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    });

    const result = await repo.findValidSession(
      staleId,
      null,
      new Date("2026-09-22T12:00:00Z"),
    );
    expect(result).toBeNull();

    // POST /api/scans replaces the cookie with a fresh session rather than
    // reusing (or erroring on) the expired one.
    const res = await submit(
      scanRequest(validSubmission, {
        cookie: `${SCAN_SESSION_COOKIE}=${staleId}`,
      }),
      { repo },
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain(SCAN_SESSION_COOKIE);
    expect(repo.createAnonymousSession).toHaveBeenCalledTimes(1);
  });
});
