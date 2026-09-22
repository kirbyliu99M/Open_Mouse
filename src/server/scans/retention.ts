/**
 * The anonymous-scan deletion promise (issue #32), and the arithmetic that
 * keeps it true.
 *
 * `/account` promises physical deletion of an anonymous scan within 24 hours
 * of when the scan was made — not from closing the browser, which the
 * server cannot observe. The mechanism that keeps this true has three parts,
 * and their worst case must sum to at most the promise:
 *
 *   SESSION_TTL_MS               how long a session lives before
 *                                 `isExpiredAnonymousSession` (expiry.ts)
 *                                 counts it as expired, measured from
 *                                 creation (submit.ts)
 * + GITHUB_SWEEP_INTERVAL_MS      how often the GitHub Actions workflow
 *                                 (.github/workflows/expire-sessions.yml) is
 *                                 *scheduled* to call
 *                                 GET /api/cron/expire-sessions
 * + GITHUB_SCHEDULER_SLACK_MS     budgeted worst-case lateness of that
 *                                 schedule — GitHub gives no SLA for when a
 *                                 scheduled workflow actually starts
 * ---------------------------------
 * = MAX_ANONYMOUS_RETENTION_MS    must be <= ANONYMOUS_PRIVACY_PROMISE_MS
 *
 * `tests/unit/retention.test.ts` asserts that inequality with these actual
 * constants (not restated numbers), and also parses the *real* cron string
 * out of the workflow file so a schedule edited there without touching this
 * file — or a constant edited here without touching the workflow — fails
 * CI instead of silently making the account-page copy false again.
 *
 * The lazy sweep (`sweep.ts`, throttled to once a minute per warm instance)
 * and "expired means gone" on reads (`expiry.ts`) still run underneath all
 * of this; they make the *effective* retention shorter under real traffic.
 * This bound is the worst case: zero traffic, nobody's beacon fires, and the
 * only thing standing between a session and 24 hours is the schedule below.
 */

/** The promise made in the UI (`src/app/account/page.tsx`). */
export const ANONYMOUS_PRIVACY_PROMISE_MS = 24 * 60 * 60 * 1000;

/**
 * How long an anonymous session lives before it counts as expired, measured
 * from creation. 22h30m, not 24h — the remaining 90 minutes of headroom is
 * spent below on the GitHub sweep's interval and its scheduling slack.
 */
export const SESSION_TTL_MS = 22 * 60 * 60 * 1000 + 30 * 60 * 1000;

/**
 * The GitHub Actions schedule in `.github/workflows/expire-sessions.yml`
 * (every-30-minutes step syntax, i.e. an asterisk, a slash, then 30, then
 * four more asterisks). Kept in lockstep with that file by
 * `tests/unit/retention.test.ts`, which parses the workflow's actual cron
 * string rather than trusting this number to stay in sync by hand.
 *
 * 30 minutes, not something tighter, is a cost tradeoff: this is a private
 * repository, so every scheduled run bills at least one Actions minute
 * against the free 2,000/month. 30 minutes costs roughly 1,440-1,488
 * minutes/month (48 runs/day * 30 or 31 days) — under the free tier, with
 * room left for the existing CI workflow. See the PR for the full budget.
 */
export const GITHUB_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Budgeted worst-case lateness of a GitHub Actions scheduled run. GitHub's
 * own docs say scheduled workflows "can be delayed during periods of high
 * loads of GitHub Actions workflow runs" and publish no upper bound or SLA.
 * 45 minutes is an engineering judgment call, not a guarantee: if GitHub's
 * scheduler is ever late by more than this — documented as rare, e.g.
 * during platform incidents — this bound stops holding for whichever
 * session(s) were caught in that window. The daily Vercel cron
 * (`vercel.json`) and the lazy sweep (`sweep.ts`) are the remaining
 * backstops in that case; they bound it again, just not within 24h.
 */
export const GITHUB_SCHEDULER_SLACK_MS = 45 * 60 * 1000;

/** The worst-case time from a scan's creation to its physical deletion. */
export const MAX_ANONYMOUS_RETENTION_MS =
  SESSION_TTL_MS + GITHUB_SWEEP_INTERVAL_MS + GITHUB_SCHEDULER_SLACK_MS;

/**
 * Extracts the interval, in minutes, from an every-N-minutes step-syntax
 * cron schedule string (asterisk, slash, N, then four more asterisks) — the
 * only form `expire-sessions.yml` uses. Returns `null` for anything else (an
 * hourly schedule, a fixed-minute list, a step on a different field,
 * garbage) so the caller can fail loudly on a schedule it can't reason
 * about instead of silently accepting one that no longer matches
 * `GITHUB_SWEEP_INTERVAL_MS`.
 */
export function parseEveryNMinutesCron(schedule: string): number | null {
  const match = /^\*\/(\d{1,2}) \* \* \* \*$/.exec(schedule.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 59 ? n : null;
}
