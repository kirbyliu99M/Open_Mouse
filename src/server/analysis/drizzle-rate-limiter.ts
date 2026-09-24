/**
 * The real, DB-backed `RateLimiter` (`./handler`'s interface), over the
 * `rate_limits` table. Works on serverless: unlike an in-memory limiter,
 * every instance shares the same row per key, because the count lives in
 * Neon, not in process memory.
 *
 * A single `INSERT ... ON CONFLICT (key) DO UPDATE` statement is the atomic
 * upsert-increment: the whole read-decide-write happens as one round trip
 * the database executes under a per-row lock, so two concurrent requests
 * for the same key can never both read the same stale count and both decide
 * "allowed" (the race a separate SELECT-then-INSERT/UPDATE would have). The
 * `CASE` expressions below encode exactly `decideRateLimit`'s same-window
 * (increment) vs. new-window (reset to 1) logic from `./rate-limit.ts` in
 * SQL; that file has the pure, unit-tested version of this same decision.
 *
 * Not unit-tested directly against a live Neon connection — same as
 * `src/server/scans/drizzle-repo.ts`: there is no live database in CI.
 * `./rate-limit.ts`'s `computeWindowStart`, `decideRateLimit` and
 * `hashRateLimitKey` carry the tested logic this mirrors; a PGlite (real
 * Postgres, in-process) test covers this file end to end —
 * `tests/unit/rate-limit-db.test.ts`.
 *
 * `key` is never stored raw (L2 hardening finding): every key is run
 * through `hashRateLimitKey` first, so `rate_limits` never holds a
 * plaintext IP. See that function for the HMAC-vs-fallback-salt split.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { rateLimits } from "../../db/schema";
import type { RateLimiter } from "./handler";
import { computeWindowStart, hashRateLimitKey } from "./rate-limit";

let warnedMissingKeySecret = false;

/**
 * Reads `RATE_LIMIT_KEY_SECRET` fresh on every call (not module load) so
 * tests can flip it between calls, then hashes with it. Logs the missing-
 * secret warning at most once per process — this is the one place in the
 * rate-limit code that touches `process.env` or `console`, kept out of the
 * pure `hashRateLimitKey` so that stays a plain function of its arguments.
 */
function hashKeyForStorage(key: string): string {
  const secret = process.env.RATE_LIMIT_KEY_SECRET;
  if (!secret && !warnedMissingKeySecret) {
    warnedMissingKeySecret = true;
    console.warn(
      "RATE_LIMIT_KEY_SECRET is not set; rate-limit keys are hashed with a " +
        "fixed, non-secret salt instead. Set RATE_LIMIT_KEY_SECRET in production.",
    );
  }
  return hashRateLimitKey(key, secret);
}

export interface DrizzleRateLimiterOptions {
  /** Fixed-window length, in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window (inclusive). */
  limit: number;
  /**
   * Namespaces this limiter's keys from every OTHER limiter instance that
   * shares the `rate_limits` table (PR #56 review, HIGH 1). Every call site
   * keys `.allow()` on the caller's IP (`resolveClientIp`), and the submit,
   * fit and per-IP analysis limits are three *separate* limiter instances
   * over that same IP — without a distinct prefix per instance, they all
   * hash to the same stored row and silently share one combined budget
   * (reproduced in `tests/unit/rate-limit-db.test.ts`: one submit call plus
   * four fit calls left only one call of "budget" for the analysis limiter,
   * which had never itself been consulted). Required, not optional, so a
   * new call site can't forget it — e.g. `"submit:"`, `"fit:"`,
   * `"analysis:"`. Applied to the raw key BEFORE hashing, so distinct
   * prefixes produce entirely distinct, unlinkable hashes, not just
   * distinct plaintext (which nothing downstream ever sees anyway). The
   * global daily model cap (`globalModelCallRateLimitKey`) already
   * embeds its own namespace in the key text itself (`global:analysis:
   * <date>`), so its call site passes `""` here deliberately — not an
   * oversight.
   */
  keyPrefix: string;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => number;
  db?: ReturnType<typeof getDb>;
}

export function createDrizzleRateLimiter(
  options: DrizzleRateLimiterOptions,
): RateLimiter {
  const {
    windowMs,
    limit,
    keyPrefix,
    now = () => Date.now(),
    db = getDb(),
  } = options;

  return {
    async allow(key: string): Promise<boolean> {
      const hashedKey = hashKeyForStorage(`${keyPrefix}${key}`);
      const windowStart = computeWindowStart(now(), windowMs);
      const [row] = await db
        .insert(rateLimits)
        .values({ key: hashedKey, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            // Same window as the stored row: increment. A new window:
            // reset to 1 — this request is the first one in it.
            count: sql`CASE WHEN ${rateLimits.windowStart} = ${windowStart} THEN ${rateLimits.count} + 1 ELSE 1 END`,
            windowStart: sql`CASE WHEN ${rateLimits.windowStart} = ${windowStart} THEN ${rateLimits.windowStart} ELSE ${windowStart} END`,
          },
        })
        .returning({ count: rateLimits.count });
      return row.count <= limit;
    },
  };
}
