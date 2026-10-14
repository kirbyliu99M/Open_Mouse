/**
 * `createDrizzleResultFeedbackRepo` over drizzle's real neon-http session with
 * the Neon client faked: what is sent, which PGlite cannot show (its driver has
 * no `db.batch`). The 409 under concurrent POSTs rests on this shape: ONE
 * transaction request, the scan row locked first, the row inserted only from a
 * scan whose mark is still null, the mark set last by a conditional update, and
 * only the request whose update returned a row is `stored`.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RESULT_FEEDBACK_NOTICE_VERSION } from "../../src/lib/contracts/result-feedback";
import { createDrizzleResultFeedbackRepo } from "../../src/server/result-feedback/drizzle-repo";
import type { FeedbackWrite } from "../../src/server/result-feedback/repo";

type RepoDb = NonNullable<
  Parameters<typeof createDrizzleResultFeedbackRepo>[0]
>;

const SCAN = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-14T08:15:30.123Z");

interface Sent {
  sql: string;
  params: unknown[];
}

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
    repo: createDrizzleResultFeedbackRepo(db as unknown as RepoDb),
    built,
    transactions,
    client,
  };
}

const aWrite = (over: Partial<FeedbackWrite> = {}): FeedbackWrite => ({
  scanId: SCAN,
  userId: "user-1",
  noticeVersion: RESULT_FEEDBACK_NOTICE_VERSION,
  stars: 4,
  comment: "good",
  locale: "zh-TW",
  snapshot: {
    engineVersion: "fit-v1-candidate.3",
    handSize: "medium",
    handWidth: "regular",
    grip: "claw",
    calibrationMethod: "printed-sheet",
    palmThicknessStated: null,
    topMice: [{ slug: "mouse-a", band: "good" }],
  },
  createdOn: new Date("2026-10-14T00:00:00.000Z"),
  markedAt: NOW,
  ...over,
});

const oneRow = { rows: [["id"]] };
const noRows = { rows: [] };

describe("recordFeedback over the neon-http driver", () => {
  it("sends the lock, the insert and the mark in one transaction request, and nothing outside it", async () => {
    const { repo, built, transactions, client } = fakeNeon((s) =>
      s.map(() => oneRow),
    );
    await repo.recordFeedback(aWrite());
    expect(client.transaction).toHaveBeenCalledTimes(1);
    expect(transactions[0]).toHaveLength(3);
    expect(transactions[0]).toEqual(built);
  });

  it("locks the scan row first, inserts only from an unmarked scan, and marks the scan last with a conditional update", async () => {
    const { repo, transactions } = fakeNeon((s) => s.map(() => oneRow));
    await repo.recordFeedback(aWrite());
    const sql = transactions[0]!.map((s) => s.sql.toLowerCase());

    expect(sql[0]).toMatch(/^select "id" from "scans" where .* for update$/);
    expect(sql[1]).toMatch(/^insert into "result_feedback"/);
    expect(sql[1]).toMatch(/from "scans" where .*"result_feedback_at" is null/);
    expect(sql[2]).toMatch(/^update "scans" set "result_feedback_at" = /);
    expect(sql[2]).toMatch(/"result_feedback_at" is null/);
    expect(sql[2]).toMatch(/returning "id"$/);
  });

  it("never writes the scan id into the row: it appears only in the lock, the guards and the mark", async () => {
    const { repo, transactions } = fakeNeon((s) => s.map(() => oneRow));
    await repo.recordFeedback(aWrite());
    const insert = transactions[0]![1]!;
    // The scan id is a bound parameter of the insert's WHERE guard only.
    const selectList = insert.sql.slice(
      0,
      insert.sql.toLowerCase().indexOf(" from "),
    );
    expect(selectList).not.toMatch(/scan_id|session/i);
    expect(insert.sql).not.toMatch(/"scan_id"|"session_id"/);
    expect(insert.params.filter((p) => p === SCAN)).toHaveLength(1);
    expect(insert.params).toContain("2026-10-14T00:00:00.000Z");
    expect(insert.params).not.toContain(NOW.toISOString());
  });

  it("is stored when the mark update returned the scan", async () => {
    const { repo } = fakeNeon(() => [oneRow, oneRow, oneRow]);
    expect(await repo.recordFeedback(aWrite())).toBe("stored");
  });

  it("is already_rated for the second request: the lock sees the scan, the insert and the mark match nothing", async () => {
    const { repo } = fakeNeon(() => [oneRow, noRows, noRows]);
    expect(await repo.recordFeedback(aWrite())).toBe("already_rated");
  });

  it("is scan_gone when the lock finds no scan", async () => {
    const { repo } = fakeNeon(() => [noRows, noRows, noRows]);
    expect(await repo.recordFeedback(aWrite())).toBe("scan_gone");
  });
});
