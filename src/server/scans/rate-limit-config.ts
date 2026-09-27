/**
 * Per-IP fixed-window limits for the two write-ish scan routes that had none
 * (M2 hardening finding): `POST /api/scans` (a submission creates a session
 * and a scan row) and `POST /api/scans/{scanId}/fit` (recomputes and persists
 * `fit_results`). Named constants, one file, same pattern as
 * `../analysis/rate-limit-config.ts`.
 *
 * Both reuse the DB-backed fixed-window limiter (`../analysis/drizzle-rate-limiter.ts`)
 * and the same trusted-IP source as the analysis route
 * (`../analysis/ip.ts`'s `resolveClientIp`), so a caller cannot dodge any of
 * the three limits by rotating which endpoint it hits from behind the same
 * IP.
 */
export const SCAN_SUBMIT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const SCAN_SUBMIT_RATE_LIMIT_MAX = 20;

export const FIT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const FIT_RATE_LIMIT_MAX = 60;

/**
 * Structurally identical to `../analysis/handler.ts`'s `RateLimiter` —
 * duplicated here (rather than imported) so `scans`/`fit` don't take a
 * dependency on the `analysis` domain for a one-method interface; anything
 * implementing one satisfies the other.
 */
export interface RateLimiter {
  /** Returns true when the request at `key` is allowed to proceed. */
  allow(key: string): boolean | Promise<boolean>;
}

/**
 * How long a `rate_limits` row is kept after its window's start (L2
 * hardening finding — rows are swept on the same cron path as expired
 * sessions, `../scans/expire-cron.ts`). Every limiter in this app uses a
 * window no longer than `ANALYSIS_DAILY_MODEL_CAP_WINDOW_MS` (one UTC day —
 * `../analysis/rate-limit-config.ts`), so any row whose `windowStart` is
 * older than that is guaranteed to belong to a window that has already
 * ended, for every limiter, without the table needing to record which
 * limiter (and therefore which window length) wrote it.
 */
export const RATE_LIMIT_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Pure predicate mirrored in SQL by `createDrizzleScanRepo`'s
 * `deleteEndedRateLimitWindows` (`./drizzle-repo.ts`) — same split as
 * `./expiry.ts`'s `isExpiredAnonymousSession`. A row's window has
 * (conservatively) ended once its `windowStart` is more than
 * `RATE_LIMIT_ROW_RETENTION_MS` in the past.
 */
export function isEndedRateLimitWindow(
  row: { windowStart: number },
  nowMs: number,
): boolean {
  return nowMs - row.windowStart >= RATE_LIMIT_ROW_RETENTION_MS;
}
