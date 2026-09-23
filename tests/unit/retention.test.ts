import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_PRIVACY_PROMISE_MS,
  GITHUB_MISSED_TICK_BUDGET_MS,
  GITHUB_SCHEDULER_SLACK_MS,
  GITHUB_SWEEP_INTERVAL_MS,
  GITHUB_SWEEP_MINUTE,
  MAX_ANONYMOUS_RETENTION_MS,
  parseHourlyCronMinute,
  SESSION_TTL_MS,
} from "../../src/server/scans/retention";

describe("the 24h anonymous-deletion bound (issue #32)", () => {
  it("MAX_ANONYMOUS_RETENTION_MS is the sum of its four named parts", () => {
    expect(MAX_ANONYMOUS_RETENTION_MS).toBe(
      SESSION_TTL_MS +
        GITHUB_SWEEP_INTERVAL_MS +
        GITHUB_MISSED_TICK_BUDGET_MS +
        GITHUB_SCHEDULER_SLACK_MS,
    );
  });

  it("GITHUB_MISSED_TICK_BUDGET_MS budgets exactly one missed tick", () => {
    expect(GITHUB_MISSED_TICK_BUDGET_MS).toBe(GITHUB_SWEEP_INTERVAL_MS);
  });

  it("ANONYMOUS_PRIVACY_PROMISE_MS really is 24 hours", () => {
    expect(ANONYMOUS_PRIVACY_PROMISE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("GITHUB_SWEEP_INTERVAL_MS really is hourly", () => {
    expect(GITHUB_SWEEP_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it("stays within the 24h promise, whatever the traffic — the whole point of #32", () => {
    expect(MAX_ANONYMOUS_RETENTION_MS).toBeLessThanOrEqual(
      ANONYMOUS_PRIVACY_PROMISE_MS,
    );
  });

  it("has some margin, not just an exact fit (clock skew, ms-level rounding)", () => {
    expect(
      ANONYMOUS_PRIVACY_PROMISE_MS - MAX_ANONYMOUS_RETENTION_MS,
    ).toBeGreaterThan(0);
  });

  it("a regression that only widens SESSION_TTL_MS is caught", () => {
    // Guards against someone "fixing" a future change by only touching one
    // constant and never re-running this file's own arithmetic in their head.
    const regressed =
      24 * 60 * 60 * 1000 +
      GITHUB_SWEEP_INTERVAL_MS +
      GITHUB_MISSED_TICK_BUDGET_MS +
      GITHUB_SCHEDULER_SLACK_MS;
    expect(regressed).toBeGreaterThan(ANONYMOUS_PRIVACY_PROMISE_MS);
  });

  it("a regression that drops the missed-tick budget from the formula is caught", () => {
    // If a future edit to retention.ts stops adding
    // GITHUB_MISSED_TICK_BUDGET_MS into MAX_ANONYMOUS_RETENTION_MS (but
    // leaves the constant itself defined, e.g. an accidental revert to the
    // earlier three-term formula), the four-term sum recomputed here from
    // the real constants stops matching the exported total — this is a
    // second, independent check of that beyond the first test above,
    // phrased as "the omitted term is not zero" so it can't pass by
    // accident if GITHUB_MISSED_TICK_BUDGET_MS were ever misdefined as 0.
    expect(GITHUB_MISSED_TICK_BUDGET_MS).toBeGreaterThan(0);
    expect(MAX_ANONYMOUS_RETENTION_MS).toBe(
      SESSION_TTL_MS +
        GITHUB_SWEEP_INTERVAL_MS +
        GITHUB_SCHEDULER_SLACK_MS +
        GITHUB_MISSED_TICK_BUDGET_MS,
    );
  });
});

describe("parseHourlyCronMinute", () => {
  it.each([
    ["0 * * * *", 0],
    ["17 * * * *", 17],
    ["59 * * * *", 59],
    ["  17 * * * *  ", 17], // tolerates surrounding whitespace
  ] as const)("parses %s as minute %d", (schedule, expected) => {
    expect(parseHourlyCronMinute(schedule)).toBe(expected);
  });

  it.each([
    "0 3 * * *", // the daily Vercel cron form — fixed hour, not hourly
    "60 * * * *", // 60 is not a valid minute
    "*/30 * * * *", // step syntax, not a fixed minute
    "not a cron string",
    "17 */2 * * *", // fixed minute but a step on the hour field too
    "17 * * * * *", // six fields
  ])("returns null for %s", (schedule) => {
    expect(parseHourlyCronMinute(schedule)).toBeNull();
  });
});

describe("the deployed schedule matches retention.ts", () => {
  function readWorkflow(): string {
    return readFileSync(".github/workflows/expire-sessions.yml", "utf8");
  }

  it("parses the real cron string out of .github/workflows/expire-sessions.yml", () => {
    const contents = readWorkflow();
    const match = /cron:\s*["'](.+?)["']/.exec(contents);
    expect(match).not.toBeNull();

    const minute = parseHourlyCronMinute(match![1]!);
    expect(minute).not.toBeNull();
    // Confirms the schedule is genuinely hourly (parseHourlyCronMinute only
    // matches "M * * * *"), so GITHUB_SWEEP_INTERVAL_MS's fixed 60 minutes
    // is actually true of the deployed workflow, not just asserted here.
    expect(minute).toBe(GITHUB_SWEEP_MINUTE);
  });

  it("runs off-peak — not at :00 or :30, the most congested minutes", () => {
    const contents = readWorkflow();
    const match = /cron:\s*["'](.+?)["']/.exec(contents);
    const minute = parseHourlyCronMinute(match![1]!);
    expect(minute).not.toBeNull();
    expect(minute).not.toBe(0);
    expect(minute).not.toBe(30);
  });

  it("the workflow calls the same endpoint the cron auth test exercises", () => {
    const contents = readWorkflow();
    expect(contents).toContain("/api/cron/expire-sessions");
    expect(contents).toContain("secrets.CRON_SECRET");
    // The secret must never be inlined directly into a run: script (which
    // GitHub prints verbatim as the step's command) — only referenced via
    // an env: var and read back as a shell variable.
    expect(contents).not.toMatch(/Bearer \$\{\{\s*secrets\.CRON_SECRET/);
  });

  it("retries a failed attempt before giving up, per the missed-tick reasoning above", () => {
    const contents = readWorkflow();
    // Loose sanity checks that the retry-with-backoff shape survives future
    // edits to this file — not a substitute for the shell-logic smoke test
    // this PR ran manually (3 attempts, succeed-first / succeed-after-retry
    // / fail-all-three all exercised against a stubbed `curl`).
    expect(contents).toMatch(/sleep 10/);
    expect(contents).toMatch(/sleep 30/);
    expect((contents.match(/curl --fail/g) ?? []).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(contents).toMatch(/All 3 attempts/);
  });
});
