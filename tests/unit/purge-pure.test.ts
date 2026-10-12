/**
 * The pure parts of the inactive-account purge (candidate, spec 2026-10-11,
 * section 5.1): the eligibility rule, the mode switch and the write throttle.
 * No database. The SQL that must agree with `isInactiveAccount` is tested on
 * PGlite in purge-db.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  INACTIVE_WINDOW_DAYS,
  isInactiveAccount,
  windowMsOf,
} from "../../src/server/account/purge";
import { resolvePurgeMode } from "../../src/server/account/purge-cron";
import {
  ACTIVITY_THROTTLE_MS,
  isActivityStale,
} from "../../src/server/account/activity";

const DAY = 24 * 60 * 60 * 1000;
const WINDOW = 90 * DAY;
const NOW = new Date("2026-10-12T04:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("isInactiveAccount: the 90-day boundary", () => {
  it("exactly 90 days is not yet inactive (strictly older)", () => {
    expect(isInactiveAccount({ lastActiveAt: ago(WINDOW) }, NOW, WINDOW)).toBe(
      false,
    );
  });

  it("90 days plus 1 ms is inactive", () => {
    expect(
      isInactiveAccount({ lastActiveAt: ago(WINDOW + 1) }, NOW, WINDOW),
    ).toBe(true);
  });

  it("90 days minus 1 ms is not inactive", () => {
    expect(
      isInactiveAccount({ lastActiveAt: ago(WINDOW - 1) }, NOW, WINDOW),
    ).toBe(false);
  });

  it("someone who has just been active is not inactive", () => {
    expect(isInactiveAccount({ lastActiveAt: NOW }, NOW, WINDOW)).toBe(false);
  });

  it("a last_active_at in the future (clock skew) is never inactive", () => {
    for (const ahead of [1, DAY, 400 * DAY]) {
      expect(
        isInactiveAccount(
          { lastActiveAt: new Date(NOW.getTime() + ahead) },
          NOW,
          WINDOW,
        ),
      ).toBe(false);
    }
  });

  it("the window is a parameter: 30 days and 180 days move the boundary", () => {
    const sixtyDaysAgo = { lastActiveAt: ago(60 * DAY) };
    expect(isInactiveAccount(sixtyDaysAgo, NOW, 30 * DAY)).toBe(true);
    expect(isInactiveAccount(sixtyDaysAgo, NOW, 90 * DAY)).toBe(false);
    expect(
      isInactiveAccount({ lastActiveAt: ago(179 * DAY) }, NOW, 180 * DAY),
    ).toBe(false);
    expect(
      isInactiveAccount({ lastActiveAt: ago(181 * DAY) }, NOW, 180 * DAY),
    ).toBe(true);
  });

  it("an unknown or invalid last_active_at, or a nonsense window, is never inactive", () => {
    expect(isInactiveAccount({ lastActiveAt: null }, NOW, WINDOW)).toBe(false);
    expect(
      isInactiveAccount({ lastActiveAt: new Date("nope") }, NOW, WINDOW),
    ).toBe(false);
    const old = { lastActiveAt: ago(1000 * DAY) };
    expect(isInactiveAccount(old, NOW, 0)).toBe(false);
    expect(isInactiveAccount(old, NOW, -DAY)).toBe(false);
    expect(isInactiveAccount(old, NOW, Number.NaN)).toBe(false);
    expect(isInactiveAccount(old, new Date("nope"), WINDOW)).toBe(false);
  });

  it("windowMsOf(90) is the window the tests use, and the cron's window is 90 days", () => {
    expect(windowMsOf(90)).toBe(WINDOW);
    expect(INACTIVE_WINDOW_DAYS).toBe(90);
  });

  // The arithmetic is on instants, not local dates, so the answer cannot depend
  // on the process time zone or on month lengths.
  it.each([
    ["a month end", "2026-03-31T12:00:00.000Z"],
    ["a leap day", "2028-02-29T12:00:00.000Z"],
    ["the day after a leap day", "2028-03-01T00:00:00.000Z"],
    ["a DST-ish date in another zone", "2026-03-29T01:30:00.000Z"],
  ])("is the same instant arithmetic across %s", (_label, iso) => {
    const now = new Date(iso);
    const at = (deltaMs: number) => ({
      lastActiveAt: new Date(now.getTime() - deltaMs),
    });
    expect(isInactiveAccount(at(WINDOW), now, WINDOW)).toBe(false);
    expect(isInactiveAccount(at(WINDOW + 1), now, WINDOW)).toBe(true);
    expect(isInactiveAccount(at(WINDOW - 1), now, WINDOW)).toBe(false);
  });
});

describe("isInactiveAccount: the two safety nets", () => {
  const stale = { lastActiveAt: ago(120 * DAY) };

  it("a scan inside the window blocks an otherwise eligible account", () => {
    expect(isInactiveAccount(stale, NOW, WINDOW)).toBe(true);
    expect(
      isInactiveAccount({ ...stale, latestScanAt: ago(10 * DAY) }, NOW, WINDOW),
    ).toBe(false);
  });

  it("a scan exactly at the window edge still blocks (created_at >= cutoff); older does not", () => {
    expect(
      isInactiveAccount({ ...stale, latestScanAt: ago(WINDOW) }, NOW, WINDOW),
    ).toBe(false);
    expect(
      isInactiveAccount(
        { ...stale, latestScanAt: ago(WINDOW + 1) },
        NOW,
        WINDOW,
      ),
    ).toBe(true);
  });

  it("a session that has not expired blocks; one that expired does not", () => {
    expect(
      isInactiveAccount(
        { ...stale, latestSessionExpiresAt: new Date(NOW.getTime() + 1) },
        NOW,
        WINDOW,
      ),
    ).toBe(false);
    expect(
      isInactiveAccount({ ...stale, latestSessionExpiresAt: NOW }, NOW, WINDOW),
    ).toBe(true);
    expect(
      isInactiveAccount(
        { ...stale, latestSessionExpiresAt: ago(DAY) },
        NOW,
        WINDOW,
      ),
    ).toBe(true);
  });
});

describe("resolvePurgeMode", () => {
  const q = (s = "") => new URLSearchParams(s);

  it("defaults to off: unset, empty, unknown, wrong case, padded", () => {
    for (const value of [
      undefined,
      "",
      "on",
      "true",
      "DELETE",
      "Delete",
      " delete",
      "delete ",
      "dryrun",
      "dry_run",
    ]) {
      expect(resolvePurgeMode(value, q()), String(value)).toBe("off");
    }
  });

  it("reads the two switched-on values exactly", () => {
    expect(resolvePurgeMode("dry-run", q())).toBe("dry-run");
    expect(resolvePurgeMode("delete", q())).toBe("delete");
    expect(resolvePurgeMode("off", q())).toBe("off");
  });

  it("?dryRun=1 lowers delete to dry-run and leaves dry-run as it is", () => {
    for (const value of ["dry-run", "delete"]) {
      expect(resolvePurgeMode(value, q("dryRun=1")), String(value)).toBe(
        "dry-run",
      );
    }
  });

  it("?dryRun=1 never switches a deploy on: off, unset and unknown stay off", () => {
    for (const value of [undefined, "", "off", "garbage", "DELETE"]) {
      expect(resolvePurgeMode(value, q("dryRun=1")), String(value)).toBe("off");
    }
  });

  it("no query value can produce delete", () => {
    const queries = [
      "mode=delete",
      "dryRun=0",
      "dryRun=false",
      "dryRun=",
      "dryRun=delete",
      "delete=1",
      "RETENTION_PURGE_MODE=delete",
      "dryrun=1&mode=delete",
    ];
    for (const value of [undefined, "off", "dry-run", "garbage"]) {
      for (const query of queries) {
        expect(
          resolvePurgeMode(value, q(query)),
          `${String(value)} ?${query}`,
        ).not.toBe("delete");
      }
    }
  });

  it("with the variable on delete, a query that is not dryRun=1 leaves it on delete", () => {
    expect(resolvePurgeMode("delete", q("dryRun=0"))).toBe("delete");
    expect(resolvePurgeMode("delete", q("x=1"))).toBe("delete");
  });
});

describe("isActivityStale (the 24-hour write throttle)", () => {
  it("is stale only when strictly more than 24 hours old", () => {
    expect(ACTIVITY_THROTTLE_MS).toBe(DAY);
    expect(isActivityStale(ago(DAY), NOW)).toBe(false);
    expect(isActivityStale(ago(DAY + 1), NOW)).toBe(true);
    expect(isActivityStale(ago(DAY - 1), NOW)).toBe(false);
    expect(isActivityStale(NOW, NOW)).toBe(false);
  });

  it("a last_active_at in the future is not stale", () => {
    expect(isActivityStale(new Date(NOW.getTime() + DAY), NOW)).toBe(false);
  });

  it("anything that is not a valid Date counts as stale (errs toward recording)", () => {
    for (const value of [undefined, null, "2026-10-01", 5, new Date("nope")]) {
      expect(isActivityStale(value, NOW), String(value)).toBe(true);
    }
  });
});
