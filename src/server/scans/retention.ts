/**
 * The anonymous-scan deletion promise (issue #32), and the arithmetic that
 * keeps it true.
 *
 * `/account` promises physical deletion of an anonymous scan within 24 hours
 * of when the scan was made — not from closing the browser, which the
 * server cannot observe. The mechanism that keeps this true has four parts,
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
 * + GITHUB_MISSED_TICK_BUDGET_MS  budgets one tick that starts on time but
 *                                 still fails outright (all in-step retries
 *                                 exhausted) — the next successful sweep is
 *                                 then a full interval later
 * + GITHUB_SCHEDULER_SLACK_MS     budgeted worst-case lateness of a
 *                                 scheduled run that does start — GitHub
 *                                 gives no SLA for when one actually begins
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
 * from creation. 20h30m, not 24h — the remaining 3h30m of headroom is spent
 * below on the GitHub sweep's interval, one wholly-missed tick, and its
 * scheduling slack.
 */
export const SESSION_TTL_MS = 20 * 60 * 60 * 1000 + 30 * 60 * 1000;

/**
 * How often the GitHub Actions workflow
 * (`.github/workflows/expire-sessions.yml`) is *scheduled* to call
 * `GET /api/cron/expire-sessions`: hourly. Kept in lockstep with that file
 * by `tests/unit/retention.test.ts`, which parses the workflow's actual cron
 * string rather than trusting this number to stay in sync by hand.
 *
 * Hourly, not every 30 minutes, is a cost tradeoff: this is a private
 * repository, so every scheduled run bills at least one Actions minute
 * against the free 2,000/month, and the existing CI workflow already draws
 * on the same budget (223 runs over the 30 days before this change,
 * averaging 1.7 billed minutes each — roughly 380/month, though that varies
 * with how often the repo is pushed to). Hourly costs roughly 720-744
 * minutes/month (24 runs/day * 30 or 31 days); every 30 minutes would cost
 * about double that, close enough to CI's own draw on the same 2,000-minute
 * allowance to risk exhausting it — and if the allowance runs out, CI *and*
 * this sweep both stop, silently reopening the gap this file exists to
 * close. See the PR for the full budget.
 */
export const GITHUB_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The minute past the hour the workflow runs at (17, not 0 or 30): GitHub's
 * scheduled runs are documented to be most delayed right at the top of the
 * hour, when the platform-wide volume of "on the hour" cron schedules is
 * highest. Landing away from that peak (and away from the equally common
 * :30 mark) doesn't change the slack *budget* below, but it's a free way to
 * reduce how often a run actually needs that budget.
 */
export const GITHUB_SWEEP_MINUTE = 17;

/**
 * Budgets one scheduled tick that starts on time but still fails outright:
 * a cold Vercel invocation past the step's `curl --max-time`, a transient
 * 5xx, a network blip. The workflow retries up to 3 times with a short
 * backoff before giving up (see `expire-sessions.yml`), but there's no
 * cross-run retry — if every attempt in a tick fails, the next *successful*
 * sweep is a full `GITHUB_SWEEP_INTERVAL_MS` later, not immediately after.
 * Set equal to the interval itself: budgeting for exactly one such tick,
 * not a run of them (the residual gap below covers what happens beyond
 * that).
 */
export const GITHUB_MISSED_TICK_BUDGET_MS = GITHUB_SWEEP_INTERVAL_MS;

/**
 * Budgeted worst-case lateness of a GitHub Actions scheduled run *starting*
 * (as opposed to failing once started, which `GITHUB_MISSED_TICK_BUDGET_MS`
 * covers). GitHub's own docs say scheduled workflows "can be delayed during
 * periods of high loads of GitHub Actions workflow runs" and publish no
 * upper bound or SLA. 45 minutes is an engineering judgment call, not a
 * guarantee: the residual gap this leaves is two consecutive failed ticks
 * (this budget only covers one), or GitHub's scheduler itself being down
 * (a platform-wide outage, not just an ordinary delayed run) — either is
 * documented as rare. The daily Vercel cron (`vercel.json`) and the lazy
 * sweep (`sweep.ts`) are the remaining backstops in that case; they bound
 * it again, just not within 24h.
 */
export const GITHUB_SCHEDULER_SLACK_MS = 45 * 60 * 1000;

/** The worst-case time from a scan's creation to its physical deletion. */
export const MAX_ANONYMOUS_RETENTION_MS =
  SESSION_TTL_MS +
  GITHUB_SWEEP_INTERVAL_MS +
  GITHUB_MISSED_TICK_BUDGET_MS +
  GITHUB_SCHEDULER_SLACK_MS;

/**
 * Extracts the minute-past-the-hour from an hourly, single-fixed-minute cron
 * schedule string of the form `"M * * * *"` (minute fixed, every other
 * field a bare `*`) — the only form `expire-sessions.yml` uses. Returns
 * `null` for anything else (a step schedule, a non-hourly schedule, a fixed
 * hour or day-of-month, garbage) so the caller can fail loudly on a
 * schedule it can't reason about instead of silently accepting one that no
 * longer runs once per hour, every hour — which is what makes
 * `GITHUB_SWEEP_INTERVAL_MS` a fixed 60 minutes rather than something this
 * function would need to compute.
 */
export function parseHourlyCronMinute(schedule: string): number | null {
  const match = /^(\d{1,2}) \* \* \* \*$/.exec(schedule.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  return minute >= 0 && minute <= 59 ? minute : null;
}
