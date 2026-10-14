/**
 * Migration 0013 and the real feedback repo on a real Postgres (PGlite): the
 * table's shape and CHECKs, that a row holds no scan or session link, that the
 * one-rating-per-scan rule is decided inside the write (the second request
 * changes nothing), that deleting a scan keeps its feedback, that "Delete
 * everything" removes the caller's feedback only, and that deleting a user
 * cascades. Two requests at the same instant are not run (PGlite is one
 * connection); the row lock that serialises them is pinned in
 * result-feedback-neon.test.ts and argued in drizzle-repo.ts.
 */
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

import { RESULT_FEEDBACK_NOTICE_VERSION } from "../../src/lib/contracts/result-feedback";
import { MAX_FEEDBACK_CHARS } from "../../src/lib/contracts/survey";
import { handleAccountDeleteAll } from "../../src/server/account/handlers";
import type { AccountRepo } from "../../src/server/account/repo";
import type { FeedbackWrite } from "../../src/server/result-feedback/repo";
import {
  NOW,
  createPgliteSurveyWorld,
  withTransactionalBatch,
} from "./fixtures/survey-world";

const write = (
  scanId: string,
  over: Partial<FeedbackWrite> = {},
): FeedbackWrite => ({
  scanId,
  userId: null,
  noticeVersion: RESULT_FEEDBACK_NOTICE_VERSION,
  stars: 5,
  comment: "nice",
  locale: "zh-TW",
  snapshot: {
    engineVersion: "fit-v1-candidate.3",
    handSize: null,
    handWidth: null,
    grip: "claw",
    calibrationMethod: "printed-sheet",
    palmThicknessStated: null,
    topMice: [
      { slug: "mouse-a", band: "good" },
      { slug: "mouse-b", band: "fair" },
    ],
  },
  createdOn: new Date("2026-10-14T00:00:00.000Z"),
  markedAt: NOW,
  ...over,
});

