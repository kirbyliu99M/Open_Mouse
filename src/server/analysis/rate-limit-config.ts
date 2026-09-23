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
