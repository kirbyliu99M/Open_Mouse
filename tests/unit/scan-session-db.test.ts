/**
 * Issue #52 against a real Postgres (PGlite): the new `findValidSession`
 * (who is asking decides which rows count), `createClaimedSession`, and how
 * they interact with `claimSession` and the `scan_sessions_anonymous_expire`
 * CHECK. The handler-level story is in scan-session-ownership.test.ts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ScanRepo } from "../../src/server/scans/repo";
import { createPgliteWorld, type ScanWorld } from "./fixtures/scan-world";

const NOW = new Date("2026-10-04T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const LIVE = new Date(NOW.getTime() + HOUR_MS);
const PAST = new Date(NOW.getTime() - HOUR_MS);

let world: ScanWorld;
let repo: ScanRepo;
beforeAll(async () => {
  world = await createPgliteWorld();
  repo = world.repo;
}, 60_000);
afterAll(async () => {
  await world?.close();
});

async function user(): Promise<string> {
  const id = `user-${randomUUID()}`;
  await world.addUser(id);
  return id;
}

describe("findValidSession on real Postgres", () => {
  // [label, row's owner, row's expiry, caller, usable?]
  const table: [
    string,
    "none" | "caller" | "other",
    Date | null,
    "signed-out" | "caller" | "someone-else",
    boolean,
  ][] = [
    ["anonymous, live: signed out", "none", LIVE, "signed-out", true],
    ["anonymous, live: signed in", "none", LIVE, "caller", true],
    ["anonymous, expired: signed out", "none", PAST, "signed-out", false],
    ["anonymous, expired: signed in", "none", PAST, "caller", false],
    [
      "anonymous, expires exactly now: signed out",
      "none",
      NOW,
      "signed-out",
      false,
    ],
    ["anonymous, expires exactly now: signed in", "none", NOW, "caller", false],
    ["claimed by caller: signed out", "caller", null, "signed-out", false],
    ["claimed by caller: the caller", "caller", null, "caller", true],
    ["claimed by caller: someone else", "caller", null, "someone-else", false],
    // A claimed row never expires (the sweep and the ownership rule agree);
    // claimSession and createClaimedSession both write NULL, but the CHECK
    // would allow a stale value and it must not make the row unusable.
    ["claimed, stale expiry: its owner", "caller", PAST, "caller", true],
    ["claimed, stale expiry: signed out", "caller", PAST, "signed-out", false],
    // The CHECK also allows a claimed row that still carries a future expiry
    // (nothing in the app writes one): it is the owner's, and only theirs.
    ["claimed, future expiry: its owner", "caller", LIVE, "caller", true],
    ["claimed, future expiry: signed out", "caller", LIVE, "signed-out", false],
    [
      "claimed, future expiry: someone else",
      "caller",
      LIVE,
      "someone-else",
      false,
    ],
  ];

  it.each(
    table.map(
      ([label, ...rest]) =>
        [`${label} -> ${rest[3] ? "usable" : "not usable"}`, ...rest] as const,
    ),
  )(
    "%s",
    async (_label, owner, expiresAt, caller, usable) => {
      const callerId = await user();
      const otherId = await user();
      const id = randomUUID();
      await world.addSession({
        id,
        userId:
          owner === "none" ? null : owner === "caller" ? callerId : otherId,
        expiresAt,
      });
      const asUser =
        caller === "signed-out"
          ? null
          : caller === "caller"
            ? callerId
            : otherId;

      const found = await repo.findValidSession(id, asUser, NOW);

      expect(found).toEqual(
        usable
          ? {
              id,
              userId: owner === "none" ? null : callerId,
            }
          : null,
      );
    },
    30_000,
  );

  it("an unknown id is null for everyone", async () => {
    const id = randomUUID();
    expect(await repo.findValidSession(id, null, NOW)).toBeNull();
    expect(await repo.findValidSession(id, await user(), NOW)).toBeNull();
  });
});

describe("createClaimedSession on real Postgres", () => {
  it("stores user_id and a NULL expires_at, which the anonymous-expiry CHECK allows", async () => {
    const userId = await user();
    const { id } = await repo.createClaimedSession(userId);

    expect(await world.getSession(id)).toEqual({
      id,
      userId,
      expiresAt: null,
    });
    // It is the owner's immediately, and nobody else's.
    expect(await repo.findValidSession(id, userId, NOW)).toEqual({
      id,
      userId,
    });
    expect(await repo.findValidSession(id, null, NOW)).toBeNull();
    expect(await repo.findValidSession(id, await user(), NOW)).toBeNull();
  });

  it("is listed in the owner's account once a scan lands in it", async () => {
    const userId = await user();
    const { id } = await repo.createClaimedSession(userId);
    const { scanId } = await repo.insertScanWithMeasurements({
      sessionId: id,
      hand: "right",
      gripStyleStated: null,
      measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
      scaleCheckRatio: null,
      measurementModelVersion: "landmark-raw-v1",
      calibrationMethod: "paper-edge",
      calibrationEvidence: {
        method: "paper-edge",
        paperSize: "a4",
        edgeFitResidualMm: 0.6,
        minSideCoverage: 0.72,
        parallaxCorrected: true,
      },
    });
    expect(await world.accountScanIds(userId)).toEqual([scanId]);
  });
});

describe("claimSession then findValidSession on real Postgres", () => {
  it("a claimed session stops being anonymous: only its owner finds it afterwards", async () => {
    const owner = await user();
    const stranger = await user();
    const id = randomUUID();
    await world.addSession({ id, userId: null, expiresAt: LIVE });

    // Before: any caller may use it (the claim is still to come).
    expect(await repo.findValidSession(id, null, NOW)).toEqual({
      id,
      userId: null,
    });

    await repo.claimSession(id, owner, NOW);

    expect(await world.getSession(id)).toEqual({
      id,
      userId: owner,
      expiresAt: null,
    });
    expect(await repo.findValidSession(id, owner, NOW)).toEqual({
      id,
      userId: owner,
    });
    expect(await repo.findValidSession(id, null, NOW)).toBeNull();
    expect(await repo.findValidSession(id, stranger, NOW)).toBeNull();
  });
});

describe("claimSession on real Postgres (the guard in its single UPDATE)", () => {
  it("never takes a session someone else already claimed", async () => {
    const owner = await user();
    const attacker = await user();
    const claimedNoExpiry = randomUUID();
    const claimedFutureExpiry = randomUUID();
    await world.addSession({
      id: claimedNoExpiry,
      userId: owner,
      expiresAt: null,
    });
    await world.addSession({
      id: claimedFutureExpiry,
      userId: owner,
      expiresAt: LIVE,
    });

    await repo.claimSession(claimedNoExpiry, attacker, NOW);
    await repo.claimSession(claimedFutureExpiry, attacker, NOW);

    expect(await world.getSession(claimedNoExpiry)).toEqual({
      id: claimedNoExpiry,
      userId: owner,
      expiresAt: null,
    });
    // Untouched means untouched: the stored expiry is not cleared either.
    expect(await world.getSession(claimedFutureExpiry)).toEqual({
      id: claimedFutureExpiry,
      userId: owner,
      expiresAt: LIVE,
    });
  });

  it("never revives an expired anonymous session (it stays anonymous and expired, not claimed and immortal)", async () => {
    const claimer = await user();
    const expired = randomUUID();
    const expiringNow = randomUUID();
    await world.addSession({ id: expired, userId: null, expiresAt: PAST });
    await world.addSession({ id: expiringNow, userId: null, expiresAt: NOW });

    await repo.claimSession(expired, claimer, NOW);
    await repo.claimSession(expiringNow, claimer, NOW);

    expect(await world.getSession(expired)).toEqual({
      id: expired,
      userId: null,
      expiresAt: PAST,
    });
    expect(await world.getSession(expiringNow)).toEqual({
      id: expiringNow,
      userId: null,
      expiresAt: NOW,
    });
  });

  it("claims an unexpired anonymous session for the caller and clears its expiry", async () => {
    const claimer = await user();
    const id = randomUUID();
    await world.addSession({ id, userId: null, expiresAt: LIVE });

    await repo.claimSession(id, claimer, NOW);

    expect(await world.getSession(id)).toEqual({
      id,
      userId: claimer,
      expiresAt: null,
    });
  });

  it("is idempotent for the same user, and still not reassignable afterwards", async () => {
    const owner = await user();
    const other = await user();
    const id = randomUUID();
    await world.addSession({ id, userId: null, expiresAt: LIVE });

    await repo.claimSession(id, owner, NOW);
    await repo.claimSession(id, owner, NOW);
    expect(await world.getSession(id)).toEqual({
      id,
      userId: owner,
      expiresAt: null,
    });

    await repo.claimSession(id, other, NOW);
    expect(await world.getSession(id)).toEqual({
      id,
      userId: owner,
      expiresAt: null,
    });
  });

  it("an unknown id is a no-op: no row is created", async () => {
    const before = await world.sessionCount();
    await repo.claimSession(randomUUID(), await user(), NOW);
    expect(await world.sessionCount()).toBe(before);
  });
});
