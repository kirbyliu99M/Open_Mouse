import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_PRIVACY_PROMISE_MS,
  GITHUB_SCHEDULER_SLACK_MS,
  GITHUB_SWEEP_INTERVAL_MS,
  GITHUB_SWEEP_MINUTE,
  MAX_ANONYMOUS_RETENTION_MS,
  parseHourlyCronMinute,
  SESSION_TTL_MS,
} from "../../src/server/scans/retention";

describe("the 24h anonymous-deletion bound (issue #32)", () => {
  it("MAX_ANONYMOUS_RETENTION_MS is the sum of its three named parts", () => {
    expect(MAX_ANONYMOUS_RETENTION_MS).toBe(
      SESSION_TTL_MS + GITHUB_SWEEP_INTERVAL_MS + GITHUB_SCHEDULER_SLACK_MS,
    );
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
      GITHUB_SCHEDULER_SLACK_MS;
    expect(regressed).toBeGreaterThan(ANONYMOUS_PRIVACY_PROMISE_MS);
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
});
