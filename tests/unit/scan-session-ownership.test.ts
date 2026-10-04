/**
 * Issue #52: which session a submitted scan lands in depends on WHO is
 * submitting, not only on which cookie the browser holds.
 *
 * The same behaviour matrix (R1-R11) and the same issue-#52 story run against
 * two stores: the in-memory fake repo and the real repo on PGlite. The fake is
 * what the handler tests elsewhere inject; PGlite proves the SQL actually
 * enforces the matrix (and the DB CHECK allows what it creates).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `server-only` (imported by the real repos) throws outside a React Server
// Component; stub it so they can be exercised here.
vi.mock("server-only", () => ({}));

import { MEASUREMENT_MODEL_VERSION } from "../../src/lib/contracts/measurement";
import { claimAnonymousSession } from "../../src/server/auth/claim";
import { SCAN_SESSION_COOKIE } from "../../src/server/scans/cookies";
import { SESSION_TTL_MS } from "../../src/server/scans/retention";
import { handleScanSubmission } from "../../src/server/scans/submit";
import { createFakeRepo } from "./fixtures/fake-scan-repo";
import {
  createFakeWorld,
  createPgliteWorld,
  type ScanWorld,
} from "./fixtures/scan-world";

const NOW = new Date("2026-10-04T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

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
  },
  calibration: {
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.5,
    cardScaleRatio: 1.002,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
} as const;

function scanRequest(cookieSessionId?: string): Request {
  return new Request("http://localhost/api/scans", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookieSessionId
        ? { cookie: `${SCAN_SESSION_COOKIE}=${cookieSessionId}` }
        : {}),
    },
    body: JSON.stringify(validSubmission),
  });
}

/** Submits as `userId` (null = signed out) with the given cookie. */
async function submitAs(
  world: ScanWorld,
  userId: string | null,
  cookieSessionId?: string,
) {
  const res = await handleScanSubmission(scanRequest(cookieSessionId), {
    repo: world.repo,
    getUserId: async () => userId,
    now: () => NOW,
    // The real sweep would delete the expired rows these tests need to find
    // still sitting there (not yet swept — the interesting case).
    sweep: { maybeSweep: async () => {} },
  });
  expect(res.status).toBe(201);
  const { scanId } = (await res.json()) as { scanId: string };
  return { res, scanId, setCookie: res.headers.get("set-cookie") };
}

async function newUser(world: ScanWorld): Promise<string> {
  const id = `user-${randomUUID()}`;
  await world.addUser(id);
  return id;
}

/** What the browser's cookie points at, before the submission. */
type CookieState =
  | "none"
  | "unknown"
  | "anonymous-live"
  | "anonymous-expired"
  | "anonymous-expiring-now"
  | "claimed-by-caller"
  | "claimed-by-other";

type Outcome = "reuse" | "claim-and-reuse" | "new-anonymous" | "new-claimed";

interface MatrixRow {
  id: string;
  caller: "signed-out" | "signed-in";
  cookie: CookieState;
  outcome: Outcome;
  note: string;
}

const MATRIX: MatrixRow[] = [
  {
    id: "R1",
    caller: "signed-out",
    cookie: "none",
    outcome: "new-anonymous",
    note: "no cookie -> new anonymous session, 24 h expiry",
  },
  {
    id: "R2",
    caller: "signed-out",
    cookie: "unknown",
    outcome: "new-anonymous",
    note: "cookie names no session -> new anonymous session",
  },
  {
    id: "R3",
    caller: "signed-out",
    cookie: "anonymous-live",
    outcome: "reuse",
    note: "anonymous, unexpired -> reuse (current behaviour)",
  },
  {
    id: "R4",
    caller: "signed-out",
    cookie: "anonymous-expired",
    outcome: "new-anonymous",
    note: "expired -> new anonymous session",
  },
  {
    id: "R4b",
    caller: "signed-out",
    cookie: "anonymous-expiring-now",
    outcome: "new-anonymous",
    note: "expires exactly now counts as expired",
  },
  {
    id: "R5",
    caller: "signed-out",
    cookie: "claimed-by-other",
    outcome: "new-anonymous",
    note: "issue #52: claimed session left behind after sign-out is never reused",
  },
  {
    id: "R6",
    caller: "signed-in",
    cookie: "none",
    outcome: "new-claimed",
    note: "no cookie -> new session already claimed for the user",
  },
  {
    id: "R7",
    caller: "signed-in",
    cookie: "unknown",
    outcome: "new-claimed",
    note: "cookie names no session -> new claimed session",
  },
  {
    id: "R8",
    caller: "signed-in",
    cookie: "anonymous-live",
    outcome: "claim-and-reuse",
    note: "gap 1: fresh anonymous cookie + signed in -> claim it, then reuse",
  },
  {
    id: "R9",
    caller: "signed-in",
    cookie: "anonymous-expired",
    outcome: "new-claimed",
    note: "expired anonymous session is gone, not claimed",
  },
  {
    id: "R9b",
    caller: "signed-in",
    cookie: "anonymous-expiring-now",
    outcome: "new-claimed",
    note: "expires exactly now counts as expired, not claimable",
  },
  {
    id: "R10",
    caller: "signed-in",
    cookie: "claimed-by-caller",
    outcome: "reuse",
    note: "the user's own claimed session -> reuse, never expires",
  },
  {
    id: "R11",
    caller: "signed-in",
    cookie: "claimed-by-other",
    outcome: "new-claimed",
    note: "someone else's claimed session -> untouched, new claimed session",
  },
];

