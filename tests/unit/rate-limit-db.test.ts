/**
 * `rate_limits` against a real Postgres (PGlite): the cron's extra DELETE
 * (L2 hardening finding) actually removes rows whose window has ended and
 * actually keeps rows still inside their window, and the DB-backed limiter
 * never stores a caller's raw key.
 */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDrizzleRateLimiter } from "../../src/server/analysis/drizzle-rate-limiter";
import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import { RATE_LIMIT_ROW_RETENTION_MS } from "../../src/server/scans/rate-limit-config";
import { migratedDatabase } from "./fixtures/pglite";

type ScanDb = Parameters<typeof createDrizzleScanRepo>[0];
type LimiterDb = Parameters<typeof createDrizzleRateLimiter>[0]["db"];

async function insertRateLimitRow(
  pg: PGlite,
  key: string,
  windowStart: number,
  count = 1,
): Promise<void> {
  await pg.query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, $3)`,
    [key, windowStart, count],
  );
}

async function rateLimitKeys(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ key: string }>(
    `SELECT key FROM rate_limits ORDER BY key`,
  );
  return rows.map((r) => r.key);
}

describe("createDrizzleScanRepo().deleteEndedRateLimitWindows", () => {
  it("deletes rows whose window ended and keeps rows still inside a current window", async () => {
    const { pg, db } = await migratedDatabase();
    const repo = createDrizzleScanRepo(db as unknown as ScanDb);
    const now = new Date("2026-09-24T12:00:00Z");
    const nowMs = now.getTime();

    // Long past its window (e.g. a stale per-IP or global-cap row).
    await insertRateLimitRow(
      pg,
      "ended-old",
      nowMs - RATE_LIMIT_ROW_RETENTION_MS * 10,
    );
    // Exactly at the retention boundary — inclusive, so this has ended too.
    await insertRateLimitRow(
      pg,
      "ended-boundary",
      nowMs - RATE_LIMIT_ROW_RETENTION_MS,
    );
    // Still within its window (e.g. today's global daily cap row).
    await insertRateLimitRow(pg, "current-recent", nowMs - 60_000);
    // A brand-new row, this instant.
    await insertRateLimitRow(pg, "current-fresh", nowMs);

    const deletedCount = await repo.deleteEndedRateLimitWindows(now);

    expect(deletedCount).toBe(2);
    expect(await rateLimitKeys(pg)).toEqual([
      "current-fresh",
      "current-recent",
    ]);

    await pg.close();
  });

  it("is a no-op (returns 0) when every row is still current", async () => {
    const { pg, db } = await migratedDatabase();
    const repo = createDrizzleScanRepo(db as unknown as ScanDb);
    const now = new Date("2026-09-24T12:00:00Z");

    await insertRateLimitRow(pg, "current", now.getTime());

    expect(await repo.deleteEndedRateLimitWindows(now)).toBe(0);
    expect(await rateLimitKeys(pg)).toEqual(["current"]);

    await pg.close();
  });
});

describe("createDrizzleRateLimiter — never stores the raw key (L2 hardening)", () => {
  it("stores a hash, not the plaintext IP, as rate_limits.key", async () => {
    const { pg, db } = await migratedDatabase();
    const limiter = createDrizzleRateLimiter({
      windowMs: 10 * 60 * 1000,
      limit: 5,
      keyPrefix: "submit:",
      db: db as unknown as LimiterDb,
    });

    await limiter.allow("203.0.113.5");

    const keys = await rateLimitKeys(pg);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe("203.0.113.5");
    expect(keys[0]).not.toContain("203.0.113.5");
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);

    await pg.close();
  });

  it("increments the same stored row for repeat calls with the same key, within the limit", async () => {
    const { pg, db } = await migratedDatabase();
    const limiter = createDrizzleRateLimiter({
      windowMs: 10 * 60 * 1000,
      limit: 2,
      now: () => new Date("2026-09-24T12:00:00Z").getTime(),
      keyPrefix: "submit:",
      db: db as unknown as LimiterDb,
    });

    expect(await limiter.allow("203.0.113.5")).toBe(true);
    expect(await limiter.allow("203.0.113.5")).toBe(true);
    expect(await limiter.allow("203.0.113.5")).toBe(false);
    expect(await rateLimitKeys(pg)).toHaveLength(1);

    await pg.close();
  });
});

describe("createDrizzleRateLimiter — keyPrefix namespaces limiters sharing a caller key (PR #56 HIGH 1)", () => {
  /**
   * Reproduces the reviewer's finding exactly: submit, fit and analysis all
   * key their limiter on the same caller IP. Without a distinct prefix per
   * limiter, one `submit:`-less call plus four `fit:`-less calls (all the
   * SAME underlying key) already spend 5 of the analysis limiter's budget
   * before the caller has made a single analysis request — the analysis
   * limiter refuses a request it has never itself counted.
   */
  it("one submit call and four fit calls do not spend the analysis limiter's own budget", async () => {
    const { db } = await migratedDatabase();
    const now = () => new Date("2026-09-24T12:00:00Z").getTime();
    const sharedOptions = {
      windowMs: 10 * 60 * 1000,
      now,
      db: db as unknown as LimiterDb,
    };
    const submitLimiter = createDrizzleRateLimiter({
      ...sharedOptions,
      limit: 20,
      keyPrefix: "submit:",
    });
    const fitLimiter = createDrizzleRateLimiter({
      ...sharedOptions,
      limit: 60,
      keyPrefix: "fit:",
    });
    const analysisLimiter = createDrizzleRateLimiter({
      ...sharedOptions,
      limit: 5,
      keyPrefix: "analysis:",
    });
    const ip = "203.0.113.5";

    expect(await submitLimiter.allow(ip)).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(await fitLimiter.allow(ip)).toBe(true);
    }

    // The analysis limiter has never been consulted for this IP before —
    // its own first call must be allowed regardless of submit/fit traffic.
    expect(await analysisLimiter.allow(ip)).toBe(true);
  });

  it("two limiters with different prefixes each get their own 5-call budget for the same key", async () => {
    const { db } = await migratedDatabase();
    const now = () => new Date("2026-09-24T12:00:00Z").getTime();
    const sharedOptions = {
      windowMs: 10 * 60 * 1000,
      limit: 5,
      now,
      db: db as unknown as LimiterDb,
    };
    const limiterA = createDrizzleRateLimiter({
      ...sharedOptions,
      keyPrefix: "a:",
    });
    const limiterB = createDrizzleRateLimiter({
      ...sharedOptions,
      keyPrefix: "b:",
    });
    const ip = "203.0.113.5";

    for (let i = 0; i < 5; i++) {
      expect(await limiterA.allow(ip)).toBe(true);
    }
    expect(await limiterA.allow(ip)).toBe(false);

    // limiterB has its own budget for the same key — unaffected by limiterA
    // having just spent all 5 of its own.
    for (let i = 0; i < 5; i++) {
      expect(await limiterB.allow(ip)).toBe(true);
    }
    expect(await limiterB.allow(ip)).toBe(false);
  });
});
