/**
 * `createDrizzleSurveyRepo` over drizzle's real neon-http session, with the
 * Neon client faked: what is sent and how the answers are read, which PGlite
 * cannot show (its driver has no `db.batch`). The behaviour of the SQL is in
 * survey-repo.test.ts on a real Postgres; this pins the shape the HTTP driver
 * sees: ONE transaction request carrying every statement, nothing sent outside
 * it, the scan row locked first and its mark set last, every statement after
 * the contribution insert guarded by it, and the scan id never written into a
 * contribution row.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SURVEY_CONSENT_VERSION } from "../../src/lib/contracts/survey";
import { createDrizzleSurveyRepo } from "../../src/server/survey/drizzle-repo";
import { startOfUtcDay } from "../../src/server/survey/profile";
import type { ContributionWrite } from "../../src/server/survey/repo";
import {
  USE_B,
  FEEL_SMALL,
  DURATION_A,
  PAIN_A,
  BRAND_A,
} from "./fixtures/survey-values";

type RepoDb = NonNullable<Parameters<typeof createDrizzleSurveyRepo>[0]>;

const SCAN = "10000000-0000-4000-8000-000000000001";
const MOUSE_A = "20000000-0000-4000-8000-00000000000a";
const MOUSE_B = "20000000-0000-4000-8000-00000000000b";
const NOW = new Date("2026-10-06T08:15:30.123Z");

interface Sent {
  sql: string;
  params: unknown[];
}

/**
 * A Neon client that builds queries lazily, as the real one does: calling it
 * only describes a statement, and nothing runs until `transaction` is handed
 * the list. `answers` are the per-statement results `transaction` returns.
 */
function fakeNeon(answers: (statements: Sent[]) => { rows: unknown[][] }[]) {
  const built: Sent[] = [];
  const transactions: Sent[][] = [];
  const client = Object.assign(
    vi.fn((sql: string, params: unknown[]) => {
      const statement = { sql, params };
      built.push(statement);
      return statement;
    }),
    {
      transaction: vi.fn(async (statements: Sent[]) => {
        transactions.push(statements);
        return answers(statements);
      }),
    },
  );
  const db = drizzle(client as unknown as NeonQueryFunction<false, false>);
  return {
    repo: createDrizzleSurveyRepo(db as unknown as RepoDb),
    built,
    transactions,
    client,
  };
}

const aWrite = (over: Partial<ContributionWrite> = {}): ContributionWrite => ({
  scanId: SCAN,
  userId: null,
  consentVersion: SURVEY_CONSENT_VERSION,
  consentedAt: startOfUtcDay(NOW),
  markedAt: NOW,
  handLengthBinMm: 185,
  palmWidthBinMm: 80,
  gripStyle: "claw",
  mainUse: USE_B,
  feedback: "light",
  ratings: [
    {
      mouseId: MOUSE_A,
      satisfaction: 5,
      duration: DURATION_A,
      painPoints: [PAIN_A],
      isCurrent: true,
    },
    {
      mouseId: MOUSE_B,
      satisfaction: 2,
      duration: null,
      painPoints: [],
      isCurrent: false,
    },
  ],
  otherMouse: { brand: BRAND_A, sizeFeel: FEEL_SMALL, isCurrent: false },
  ...over,
});

const ids = (rows: unknown[][]) => ({ rows });
const oneRow = ids([["id"]]);
const noRows = ids([]);

