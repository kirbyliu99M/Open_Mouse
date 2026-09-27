/**
 * Fixed-window rate limiting, split into a pure decision (this file, unit
 * tested, no database) and a DB-backed `RateLimiter` (`./drizzle-rate-limiter`)
 * whose atomic upsert mirrors this exactly in SQL — same split as
 * `src/server/scans/expiry.ts` (pure predicate) and `drizzle-repo.ts` (the
 * SQL that mirrors it).
 *
 * An in-memory limiter is per-instance and does not hold on Vercel, where
 * each invocation can land on a different instance — the whole point of a
 * DB-backed limiter is that every instance shares one row per key.
 */
import { createHash, createHmac } from "node:crypto";

/** A key's rate-limit row, as currently stored (or `null` if none exists yet). */
export interface RateLimitState {
  /** Epoch-ms start of the window this count belongs to. */
  windowStart: number;
  count: number;
}

export interface RateLimitDecision extends RateLimitState {
  /** True when this request (the one that produced `count`) may proceed. */
  allow: boolean;
}

/**
 * The fixed window a given instant falls into: the largest multiple of
 * `windowMs` not greater than `nowMs`. Deterministic and pure — two calls
 * with the same `nowMs`/`windowMs` always agree on the same window, which is
 * what lets independent, concurrent requests hitting different serverless
 * instances land on the same window boundary for the same key.
 */
export function computeWindowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

/**
 * The fixed-window decision: given the row currently stored for a key (or
 * `null` if this is the first request ever seen for it), the current time,
 * the window length and the per-window limit, returns the row state to
 * persist and whether this request is allowed.
 *
 * A request in the same window as the stored row increments its count; a
 * request in a new window resets the count to 1 (the request itself always
 * counts). `allow` is true exactly when the resulting count is within the
 * limit — the boundary case (`count === limit`) is allowed, `count > limit`
 * is not.
 *
 * `./drizzle-rate-limiter.ts`'s single `INSERT ... ON CONFLICT DO UPDATE`
 * statement encodes this same same-window-or-reset logic directly in SQL so
 * the read-decide-write is one atomic round trip — see the comment there for
 * why a separate read then write would race under concurrent requests.
 */
export function decideRateLimit(
  existing: RateLimitState | null,
  nowMs: number,
  windowMs: number,
  limit: number,
): RateLimitDecision {
  const windowStart = computeWindowStart(nowMs, windowMs);
  const sameWindow = existing !== null && existing.windowStart === windowStart;
  const count = sameWindow ? existing.count + 1 : 1;
  return { windowStart, count, allow: count <= limit };
}

/**
 * Fixed, app-specific salt for `hashRateLimitKey`'s fallback path only (no
 * `RATE_LIMIT_KEY_SECRET` configured). It is not a secret — it exists only
 * so the fallback hash isn't a bare, rainbow-table-able `sha256(ip)`, not to
 * withstand a targeted attack. Configure `RATE_LIMIT_KEY_SECRET` for that.
 */
export const RATE_LIMIT_FALLBACK_SALT = "open-mouse:rate-limit:v1";

/**
 * `rate_limits.key` stores a hash of the caller's IP (or other identity),
 * never the raw value, so the table isn't a plaintext log of who made which
 * request (L2 hardening finding). With `secret` set (`RATE_LIMIT_KEY_SECRET`
 * in production), this is HMAC-SHA256 keyed on it — unforgeable and
 * un-reversible without the secret. Without one, it falls back to a plain
 * SHA-256 of the fixed salt plus the key: still not a plaintext IP, but
 * reversible by brute force since the "secret" is public (this source
 * file). The caller (`./drizzle-rate-limiter.ts`) is responsible for
 * sourcing `secret` from the environment and logging (once) when it falls
 * back — this function itself is pure and never logs.
 */
export function hashRateLimitKey(
  key: string,
  secret: string | undefined,
): string {
  if (secret) {
    return createHmac("sha256", secret).update(key).digest("hex");
  }
  return createHash("sha256")
    .update(`${RATE_LIMIT_FALLBACK_SALT}:${key}`)
    .digest("hex");
}
