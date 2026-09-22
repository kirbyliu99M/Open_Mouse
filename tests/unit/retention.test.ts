import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_PRIVACY_PROMISE_MS,
  GITHUB_SCHEDULER_SLACK_MS,
  GITHUB_SWEEP_INTERVAL_MS,
  MAX_ANONYMOUS_RETENTION_MS,
  parseEveryNMinutesCron,
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

describe("parseEveryNMinutesCron", () => {
  it.each([
    ["*/1 * * * *", 1],
    ["*/15 * * * *", 15],
    ["*/30 * * * *", 30],
    ["*/59 * * * *", 59],
    ["  */30 * * * *  ", 30], // tolerates surrounding whitespace
  ] as const)("parses %s as every %d minutes", (schedule, expected) => {
    expect(parseEveryNMinutesCron(schedule)).toBe(expected);
  });

  it.each([
    "0 3 * * *", // the daily Vercel cron form — not a step schedule
    "*/60 * * * *", // 60 is not a valid step
    "*/0 * * * *", // 0 is not a valid step
    "not a cron string",
    "*/15 */2 * * *", // step on a second field too — not the form this parses
    "*/15 * * * * *", // six fields
  ])("returns null for %s", (schedule) => {
    expect(parseEveryNMinutesCron(schedule)).toBeNull();
  });
});

describe("the deployed schedule matches GITHUB_SWEEP_INTERVAL_MS", () => {
  it("parses the real cron string out of .github/workflows/expire-sessions.yml", () => {
    const contents = readFileSync(
      ".github/workflows/expire-sessions.yml",
      "utf8",
    );
    const match = /cron:\s*["'](.+?)["']/.exec(contents);
    expect(match).not.toBeNull();

    const scheduleMinutes = parseEveryNMinutesCron(match![1]!);
    expect(scheduleMinutes).not.toBeNull();
    expect(scheduleMinutes! * 60 * 1000).toBe(GITHUB_SWEEP_INTERVAL_MS);
  });

  it("the workflow calls the same endpoint the cron auth test exercises", () => {
    const contents = readFileSync(
      ".github/workflows/expire-sessions.yml",
      "utf8",
    );
    expect(contents).toContain("/api/cron/expire-sessions");
    expect(contents).toContain("secrets.CRON_SECRET");
    // The secret must never be inlined directly into a run: script (which
    // GitHub prints verbatim as the step's command) — only referenced via
    // an env: var and read back as a shell variable.
    expect(contents).not.toMatch(/Bearer \$\{\{\s*secrets\.CRON_SECRET/);
  });
});