describe("recordContribution over the neon-http driver", () => {
  it("sends every statement in one transaction request, and nothing outside it", async () => {
    const { repo, built, transactions, client } = fakeNeon((s) =>
      s.map(() => oneRow),
    );
    await repo.recordContribution(aWrite());
    expect(client.transaction).toHaveBeenCalledTimes(1);
    expect(transactions[0]).toHaveLength(built.length);
    expect(transactions[0]).toEqual(built);
  });

  it("locks the scan row first, inserts the contribution from the unmarked scan, and marks the scan last", async () => {
    const { repo, transactions } = fakeNeon((s) => s.map(() => oneRow));
    await repo.recordContribution(aWrite());
    const sql = transactions[0]!.map((s) => s.sql.toLowerCase());

    expect(sql[0]).toMatch(/^select "id" from "scans" where .* for update$/);
    expect(sql[1]).toMatch(/^insert into "survey_contributions"/);
    expect(sql[1]).toMatch(
      /from "scans" where .*"survey_contributed_at" is null/,
    );
    const mark = sql[sql.length - 1]!;
    expect(mark).toMatch(/^update "scans" set "survey_contributed_at" = /);
    expect(mark).toMatch(/"survey_contributed_at" is null/);
    expect(mark).toMatch(/returning "id"$/);
    // The other statements, in the order that lets the repeat rules run before
    // the new rows go in: 2 ratings and 1 other mouse are 3 inserts.
    expect(sql.filter((s) => s.startsWith("insert into"))).toHaveLength(4);
  });

  it("guards every statement after the contribution insert by that contribution's id", async () => {
    const { repo, transactions } = fakeNeon((s) => s.map(() => oneRow));
    await repo.recordContribution(
      aWrite({ userId: "user-1", ratings: aWrite().ratings }),
    );
    const statements = transactions[0]!;
    // The contribution id is the first parameter of the contribution insert.
    const contributionId = statements[1]!.params[0] as string;
    expect(contributionId).toMatch(/^[0-9a-f-]{36}$/);
    const between = statements.slice(2, -1);
    expect(between.length).toBeGreaterThan(4);
    for (const statement of between) {
      expect(statement.params, statement.sql).toContain(contributionId);
    }
    // And a signed-in write ran every repeat rule: replace ratings, clear the
    // current marker on ratings and other mice, replace main use, replace brand.
    const text = between.map((s) => s.sql.toLowerCase()).join("\n");
    expect(text).toMatch(/delete from "survey_ratings"/);
    expect(text).toMatch(/update "survey_ratings" set "is_current" = /);
    expect(text).toMatch(/update "survey_other_mice" set "is_current" = /);
    expect(text).toMatch(/update "survey_contributions" set "main_use" = /);
    expect(text).toMatch(/delete from "survey_other_mice"/);
    expect(text).toMatch(
      /lower\(btrim\("survey_other_mice"\."brand"\)\) = lower\(btrim\(\$\d+\)\)/,
    );
  });

  it("an anonymous write runs no repeat rule at all", async () => {
    const { repo, transactions } = fakeNeon((s) => s.map(() => oneRow));
    await repo.recordContribution(aWrite({ userId: null }));
    const text = transactions[0]!.map((s) => s.sql.toLowerCase()).join("\n");
    expect(text).not.toMatch(/delete from/);
    expect(text).not.toMatch(/update "survey_/);
  });

  it("never writes the scan id into a row: it appears only in the lock, the guard of the insert, and the mark", async () => {
    const { repo, transactions } = fakeNeon((s) => s.map(() => oneRow));
    await repo.recordContribution(aWrite({ userId: "user-1" }));
    const statements = transactions[0]!;

    const carrying = statements
      .map((s, i) => [i, s] as const)
      .filter(([, s]) => s.params.includes(SCAN))
      .map(([i]) => i);
    expect(carrying).toEqual([0, 1, statements.length - 1]);

    // In the contribution insert it is a parameter of the WHERE, after the
    // select list, never one of the values the row is built from.
    const insert = statements[1]!;
    const at = `$${insert.params.indexOf(SCAN) + 1}`;
    const [selectList, where] = insert.sql.split(' from "scans" ');
    expect(selectList).not.toContain(at);
    expect(where).toContain(at);
    // No timestamp finer than a day goes into a row; the instant is the mark's.
    expect(insert.params).toContain("2026-10-06T00:00:00.000Z");
    expect(insert.params).not.toContain(NOW.toISOString());
    expect(JSON.stringify(statements[statements.length - 1]!.params)).toContain(
      "2026-10-06T08:15:30.123Z",
    );
  });

  it("reads 'stored' when the lock and the mark each returned the scan row", async () => {
    const { repo } = fakeNeon((s) => s.map(() => oneRow));
    expect(await repo.recordContribution(aWrite())).toBe("stored");
  });

  it("reads 'already_contributed' when the lock found the scan but the mark updated no row", async () => {
    const { repo } = fakeNeon((s) =>
      s.map((_, i) => (i === s.length - 1 ? noRows : oneRow)),
    );
    expect(await repo.recordContribution(aWrite())).toBe("already_contributed");
  });

  it("reads 'scan_gone' when the lock found no scan", async () => {
    const { repo } = fakeNeon((s) =>
      s.map((_, i) => (i === 0 || i === s.length - 1 ? noRows : oneRow)),
    );
    expect(await repo.recordContribution(aWrite())).toBe("scan_gone");
  });

  it("lets a failed transaction through, so the caller answers 500 and nothing is half-written", async () => {
    const { repo, client } = fakeNeon(() => []);
    client.transaction.mockRejectedValueOnce(new Error("statement failed"));
    await expect(repo.recordContribution(aWrite())).rejects.toThrow(
      "statement failed",
    );
  });
});

describe("the other repo methods over the neon-http driver", () => {
  it("withdrawContributions is one DELETE by user_id and counts the rows it returned", async () => {
    const query = vi.fn<
      (sql: string, params: unknown[]) => Promise<{ rows: string[][] }>
    >(async () => ({ rows: [["c1"], ["c2"]] }));
    const db = drizzle(query as unknown as NeonQueryFunction<false, false>);
    const repo = createDrizzleSurveyRepo(db as unknown as RepoDb);
    expect(await repo.withdrawContributions("user-1")).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql.toLowerCase()).toMatch(
      /^delete from "survey_contributions" where "survey_contributions"\."user_id" = \$1 returning "id"$/,
    );
    expect(params).toEqual(["user-1"]);
  });

  it("findMouseIdsBySlug skips the database for an empty list", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const db = drizzle(query as unknown as NeonQueryFunction<false, false>);
    const repo = createDrizzleSurveyRepo(db as unknown as RepoDb);
    expect((await repo.findMouseIdsBySlug([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
