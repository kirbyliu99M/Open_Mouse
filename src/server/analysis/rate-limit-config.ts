/**
 * The analysis route's per-IP fixed-window limit (issue #39). Named
 * constants so the number is asserted by a test and changed in one place,
 * rather than inlined at the route.
 *
 * Chosen against PLAN §M5's cost table, using its more conservative,
 * post-2027-01-01 rate ($0.022/analysis — the rates double on that date).
 * A cache hit (identical fit: same measurements rounded to 1 mm, same grip
 * style, same top-3 mice) costs nothing, so this bounds what one IP can
 * force in real, uncached model calls even if it varies its measurements
 * or scan every request specifically to dodge the cache:
 *
 *   5 calls / 10 min → worst case ~$0.11 per window, ~$0.66/hour per IP.
 *
 * A legitimate caller views one scan's results and tries at most a
 * handful of preference combinations (grip style, weight range) in that
 * time — comfortably inside the cap — while a script hammering the route
 * is capped at a cost that stays well under the budget alarm PLAN §M5
 * also calls for (Kirby's to wire up).
 */
export const ANALYSIS_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const ANALYSIS_RATE_LIMIT_MAX = 5;

/**
 * Site-wide daily cap on real Gemini model calls (M1 hardening finding).
 * The per-IP limit above bounds one caller; nothing previously bounded the
 * *sum* across every caller, so enough distinct IPs (or one behind a
 * rotating pool) could still run up spend without ever tripping it. This
 * cap is the backstop: once the whole site has made this many real model
 * calls today (UTC calendar day — see `globalModelCallRateLimitKey`), every
 * further request is served the deterministic, free fallback instead —
 * never a 429, since a cap on *cost* is not a reason to break the product
 * for anyone still using it (`handleAnalysisRequest`, `./handler.ts`).
 *
 * Overridable via `ANALYSIS_DAILY_MODEL_CAP` (see `parseAnalysisDailyModelCap`).
 */
export const ANALYSIS_DAILY_MODEL_CAP_DEFAULT = 500;

/** The global cap's fixed window: one UTC calendar day. */
export const ANALYSIS_DAILY_MODEL_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Parses `ANALYSIS_DAILY_MODEL_CAP` into a positive integer cap. `undefined`
 * (unset) or anything that isn't a positive integer — non-numeric, zero,
 * negative, fractional — falls back to `ANALYSIS_DAILY_MODEL_CAP_DEFAULT`
 * rather than disabling or zeroing the cap; a malformed env value must fail
 * toward the safe default, never toward "no limit" or "always fallback".
 */
export function parseAnalysisDailyModelCap(value: string | undefined): number {
  if (value === undefined) return ANALYSIS_DAILY_MODEL_CAP_DEFAULT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return ANALYSIS_DAILY_MODEL_CAP_DEFAULT;
  }
  return parsed;
}

/**
 * The global cap's rate-limit key, scoped to one UTC calendar day so the
 * cap resets at UTC midnight and a cron sweep (L2) can later delete any
 * day's row once it is no longer today's. Deliberately date-stamped in the
 * key itself (rather than relying only on the fixed-window math in
 * `./rate-limit.ts`) so the stored row is self-describing when inspected.
 */
export function globalModelCallRateLimitKey(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `global:analysis:${yyyy}-${mm}-${dd}`;
}
