/**
 * The account's "Delete everything" must withdraw the person's survey
 * contributions too (src/lib/contracts/survey.ts). `deleteAllScans` deletes
 * `scan_sessions` rows and never the `users` row, so the foreign key from a
 * contribution to the user never fires there: the contributions have to be
 * deleted by name. Run on a real Postgres (PGlite), with the real account repo
 * and the real handler, so a repo that forgets it fails here.
 *
 * The withdrawal and the scans' deletion must be ONE atomic request ("everything"
 * must not leave the answers behind, or the scans): on PGlite by making the
 * second statement fail and asserting the first did not stick, and over the
 * neon-http driver by asserting what is sent is exactly one transaction.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { handleAccountDeleteAll } from "../../src/server/account/handlers";
import type { AccountRepo } from "../../src/server/account/repo";
import {
  SURVEY_CONSENT_VERSION,
  type OtherMouseBrand,
} from "../../src/lib/contracts/survey";
import {
  NOW,
  createPgliteSurveyWorld,
  withTransactionalBatch,
  type SurveyWorld,
} from "./fixtures/survey-world";
import { startOfUtcDay } from "../../src/server/survey/profile";
import { USE_A, FEEL_RIGHT, BRAND_A } from "./fixtures/survey-values";

describe("account Delete everything on a real Postgres", () => {
  let world: Awaited<ReturnType<typeof createPgliteSurveyWorld>>;
  let accountRepo: AccountRepo;

  beforeAll(async () => {
    world = await createPgliteSurveyWorld();
    const { createDrizzleAccountRepo } =
      await import("../../src/server/account/drizzle-repo");
    type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];
    accountRepo = createDrizzleAccountRepo(
      withTransactionalBatch<AccountDb>(world.pg, world.db),
    );
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
    await world.addUser("user-2");
  });

  async function contribute(
    w: SurveyWorld,
    userId: string | null,
    handLengthMm: number,
    over: { feedback?: string; brand?: OtherMouseBrand } = {},
  ) {
    const mouse = await w.surveyRepo.findMouseIdsBySlug(["mouse-a"]);
    const mouseId = mouse.get("mouse-a") ?? (await w.addMouse("mouse-a"));
    const scan = await w.addScan({ userId, handLengthMm });
    const result = await w.surveyRepo.recordContribution({
      scanId: scan.scanId,
      userId,
      consentVersion: SURVEY_CONSENT_VERSION,
      consentedAt: startOfUtcDay(NOW),
      markedAt: NOW,
      handLengthBinMm: Math.floor(handLengthMm / 5) * 5,
      palmWidthBinMm: 80,
      gripStyle: "claw",
      mainUse: USE_A,
      feedback: over.feedback ?? null,
      ratings: [
        {
          mouseId,
          satisfaction: 4,
          duration: null,
          painPoints: [],
          isCurrent: false,
        },
      ],
      otherMouse: over.brand
        ? { brand: over.brand, sizeFeel: FEEL_RIGHT, isCurrent: false }
        : null,
    });
    expect(result).toBe("stored");
    return scan;
  }

  it("withdraws the person's contributions with their ratings, other mice and free text, along with their scans", async () => {
    await contribute(world, "user-1", 181, {
      feedback: "kept-only-until-delete-everything",
      brand: BRAND_A,
    });
    await contribute(world, "user-1", 192);

    const deleted = await accountRepo.deleteAllScans("user-1");

    expect(deleted).toBe(2);
    expect(await world.contributions()).toEqual([]);
    const text = await world.rawContributionText();
    expect(text).not.toContain("kept-only-until-delete-everything");
    expect(text).not.toContain(BRAND_A);
    const { rows } = await world.pg.query<{ n: number }>(
      `select count(*)::int as n from scans`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("leaves everyone else's contributions, anonymous ones included", async () => {
    await contribute(world, "user-1", 181);
    await contribute(world, "user-2", 192);
    await contribute(world, null, 203);

    await accountRepo.deleteAllScans("user-1");

    expect((await world.contributions()).map((c) => c.userId)).toEqual([
      "user-2",
      null,
    ]);
  });

  it("withdraws contributions even when the person has no scans left to delete", async () => {
    // A contribution outlives its scan (deleting a scan does not withdraw it).
    const scan = await contribute(world, "user-1", 181);
    await world.deleteScan(scan.scanId);

    expect(await accountRepo.deleteAllScans("user-1")).toBe(0);
    expect(await world.contributions()).toEqual([]);
  });

  it("is what POST-then-delete-everything does through the real handler: 200 with the scan count, and nothing of theirs left", async () => {
    await contribute(world, "user-1", 181, { feedback: "gone-after-delete" });

    const res = await handleAccountDeleteAll({
      repo: accountRepo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedScans: 1 });
    expect(await world.contributions()).toEqual([]);
  });

  it("is all or nothing: when deleting the scans fails, the withdrawal does not stick", async () => {
    await contribute(world, "user-1", 181, {
      feedback: "must-survive-a-failure",
    });
    // A trigger that refuses the second statement of the batch (the scans'
    // sessions), after the first one (the withdrawal) has already run.
    await world.pg.exec(`
      create function refuse_session_delete() returns trigger language plpgsql
        as $$ begin raise exception 'refused on purpose'; end $$;
      create trigger refuse_session_delete before delete on scan_sessions
        for each row execute function refuse_session_delete();
    `);
    try {
      // Drizzle's error names the statement that failed: the second one.
      await expect(accountRepo.deleteAllScans("user-1")).rejects.toThrow(
        /Failed query: delete from "scan_sessions"/,
      );
    } finally {
      await world.pg.exec(`
        drop trigger refuse_session_delete on scan_sessions;
        drop function refuse_session_delete();
      `);
    }

    // Nothing was deleted: the contribution is still there (a repo that ran
    // the two deletes one after the other would have lost it) and so is the scan.
    expect(await world.contributions()).toHaveLength(1);
    expect(await world.rawContributionText()).toContain(
      "must-survive-a-failure",
    );
    const { rows } = await world.pg.query<{ n: number }>(
      `select count(*)::int as n from scans`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("does nothing for a caller who is not signed in", async () => {
    await contribute(world, "user-1", 181);
    const res = await handleAccountDeleteAll({
      repo: accountRepo,
      getUserId: async () => null,
    });
    expect(res.status).toBe(401);
    expect(await world.contributions()).toHaveLength(1);
  });
});

describe("account Delete everything over the neon-http driver", () => {
  type Sent = Promise<unknown> & { sql: string; params: unknown[] };

  /**
   * A Neon client that records every statement the driver builds. Awaited
   * directly, a statement answers with `directRows` (the "how many scans" select
   * reads two); handed to `transaction`, which records the list, it answers
   * with no rows.
   */
  function fakeNeon(directRows: unknown[][]) {
    const built: Sent[] = [];
    const transactions: Sent[][] = [];
    const client = Object.assign(
      vi.fn((sql: string, params: unknown[]) => {
        const statement = Object.assign(Promise.resolve({ rows: directRows }), {
          sql,
          params,
        });
        built.push(statement);
        return statement;
      }),
      {
        transaction: vi.fn(async (statements: Sent[]) => {
          transactions.push(statements);
          return statements.map(() => ({ rows: [] }));
        }),
      },
    );
    return {
      db: drizzle(client as unknown as NeonQueryFunction<false, false>),
      built,
      transactions,
      client,
    };
  }

  it("sends the withdrawal and the scans' deletion as exactly one transaction of two DELETEs, and no DELETE outside it", async () => {
    const { createDrizzleAccountRepo } =
      await import("../../src/server/account/drizzle-repo");
    type AccountDb = NonNullable<
      Parameters<typeof createDrizzleAccountRepo>[0]
    >;
    const { db, built, transactions, client } = fakeNeon([["a"], ["b"]]);

    const deleted = await createDrizzleAccountRepo(
      db as unknown as AccountDb,
    ).deleteAllScans("user-1");

    expect(deleted).toBe(2);
    expect(client.transaction).toHaveBeenCalledTimes(1);
    const sql = transactions[0]!.map((s) => s.sql.toLowerCase());
    expect(sql).toHaveLength(2);
    expect(sql[0]).toMatch(/^delete from "survey_contributions" where /);
    expect(sql[1]).toMatch(/^delete from "scan_sessions" where /);
    for (const statement of transactions[0]!) {
      expect(statement.params).toEqual(["user-1"]);
    }
    // Everything else the driver was asked for is the scan count, a SELECT.
    const outside = built.filter((s) => !transactions[0]!.includes(s));
    expect(outside).toHaveLength(1);
    expect(outside[0]!.sql.toLowerCase()).toMatch(/^select /);
  });
});