async function seedCookieSession(
  world: ScanWorld,
  state: CookieState,
  owners: { caller: string | null; other: string },
): Promise<string | undefined> {
  if (state === "none") return undefined;
  const id = randomUUID();
  if (state === "unknown") return id;
  const row = {
    "anonymous-live": {
      userId: null,
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
    },
    "anonymous-expired": {
      userId: null,
      expiresAt: new Date(NOW.getTime() - HOUR_MS),
    },
    "anonymous-expiring-now": {
      userId: null,
      expiresAt: new Date(NOW.getTime()),
    },
    "claimed-by-caller": { userId: owners.caller, expiresAt: null },
    "claimed-by-other": { userId: owners.other, expiresAt: null },
  }[state];
  await world.addSession({ id, ...row });
  return id;
}

const worlds = [
  { name: "in-memory fake repo", create: async () => createFakeWorld() },
  { name: "real repo on PGlite", create: createPgliteWorld },
];

describe.each(worlds)(
  "POST /api/scans session ownership — $name",
  ({ create }) => {
    let world: ScanWorld;
    beforeAll(async () => {
      world = await create();
    }, 60_000);
    afterAll(async () => {
      await world?.close();
    });

    it.each(MATRIX)(
      "$id $caller, cookie $cookie -> $outcome ($note)",
      async (row) => {
        const caller = row.caller === "signed-in" ? await newUser(world) : null;
        const other = await newUser(world);
        const cookieId = await seedCookieSession(world, row.cookie, {
          caller,
          other,
        });
        const before = cookieId ? await world.getSession(cookieId) : null;
        const sessionsBefore = await world.sessionCount();

        const { scanId, setCookie } = await submitAs(world, caller, cookieId);

        const landedIn = await world.sessionOfScan(scanId);
        expect(landedIn).not.toBeNull();
        const landed = (await world.getSession(landedIn!))!;

        switch (row.outcome) {
          case "reuse":
          case "claim-and-reuse":
            expect(landedIn).toBe(cookieId);
            expect(setCookie).toBeNull();
            expect(await world.sessionCount()).toBe(sessionsBefore);
            break;
          case "new-anonymous":
          case "new-claimed":
            if (cookieId) expect(landedIn).not.toBe(cookieId);
            expect(setCookie).toContain(`${SCAN_SESSION_COOKIE}=${landedIn}`);
            expect(setCookie).toMatch(/HttpOnly/);
            expect(await world.sessionCount()).toBe(sessionsBefore + 1);
            break;
        }

        switch (row.outcome) {
          case "reuse":
            // Untouched: same owner, same expiry as it was seeded.
            expect(landed).toEqual(before);
            break;
          case "claim-and-reuse":
            expect(landed).toEqual({
              id: cookieId,
              userId: caller,
              expiresAt: null,
            });
            break;
          case "new-anonymous":
            expect(landed).toEqual({
              id: landedIn,
              userId: null,
              expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS),
            });
            break;
          case "new-claimed":
            expect(landed).toEqual({
              id: landedIn,
              userId: caller,
              expiresAt: null,
            });
            break;
        }

        // The cookie's session is never changed or fed a scan unless this
        // row reuses (or claims) it.
        if (cookieId && !["reuse", "claim-and-reuse"].includes(row.outcome)) {
          expect(await world.getSession(cookieId)).toEqual(before);
          expect(await world.scansInSession(cookieId)).toBe(0);
        }

        // Where the scan shows up: a signed-in caller's own account; never
        // the other user's.
        if (caller) {
          expect(await world.accountScanIds(caller)).toEqual([scanId]);
        }
        expect(await world.accountScanIds(other)).toEqual([]);
      },
      30_000,
    );

    it("issue #52 regression: A signs in and signs out, B (same browser, A's cookie) never writes into A's account", async () => {
      const userA = await newUser(world);

      // A browses anonymously and scans: new anonymous session + cookie.
      const first = await submitAs(world, null);
      const cookieId = (await world.sessionOfScan(first.scanId))!;
      expect(first.setCookie).toContain(cookieId);
      expect((await world.getSession(cookieId))!.expiresAt).not.toBeNull();

      // A signs in: the Auth.js sign-in event claims the cookie's session.
      await claimAnonymousSession(cookieId, userA, {
        repo: world.repo,
        now: () => NOW,
      });
      expect(await world.getSession(cookieId)).toEqual({
        id: cookieId,
        userId: userA,
        expiresAt: null,
      });

      // A scans again while signed in: same session, no new cookie.
      const second = await submitAs(world, userA, cookieId);
      expect(second.setCookie).toBeNull();
      expect(await world.sessionOfScan(second.scanId)).toBe(cookieId);

      // A signs out but keeps the browser open (cookie stays). B scans there.
      const sessionsBeforeB = await world.sessionCount();
      const b = await submitAs(world, null, cookieId);

      // B got a NEW cookie, for a NEW anonymous session that expires.
      expect(b.setCookie).not.toBeNull();
      const bSession = (await world.sessionOfScan(b.scanId))!;
      expect(bSession).not.toBe(cookieId);
      expect(b.setCookie).toContain(`${SCAN_SESSION_COOKIE}=${bSession}`);
      expect(await world.getSession(bSession)).toEqual({
        id: bSession,
        userId: null,
        expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS),
      });
      expect(await world.sessionCount()).toBe(sessionsBeforeB + 1);

      // A's account shows exactly A's two scans; B's is nowhere in it, and
      // A's session never got B's scan (and still never expires).
      const aScans = await world.accountScanIds(userA);
      expect([...aScans].sort()).toEqual([first.scanId, second.scanId].sort());
      expect(aScans).not.toContain(b.scanId);
      expect(await world.scansInSession(cookieId)).toBe(2);
      expect(await world.getSession(cookieId)).toEqual({
        id: cookieId,
        userId: userA,
        expiresAt: null,
      });

      // B's next scan, with the cookie B was just given, stays in B's session.
      const b2 = await submitAs(world, null, bSession);
      expect(b2.setCookie).toBeNull();
      expect(await world.sessionOfScan(b2.scanId)).toBe(bSession);
    }, 60_000);

    it("a malformed cookie value is treated as no cookie: never looked up, signed in or out", async () => {
      const userA = await newUser(world);
      for (const caller of [null, userA]) {
        // A fresh spy per call: the world's own repo accumulates calls from
        // the other tests in this describe.
        const lookups = vi.fn(world.repo.findValidSession);
        const repo = { ...world.repo, findValidSession: lookups };
        const res = await handleScanSubmission(
          new Request("http://localhost/api/scans", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: `${SCAN_SESSION_COOKIE}=not-a-uuid`,
            },
            body: JSON.stringify(validSubmission),
          }),
          {
            repo,
            getUserId: async () => caller,
            now: () => NOW,
            sweep: { maybeSweep: async () => {} },
          },
        );
        expect(res.status).toBe(201);
        expect(lookups).not.toHaveBeenCalled();
        expect(res.headers.get("set-cookie")).toContain(SCAN_SESSION_COOKIE);
      }
    }, 30_000);
  },
);

