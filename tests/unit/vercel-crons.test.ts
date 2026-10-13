import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `vercel.json`'s cron entries. Vercel Hobby allows two cron jobs, each at most
 * once a day, so the list is held to that, and every entry must name a route
 * that exists. The purge route ships switched off (`RETENTION_PURGE_MODE`
 * unset is `off`): adding it to the schedule deletes nothing by itself.
 */
const root = new URL("../../", import.meta.url);
const config = JSON.parse(
  readFileSync(new URL("vercel.json", root), "utf8"),
) as {
  crons: { path: string; schedule: string }[];
};

describe("vercel.json crons", () => {
  it("has at most two jobs, each once a day (Hobby limits)", () => {
    expect(config.crons.length).toBeLessThanOrEqual(2);
    for (const { schedule } of config.crons)
      expect(schedule, schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it("schedules the session expiry and the inactive-account purge", () => {
    expect(config.crons).toEqual([
      { path: "/api/cron/expire-sessions", schedule: "0 3 * * *" },
      { path: "/api/cron/purge-inactive", schedule: "0 4 * * *" },
    ]);
  });

  it("names only routes that exist", () => {
    for (const { path } of config.crons)
      expect(existsSync(new URL(`src/app${path}/route.ts`, root)), path).toBe(
        true,
      );
  });
});
