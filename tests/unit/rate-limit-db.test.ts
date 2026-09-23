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
      db: db as unknown as LimiterDb,
    });

    expect(await limiter.allow("203.0.113.5")).toBe(true);
    expect(await limiter.allow("203.0.113.5")).toBe(true);
    expect(await limiter.allow("203.0.113.5")).toBe(false);
    expect(await rateLimitKeys(pg)).toHaveLength(1);

    await pg.close();
  });
});
