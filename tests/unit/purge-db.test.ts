/**
 * The inactive-account purge on a real Postgres (PGlite, with the repo's
 * migrations), through the real module and the real cron handler (candidate,
 * spec 2026-10-11, section 5.2). Every time is an offset from the database's
 * own now(), because that is the clock the purge uses.
 *
 * NOT COVERED (spec decision 13, "needs a real Postgres"): the race in which a
 * person signs in WHILE the DELETE statement is running. PGlite is one
 * connection that runs statements one after another, so it cannot show that
 * Postgres re-checks the WHERE clause on a row version that a concurrent UPDATE
 * has just committed. What these tests do prove is that the guard predicate is
 * evaluated when the DELETE runs ("guard after a late write" below). The
 * lock-wait re-check itself is argued from Postgres' documented READ COMMITTED
 * behaviour, not run here.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

import {
  countInactiveUsers,
  createDrizzlePurgeRepo,
  deleteUserAccounts,
  selectInactiveUserIds,
  type PurgeDb,
} from "../../src/server/account/purge";
import {
  handlePurgeInactive,
  type PurgeCronDeps,
} from "../../src/server/account/purge-cron";
import { shortHash } from "../../src/server/log";
import { createPgliteSurveyWorld } from "./fixtures/survey-world";
import {
  counts,
  seedAccount,
  seedAnonymous,
  type PurgeWorld,
} from "./fixtures/purge-world";

let world: PurgeWorld;
let db: PurgeDb;

beforeAll(async () => {
  world = await createPgliteSurveyWorld();
  db = world.db as PurgeDb;
});
afterAll(() => world.close());
beforeEach(() => world.reset());
afterEach(() => vi.useRealTimers());

const userCount = async () =>
  (await world.pg.query<{ n: number }>(`select count(*)::int as n from users`))
    .rows[0]!.n;

describe("eligibility on the database clock", () => {
  it("selects an account inactive for 91 days and leaves one inactive for 89", async () => {
    await seedAccount(world, "old", { lastActiveAgo: "91 days" });
    await seedAccount(world, "recent", { lastActiveAgo: "89 days" });
    await seedAccount(world, "fresh", {});

    expect(await selectInactiveUserIds(db, 90, 100)).toEqual(["old"]);
    expect(await countInactiveUsers(db, 90)).toBe(1);
  });

  it("exactly 90 days is not eligible, one millisecond more is (inside one transaction, where now() stands still)", async () => {
    await world.pg.exec("begin");
    try {
      await world.pg.exec(
        `insert into users (id, last_active_at) values ('edge', now() - interval '90 days')`,
      );
      expect(await selectInactiveUserIds(db, 90, 10)).toEqual([]);
      expect(await countInactiveUsers(db, 90)).toBe(0);
      expect(
        await deleteUserAccounts(db, ["edge"], { windowDays: 90 }),
      ).toEqual([]);

      await world.pg.exec(
        `update users set last_active_at = now() - interval '90 days' - interval '1 millisecond' where id = 'edge'`,
      );
      expect(await selectInactiveUserIds(db, 90, 10)).toEqual(["edge"]);
      expect(await countInactiveUsers(db, 90)).toBe(1);
    } finally {
      await world.pg.exec("rollback");
    }
  });

  it("a last_active_at in the future is never eligible", async () => {
    await seedAccount(world, "future", { lastActiveAhead: "400 days" });
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual([]);
    expect(
      await deleteUserAccounts(db, ["future"], { windowDays: 90 }),
    ).toEqual([]);
    expect(await userCount()).toBe(1);
  });

  it("the window is a parameter", async () => {
    await seedAccount(world, "sixty", { lastActiveAgo: "60 days" });
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual([]);
    expect(await selectInactiveUserIds(db, 30, 10)).toEqual(["sixty"]);
    expect(await selectInactiveUserIds(db, 59, 10)).toEqual(["sixty"]);
    expect(await selectInactiveUserIds(db, 61, 10)).toEqual([]);
  });

  it("refuses a window that would make everyone eligible, and absurd limits", async () => {
    await seedAccount(world, "fresh", {});
    for (const bad of [0, -1, 1.5, Number.NaN, 4000]) {
      await expect(
        selectInactiveUserIds(db, bad, 10),
        String(bad),
      ).rejects.toThrow(RangeError);
      await expect(countInactiveUsers(db, bad)).rejects.toThrow(RangeError);
      await expect(
        deleteUserAccounts(db, ["fresh"], { windowDays: bad }),
      ).rejects.toThrow(RangeError);
    }
    for (const bad of [0, -5, 2.5, 100_000]) {
      await expect(selectInactiveUserIds(db, 90, bad)).rejects.toThrow(
        RangeError,
      );
    }
    expect(await userCount()).toBe(1);
  });

  // PGlite runs inside this process and reads its clock from JS `Date`, so
  // faking the application clock would fake the database's too and prove
  // nothing. Instead: record every statement the purge sends, and check that
  // the cutoff is computed in SQL (`now()`) and that no timestamp travels as a
  // parameter. Only strings that are not timestamps (ids, the window in days,
  // the limit) are sent.
  it("the application clock never reaches the SQL: the cutoff is now() inside the statement and no parameter is a timestamp", async () => {
    await seedAccount(world, "old", { lastActiveAgo: "91 days" });
    await seedAccount(world, "recent", { lastActiveAgo: "89 days" });
    const seen: { sql: string; params: unknown[] }[] = [];
    const original = world.pg.query.bind(world.pg);
    const spy = vi.spyOn(world.pg, "query").mockImplementation(((
      sql: string,
      params?: unknown[],
      ...rest: unknown[]
    ) => {
      seen.push({ sql, params: params ?? [] });
      return (original as (...a: unknown[]) => unknown)(sql, params, ...rest);
    }) as typeof world.pg.query);
    try {
      expect(await selectInactiveUserIds(db, 90, 10)).toEqual(["old"]);
      expect(await countInactiveUsers(db, 90)).toBe(1);
      expect(
        await deleteUserAccounts(db, ["old", "recent"], { windowDays: 90 }),
      ).toEqual(["old"]);
    } finally {
      spy.mockRestore();
    }

    // Not vacuous: the three statements were seen.
    const purgeStatements = seen.filter((s) => /users/.test(s.sql));
    expect(purgeStatements.length).toBeGreaterThanOrEqual(3);
    for (const { sql, params } of purgeStatements) {
      expect(sql).toMatch(/now\(\)/);
      for (const param of params) {
        expect(param instanceof Date).toBe(false);
        expect(String(param)).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
      }
    }
    expect(await userCount()).toBe(1);
  });
});

describe("the two safety nets, evaluated by the database", () => {
  it("a scan inside the window blocks the purge of an otherwise eligible account", async () => {
    await seedAccount(world, "scanned", {
      lastActiveAgo: "120 days",
      scanAgo: "10 days",
    });
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual([]);
    expect(
      await deleteUserAccounts(db, ["scanned"], { windowDays: 90 }),
    ).toEqual([]);
    expect((await counts(world.pg, "scanned")).scans).toBe(1);
    expect((await counts(world.pg, "scanned")).users).toBe(1);
  });

  it("a scan older than the window does not block", async () => {
    await seedAccount(world, "oldscan", {
      lastActiveAgo: "120 days",
      scanAgo: "100 days",
    });
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual(["oldscan"]);
  });

  it("an unexpired auth session blocks; an expired one does not", async () => {
    await seedAccount(world, "live", {
      lastActiveAgo: "120 days",
      sessionExpiresIn: "5 days",
    });
    await seedAccount(world, "dead", {
      lastActiveAgo: "120 days",
      sessionExpiredAgo: "1 day",
    });
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual(["dead"]);
    expect(await deleteUserAccounts(db, ["live"], { windowDays: 90 })).toEqual(
      [],
    );
    expect((await counts(world.pg, "live")).auth_sessions).toBe(1);
  });

  it("one user's session or scan never shields another user", async () => {
    await seedAccount(world, "protected", {
      lastActiveAgo: "120 days",
      sessionExpiresIn: "5 days",
      scanAgo: "5 days",
    });
    await seedAccount(world, "bystander", { lastActiveAgo: "120 days" });
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual(["bystander"]);
  });
});

describe("deleteUserAccounts", () => {
  it("removes the account and every row under it, and nothing of another user", async () => {
    await seedAccount(world, "gone", {
      lastActiveAgo: "120 days",
      scanAgo: "100 days",
      sessionExpiredAgo: "2 days",
    });
    await seedAccount(world, "kept", {
      lastActiveAgo: "5 days",
      scanAgo: "100 days",
      sessionExpiresIn: "1 day",
    });
    const before = await counts(world.pg, "gone");
    for (const [table, n] of Object.entries(before)) {
      expect(n, table).toBeGreaterThan(0);
    }
    const keptBefore = await counts(world.pg, "kept");

    const deleted = await deleteUserAccounts(db, ["gone", "kept"], {
      windowDays: 90,
    });

    expect(deleted).toEqual(["gone"]);
    for (const [table, n] of Object.entries(await counts(world.pg, "gone"))) {
      expect(n, table).toBe(0);
    }
    expect(await counts(world.pg, "kept")).toEqual(keptBefore);
  });

  it("is idempotent: the second run deletes nothing", async () => {
    await seedAccount(world, "gone", { lastActiveAgo: "120 days" });
    expect(await deleteUserAccounts(db, ["gone"], { windowDays: 90 })).toEqual([
      "gone",
    ]);
    expect(await deleteUserAccounts(db, ["gone"], { windowDays: 90 })).toEqual(
      [],
    );
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual([]);
  });

  it("with no ids it does nothing, and duplicate ids are one account", async () => {
    await seedAccount(world, "gone", { lastActiveAgo: "120 days" });
    expect(await deleteUserAccounts(db, [], { windowDays: 90 })).toEqual([]);
    expect(
      await deleteUserAccounts(db, ["gone", "gone"], { windowDays: 90 }),
    ).toEqual(["gone"]);
  });

  it("guard after a late write: an account that became active after the SELECT survives the DELETE", async () => {
    await seedAccount(world, "late", {
      lastActiveAgo: "120 days",
      scanAgo: "100 days",
    });
    const selected = await selectInactiveUserIds(db, 90, 10);
    expect(selected).toEqual(["late"]);

    // The person signs in between the SELECT and the DELETE.
    await world.pg.exec(
      `update users set last_active_at = now() where id = 'late'`,
    );

    expect(await deleteUserAccounts(db, selected, { windowDays: 90 })).toEqual(
      [],
    );
    expect((await counts(world.pg, "late")).users).toBe(1);
    expect((await counts(world.pg, "late")).scans).toBe(1);
  });

  it("without a guard it deletes exactly the ids it is given (the caller already decided)", async () => {
    await seedAccount(world, "fresh", {});
    expect(await deleteUserAccounts(db, ["fresh"])).toEqual(["fresh"]);
  });

  it("never touches anonymous sessions, expired or live, however old", async () => {
    await seedAccount(world, "gone", { lastActiveAgo: "120 days" });
    const expired = await seedAnonymous(world, { expiredAgo: "3 days" });
    const live = await seedAnonymous(world, { liveFor: "1 hour" });

    await deleteUserAccounts(db, ["gone"], { windowDays: 90 });
    const repo = createDrizzlePurgeRepo(db);
    expect(await repo.countInactiveUsers(90)).toBe(0);

    const { rows } = await world.pg.query<{ id: string }>(
      `select id from scan_sessions where user_id is null order by id`,
    );
    expect(rows.map((r) => r.id).sort()).toEqual([expired, live].sort());
    expect(
      (
        await world.pg.query<{ n: number }>(
          `select count(*)::int as n from scans`,
        )
      ).rows[0]!.n,
    ).toBe(2);
  });
});

describe("selection order and limits", () => {
  it("returns the oldest first and respects the limit", async () => {
    await seedAccount(world, "c", { lastActiveAgo: "100 days" });
    await seedAccount(world, "a", { lastActiveAgo: "300 days" });
    await seedAccount(world, "b", { lastActiveAgo: "200 days" });
    expect(await selectInactiveUserIds(db, 90, 2)).toEqual(["a", "b"]);
    expect(await selectInactiveUserIds(db, 90, 10)).toEqual(["a", "b", "c"]);
  });
});

describe("GET /api/cron/purge-inactive on PGlite", () => {
  const run = async (
    query: string,
    overrides: Partial<PurgeCronDeps> = {},
  ): Promise<{
    status: number;
    body: Record<string, unknown>;
    text: string;
  }> => {
    const res = await handlePurgeInactive(
      new Request(`http://localhost/api/cron/purge-inactive${query}`, {
        headers: { authorization: "Bearer secret" },
      }),
      {
        repo: createDrizzlePurgeRepo(db),
        cronSecret: "secret",
        modeEnv: "delete",
        logger: { info: vi.fn(), error: vi.fn() },
        ...overrides,
      },
    );
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), text };
  };

  async function seedMany(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = `u${String(i).padStart(3, "0")}`;
      ids.push(id);
      // Distinct, oldest first by index.
      await world.pg.query(
        `insert into users (id, email, last_active_at) values ($1, $2, now() - make_interval(days => $3::int))`,
        [id, `${id}@example.test`, 1000 - i],
      );
    }
    return ids;
  }

  it("deletes 60 eligible accounts in chunks of 25 / 25 / 10 and reports counts only", async () => {
    await seedMany(60);
    await seedAccount(world, "active", {});
    const logger = { info: vi.fn(), error: vi.fn() };

    const { status, body } = await run("", { logger });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      mode: "delete",
      candidates: 60,
      usersDeleted: 60,
      chunks: 3,
      remaining: false,
    });
    expect(await userCount()).toBe(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]![0]).toBe("retention.purge");
  });

  it("stops at the per-run cap, says remaining, and the next run drains the rest in oldest-first order", async () => {
    await seedMany(60);
    const limits = {
      maxAccounts: 40,
      chunkSize: 25,
      budgetMs: 20_000,
      windowDays: 90,
    };

    const first = await run("", { limits });
    expect(first.body).toMatchObject({
      usersDeleted: 40,
      chunks: 2,
      remaining: true,
    });
    // The oldest 40 are gone (u000..u039), the newest 20 remain.
    const { rows } = await world.pg.query<{ id: string }>(
      `select id from users order by id`,
    );
    expect(rows.map((r) => r.id)).toEqual(
      Array.from(
        { length: 20 },
        (_, i) => `u${String(40 + i).padStart(3, "0")}`,
      ),
    );

    const second = await run("", { limits });
    expect(second.body).toMatchObject({
      usersDeleted: 20,
      chunks: 1,
      remaining: false,
    });
    const third = await run("", { limits });
    expect(third.body).toMatchObject({
      usersDeleted: 0,
      chunks: 0,
      remaining: false,
    });
    expect(await userCount()).toBe(0);
  });

  it("counts the scans of the deleted accounts", async () => {
    await seedAccount(world, "gone", {
      lastActiveAgo: "120 days",
      scanAgo: "100 days",
    });
    const { body } = await run("");
    expect(body).toMatchObject({ usersDeleted: 1, scansDeleted: 1 });
  });

  it("dry-run (mode variable) deletes nothing, and the response holds no id or email in full", async () => {
    const ids = await seedMany(30);
    const { status, body, text } = await run("", { modeEnv: "dry-run" });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      mode: "dry-run",
      candidates: 30,
      remaining: false,
    });
    expect(await userCount()).toBe(30);
    const sample = body.sample as string[];
    expect(sample).toHaveLength(20);
    for (const handle of sample) expect(handle).toMatch(/^[0-9a-f]{8}$/);
    expect(sample).toEqual(ids.slice(0, 20).map(shortHash));
    for (const id of ids) expect(text).not.toContain(id);
    expect(text).not.toContain("@");
    expect(text).not.toContain("example.test");
  });

  it("?dryRun=1 with the variable on delete deletes nothing", async () => {
    await seedMany(5);
    const { body } = await run("?dryRun=1", { modeEnv: "delete" });
    expect(body).toMatchObject({ mode: "dry-run", candidates: 5 });
    expect(await userCount()).toBe(5);
  });

  it("mode off (and an unknown mode) touches nothing", async () => {
    await seedMany(5);
    for (const modeEnv of [undefined, "off", "Delete", "yes"]) {
      const { status, body } = await run("", { modeEnv });
      expect(status).toBe(200);
      expect(body).toEqual({ mode: "off" });
    }
    expect(await userCount()).toBe(5);
  });

  it("an account that signs in after the select is skipped by the guard and the run still ends", async () => {
    await seedMany(3);
    const real = createDrizzlePurgeRepo(db);
    const repo = {
      ...real,
      async deleteUserAccounts(
        ids: readonly string[],
        guard: Parameters<typeof real.deleteUserAccounts>[1],
      ) {
        // Between the SELECT and the DELETE, every selected person signs in.
        await world.pg.exec(`update users set last_active_at = now()`);
        return real.deleteUserAccounts(ids, guard);
      },
    };
    const { status, body } = await run("", { repo });
    expect(status).toBe(200);
    expect(body).toMatchObject({ usersDeleted: 0, scansDeleted: 0, chunks: 1 });
    expect(await userCount()).toBe(3);
  });
});