describe("POST /api/scans — a claim that does not stick (handler logic)", () => {
  // The claim is one conditional UPDATE and the lookup before it is a
  // separate query, so a request can lose a race in between. The handler
  // trusts only what the repo says afterwards belongs to the caller.
  const OTHER = "user-other";
  const CALLER = "user-caller";

  async function setup(
    interfere: (row: { userId: string | null; expiresAt: Date | null }) => void,
  ) {
    const { repo, sessions, insertedScans } = createFakeRepo();
    const id = randomUUID();
    sessions.set(id, {
      id,
      userId: null,
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
    });
    const realClaim = repo.claimSession;
    repo.claimSession = vi.fn(async (sessionId, userId, now) => {
      interfere(sessions.get(sessionId)!);
      await realClaim(sessionId, userId, now);
    });
    const res = await handleScanSubmission(scanRequest(id), {
      repo,
      getUserId: async () => CALLER,
      now: () => NOW,
      sweep: { maybeSweep: async () => {} },
    });
    return { res, id, sessions, insertedScans, repo };
  }

  it("another user claims the session between the lookup and our claim: untouched, caller gets a new claimed session", async () => {
    const { res, id, sessions, insertedScans } = await setup((row) => {
      row.userId = OTHER;
      row.expiresAt = null;
    });
    expect(res.status).toBe(201);
    expect(sessions.get(id)).toMatchObject({ userId: OTHER, expiresAt: null });
    expect(insertedScans).toHaveLength(1);
    const landed = sessions.get(insertedScans[0]!.sessionId)!;
    expect(landed.id).not.toBe(id);
    expect(landed).toMatchObject({ userId: CALLER, expiresAt: null });
    expect(res.headers.get("set-cookie")).toContain(landed.id);
  });

  it("the session expires between the lookup and our claim: caller gets a new claimed session", async () => {
    const { res, id, sessions, insertedScans } = await setup((row) => {
      row.expiresAt = new Date(NOW.getTime() - 1);
    });
    expect(res.status).toBe(201);
    expect(sessions.get(id)).toMatchObject({ userId: null });
    const landed = sessions.get(insertedScans[0]!.sessionId)!;
    expect(landed.id).not.toBe(id);
    expect(landed).toMatchObject({ userId: CALLER, expiresAt: null });
  });

  it("the same user claims it first (two parallel submissions): reused, no extra session or cookie", async () => {
    const { res, id, sessions, insertedScans } = await setup((row) => {
      row.userId = CALLER;
      row.expiresAt = null;
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(insertedScans[0]!.sessionId).toBe(id);
    expect(sessions.size).toBe(1);
  });
});

describe("POST /api/scans — repo calls (handler logic)", () => {
  it("looks the cookie up as the caller and claims only an unclaimed session", async () => {
    const { repo, sessions } = createFakeRepo();
    const anon = randomUUID();
    const mine = randomUUID();
    sessions.set(anon, {
      id: anon,
      userId: null,
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
    });
    sessions.set(mine, { id: mine, userId: "user-1", expiresAt: null });
    const deps = {
      repo,
      getUserId: async () => "user-1" as string | null,
      now: () => NOW,
      sweep: { maybeSweep: async () => {} },
    };

    await handleScanSubmission(scanRequest(mine), deps);
    expect(repo.findValidSession).toHaveBeenLastCalledWith(mine, "user-1", NOW);
    expect(repo.claimSession).not.toHaveBeenCalled();

    await handleScanSubmission(scanRequest(anon), deps);
    expect(repo.claimSession).toHaveBeenCalledTimes(1);
    expect(repo.claimSession).toHaveBeenCalledWith(anon, "user-1", NOW);
    expect(repo.createAnonymousSession).not.toHaveBeenCalled();
    expect(repo.createClaimedSession).not.toHaveBeenCalled();
  });

  it("a signed-out caller never claims or creates a claimed session", async () => {
    const { repo, sessions } = createFakeRepo();
    const claimed = randomUUID();
    sessions.set(claimed, { id: claimed, userId: "user-1", expiresAt: null });

    await handleScanSubmission(scanRequest(claimed), {
      repo,
      getUserId: async () => null,
      now: () => NOW,
      sweep: { maybeSweep: async () => {} },
    });

    expect(repo.findValidSession).toHaveBeenCalledWith(claimed, null, NOW);
    expect(repo.claimSession).not.toHaveBeenCalled();
    expect(repo.createClaimedSession).not.toHaveBeenCalled();
    expect(repo.createAnonymousSession).toHaveBeenCalledTimes(1);
  });
});
