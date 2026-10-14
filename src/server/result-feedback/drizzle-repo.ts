import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "../../db/client";
import { resultFeedback, scans } from "../../db/schema";
import type { GripStyle } from "../../lib/contracts/fit";
import type { FeedbackWrite, ResultFeedbackRepo } from "./repo";

type Db = ReturnType<typeof getDb>;
type Statements = [BatchItem<"pg">, ...BatchItem<"pg">[]];

/**
 * A bound value in the select list of an INSERT ... SELECT, cast to the type of
 * the column it fills (a bare parameter there is typed as text before it is
 * assigned, which a uuid, smallint, enum or jsonb column refuses). `type` is
 * always one of this file's own literals, never input. Same helper as the
 * survey repo's.
 */
function cast<T>(value: unknown, type: string, alias: string) {
  return sql<T>`${value}::${sql.raw(type)}`.as(alias);
}

/**
 * The statements of one rating, in the order `db.batch` runs them as a single
 * atomic request (the HTTP driver has no interactive transactions). Exported
 * for the PGlite tests, which run them inside a real transaction. The same
 * shape as the survey's `buildContributionStatements`; nothing can branch, so
 * "this scan has not been rated yet" is the guard on the statements, not a
 * check beforehand:
 *
 *  1. `SELECT ... FOR UPDATE` on the scan row. It takes the row lock, so a
 *     second rating of the same scan waits here until the first has committed
 *     and the later statements then see its mark (each statement of a READ
 *     COMMITTED transaction takes a fresh snapshot). It also says whether the
 *     scan still exists.
 *  2. The feedback row, as `INSERT ... SELECT ... FROM scans WHERE
 *     result_feedback_at IS NULL`: no unmarked scan, no row.
 *  3. The scan's mark, `WHERE result_feedback_at IS NULL RETURNING`: one row
 *     back means this write is the one that marked it.
 */
export function buildFeedbackStatements(
  db: Db,
  write: FeedbackWrite,
): Statements {
  const { snapshot } = write;
  return [
    db
      .select({ id: scans.id })
      .from(scans)
      .where(eq(scans.id, write.scanId))
      .for("update"),

    db.insert(resultFeedback).select(
      db
        .select({
          id: sql<string>`gen_random_uuid()`.as("id"),
          userId: cast<string | null>(write.userId, "text", "userId"),
          noticeVersion: cast<string>(write.noticeVersion, "text", "notice"),
          stars: cast<number>(write.stars, "smallint", "stars"),
          comment: cast<string | null>(write.comment, "text", "comment"),
          locale: cast<string>(write.locale, "text", "locale"),
          engineVersion: cast<string>(
            snapshot.engineVersion,
            "text",
            "engineVersion",
          ),
          handSize: cast<string | null>(snapshot.handSize, "text", "handSize"),
          handWidth: cast<string | null>(
            snapshot.handWidth,
            "text",
            "handWidth",
          ),
          grip: cast<GripStyle>(snapshot.grip, "grip_style", "grip"),
          calibrationMethod: cast<string>(
            snapshot.calibrationMethod,
            "text",
            "calibrationMethod",
          ),
          palmThicknessStated: cast<string | null>(
            snapshot.palmThicknessStated,
            "text",
            "palmThicknessStated",
          ),
          topMice: cast<{ slug: string; band: string }[]>(
            JSON.stringify(snapshot.topMice),
            "jsonb",
            "topMice",
          ),
          createdOn: cast<Date>(
            write.createdOn.toISOString(),
            "timestamptz",
            "createdOn",
          ),
        })
        .from(scans)
        .where(and(eq(scans.id, write.scanId), isNull(scans.resultFeedbackAt))),
    ),

    db
      .update(scans)
      .set({ resultFeedbackAt: write.markedAt })
      .where(and(eq(scans.id, write.scanId), isNull(scans.resultFeedbackAt)))
      .returning({ id: scans.id }),
  ];
}

/** The real `ResultFeedbackRepo`, over the Neon HTTP driver. */
export function createDrizzleResultFeedbackRepo(
  db: Db = getDb(),
): ResultFeedbackRepo {
  return {
    async recordFeedback(write) {
      const results = (await db.batch(
        buildFeedbackStatements(db, write),
      )) as unknown[][];
      if (results[0]!.length === 0) return "scan_gone";
      return results[2]!.length > 0 ? "stored" : "already_rated";
    },

    async isRated(scanId) {
      const rows = await db
        .select({ rated: sql<boolean>`${scans.resultFeedbackAt} is not null` })
        .from(scans)
        .where(eq(scans.id, scanId))
        .limit(1);
      return rows[0] === undefined ? null : rows[0].rated;
    },

    async withdrawFeedback(userId) {
      const removed = await db
        .delete(resultFeedback)
        .where(eq(resultFeedback.userId, userId))
        .returning({ id: resultFeedback.id });
      return removed.length;
    },
  };
}