describe("result feedback on a real Postgres", () => {
  let world: Awaited<ReturnType<typeof createPgliteSurveyWorld>>;
  let feedbackRepo: import("../../src/server/result-feedback/repo").ResultFeedbackRepo;
  let accountRepo: AccountRepo;

  beforeAll(async () => {
    world = await createPgliteSurveyWorld();
    const { createDrizzleResultFeedbackRepo } =
      await import("../../src/server/result-feedback/drizzle-repo");
    const { createDrizzleAccountRepo } =
      await import("../../src/server/account/drizzle-repo");
    type FeedbackDb = NonNullable<
      Parameters<typeof createDrizzleResultFeedbackRepo>[0]
    >;
    type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];
    feedbackRepo = createDrizzleResultFeedbackRepo(
      withTransactionalBatch<FeedbackDb>(world.pg, world.db),
    );
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

  const rows = async <T = Record<string, unknown>>(sql: string) =>
    (await world.pg.query<T>(sql)).rows;
  const feedbackCount = async () =>
    (
      await rows<{ n: number }>(
        `select count(*)::int as n from result_feedback`,
      )
    )[0]!.n;
  const mark = async (scanId: string) =>
    (
      await world.pg.query<{ m: Date | null }>(
        `select result_feedback_at as m from scans where id = $1`,
        [scanId],
      )
    ).rows[0]!.m;

  it("is a table with no scan or session link and no timestamp but the day", async () => {
    const columns = (
      await rows<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = 'result_feedback'`,
      )
    ).map((r) => r.column_name);
    expect(columns.sort()).toEqual(
      [
        "id",
        "user_id",
        "notice_version",
        "stars",
        "comment",
        "locale",
        "engine_version",
        "hand_size",
        "hand_width",
        "grip",
        "calibration_method",
        "palm_thickness_stated",
        "top_mice",
        "created_on",
      ].sort(),
    );
    const fks = await rows<{ t: string }>(
      `select confrelid::regclass::text as t from pg_constraint where conrelid = 'result_feedback'::regclass and contype = 'f'`,
    );
    expect(fks).toEqual([{ t: "users" }]);
  });

  it("stores a row and marks the scan with the exact instant, the row with the day only", async () => {
    const scan = await world.addScan({ userId: "user-1" });
    expect(
      await feedbackRepo.recordFeedback(
        write(scan.scanId, { userId: "user-1" }),
      ),
    ).toBe("stored");
    expect(await mark(scan.scanId)).toEqual(NOW);
    const [row] = await rows<Record<string, unknown>>(
      `select * from result_feedback`,
    );
    expect(row).toMatchObject({
      user_id: "user-1",
      stars: 5,
      comment: "nice",
      grip: "claw",
      top_mice: [
        { slug: "mouse-a", band: "good" },
        { slug: "mouse-b", band: "fair" },
      ],
      created_on: new Date("2026-10-14T00:00:00.000Z"),
    });
    expect(JSON.stringify(row)).not.toContain(scan.scanId);
    expect(JSON.stringify(row)).not.toContain(scan.sessionId);
  });

  it("answers already_rated to a second request for the same scan and stores or replaces nothing", async () => {
    const scan = await world.addScan();
    expect(await feedbackRepo.recordFeedback(write(scan.scanId))).toBe(
      "stored",
    );
    expect(
      await feedbackRepo.recordFeedback(
        write(scan.scanId, {
          stars: 1,
          comment: "second",
          markedAt: new Date(NOW.getTime() + 5000),
        }),
      ),
    ).toBe("already_rated");
    expect(await feedbackCount()).toBe(1);
    expect(await rows(`select stars, comment from result_feedback`)).toEqual([
      { stars: 5, comment: "nice" },
    ]);
    expect(await mark(scan.scanId)).toEqual(NOW);
  });

  it("answers scan_gone for a scan that no longer exists and stores nothing", async () => {
    const scan = await world.addScan();
    await world.deleteScan(scan.scanId);
    expect(await feedbackRepo.recordFeedback(write(scan.scanId))).toBe(
      "scan_gone",
    );
    expect(await feedbackCount()).toBe(0);
  });

  it("reads the mark: isRated is false, then true, and null for no scan", async () => {
    const scan = await world.addScan();
    expect(await feedbackRepo.isRated(scan.scanId)).toBe(false);
    await feedbackRepo.recordFeedback(write(scan.scanId));
    expect(await feedbackRepo.isRated(scan.scanId)).toBe(true);
    expect(
      await feedbackRepo.isRated("99999999-9999-4999-8999-999999999999"),
    ).toBeNull();
  });

  it("keeps the feedback when its scan is deleted", async () => {
    const scan = await world.addScan({ userId: "user-1" });
    await feedbackRepo.recordFeedback(write(scan.scanId, { userId: "user-1" }));
    await world.deleteScan(scan.scanId);
    expect(await feedbackCount()).toBe(1);
  });

  it("keeps a null user id for an anonymous rating, also after the session is claimed", async () => {
    const scan = await world.addScan();
    await feedbackRepo.recordFeedback(write(scan.scanId));
    await world.pg.query(
      `update scan_sessions set user_id = 'user-1', expires_at = null`,
    );
    expect(await rows(`select user_id from result_feedback`)).toEqual([
      { user_id: null },
    ]);
  });

  it("Delete everything removes the caller's feedback and no one else's", async () => {
    const mine = await world.addScan({ userId: "user-1", handLengthMm: 181 });
    const theirs = await world.addScan({ userId: "user-2", handLengthMm: 192 });
    const anon = await world.addScan({ handLengthMm: 170 });
    await feedbackRepo.recordFeedback(
      write(mine.scanId, { userId: "user-1", comment: "mine-text" }),
    );
    await feedbackRepo.recordFeedback(
      write(theirs.scanId, { userId: "user-2" }),
    );
    await feedbackRepo.recordFeedback(write(anon.scanId));

    const res = await handleAccountDeleteAll({
      repo: accountRepo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(
      (
        await rows<{ user_id: string | null }>(
          `select user_id from result_feedback order by user_id nulls last`,
        )
      ).map((r) => r.user_id),
    ).toEqual(["user-2", null]);
    expect(
      JSON.stringify(await rows(`select * from result_feedback`)),
    ).not.toContain("mine-text");
  });

  it("cascades from the user row (the inactive purge deletes users)", async () => {
    const scan = await world.addScan({ userId: "user-1" });
    await feedbackRepo.recordFeedback(write(scan.scanId, { userId: "user-1" }));
    await world.pg.query(`delete from users where id = 'user-1'`);
    expect(await feedbackCount()).toBe(0);
  });

  it("withdrawFeedback deletes one account's rows and says how many", async () => {
    for (const hand of [170, 171]) {
      const s = await world.addScan({ userId: "user-1", handLengthMm: hand });
      await feedbackRepo.recordFeedback(write(s.scanId, { userId: "user-1" }));
    }
    expect(await feedbackRepo.withdrawFeedback("user-1")).toBe(2);
    expect(await feedbackRepo.withdrawFeedback("user-1")).toBe(0);
  });

  describe("CHECK constraints", () => {
    const insert = (over: Record<string, string>) => {
      const v = {
        notice_version: "'n'",
        stars: "3",
        comment: "null",
        created_on: "'2026-10-14T00:00:00Z'",
        top_mice: "'[]'::jsonb",
        ...over,
      };
      return world.pg.query(
        `insert into result_feedback (notice_version, stars, comment, locale, engine_version, grip, calibration_method, top_mice, created_on)
         values (${v.notice_version}, ${v.stars}, ${v.comment}, 'zh-TW', 'v1', 'claw', 'printed-sheet', ${v.top_mice}, ${v.created_on})`,
      );
    };

    it("accepts the edges", async () => {
      await insert({ stars: "1" });
      await insert({
        stars: "5",
        comment: `'${"x".repeat(MAX_FEEDBACK_CHARS)}'`,
      });
      expect(await feedbackCount()).toBe(2);
    });

    it.each([
      ["stars 0", { stars: "0" }],
      ["stars 6", { stars: "6" }],
      ["an empty comment", { comment: "''" }],
      [
        "a too long comment",
        { comment: `'${"x".repeat(MAX_FEEDBACK_CHARS + 1)}'` },
      ],
      ["an empty notice version", { notice_version: "''" }],
      [
        "a created_on that is not midnight UTC",
        { created_on: "'2026-10-14T00:00:01Z'" },
      ],
      ["top_mice that is not an array", { top_mice: `'{}'::jsonb` }],
    ])("refuses %s", async (_name, over) => {
      await expect(insert(over)).rejects.toThrow();
    });
  });

  it("adds the scans column as nullable, so migrating is additive", async () => {
    const [col] = await rows<{
      is_nullable: string;
      column_default: string | null;
    }>(
      `select is_nullable, column_default from information_schema.columns where table_name = 'scans' and column_name = 'result_feedback_at'`,
    );
    expect(col).toEqual({ is_nullable: "YES", column_default: null });
  });
});
