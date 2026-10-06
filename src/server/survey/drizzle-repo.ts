import "server-only";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "../../db/client";
import {
  mice,
  scans,
  surveyContributions,
  surveyOtherMice,
  surveyRatings,
} from "../../db/schema";
import type { GripStyle } from "../../lib/contracts/fit";
import type { PainPoint } from "../../lib/contracts/survey";
import type {
  ContributionWrite,
  RecordContributionResult,
  SurveyRepo,
} from "./repo";

type Db = ReturnType<typeof getDb>;
type Statements = [BatchItem<"pg">, ...BatchItem<"pg">[]];

/**
 * A bound value in the select list of an INSERT ... SELECT, cast to the type of
 * the column it fills. The cast matters: a bare parameter there is typed as
 * text before it is assigned, which a uuid, smallint, enum or jsonb column
 * refuses. `type` is always one of this file's own literals, never input.
 */
function cast<T>(value: unknown, type: string, alias: string) {
  return sql<T>`${value}::${sql.raw(type)}`.as(alias);
}

/**
 * The statements of one contribution, in the order `db.batch` runs them as a
 * single atomic request (the HTTP driver has no interactive transactions, and
 * `db.batch` is what `createDrizzleScanRepo` already uses for the same reason).
 * Exported for the PGlite tests, which run them inside a real transaction.
 *
 * There is no way to branch inside a batch, so "this scan has not contributed
 * yet" is not checked beforehand: it is the guard on every statement.
 *
 *  1. `SELECT ... FOR UPDATE` on the scan row. It takes the row lock, so a
 *     second submission for the same scan waits here until the first has
 *     committed, and every later statement then sees the first's mark (each
 *     statement of a READ COMMITTED transaction takes a fresh snapshot). It
 *     also says whether the scan still exists.
 *  2. The contribution row, as `INSERT ... SELECT ... FROM scans WHERE
 *     survey_contributed_at IS NULL`: no unmarked scan, no row.
 *  3. Every later statement is guarded by "the contribution row of THIS write
 *     exists" (an INSERT ... SELECT from it, or an EXISTS), so when step 2
 *     inserted nothing they all do nothing. The loser of a race, or a repeat
 *     request, therefore changes nothing, replaces nothing, and gets a 409.
 *  4. The scan's mark, last, `WHERE survey_contributed_at IS NULL RETURNING`:
 *     one row back means this write is the one that marked it.
 *
 * Any statement that errors (a rating for a mouse that is gone, say) aborts the
 * whole batch, so the contribution and the mark are never half-written.
 *
 * The repeat rules for a signed-in person (see `SurveyRepo.recordContribution`)
 * run before the new rows go in, so they never touch what this write adds.
 */
export function buildContributionStatements(
  db: Db,
  write: ContributionWrite,
  contributionId: string,
): Statements {
  const thisContributionExists = () =>
    exists(
      db
        .select({ one: sql`1` })
        .from(surveyContributions)
        .where(eq(surveyContributions.id, contributionId)),
    );

  const statements: BatchItem<"pg">[] = [
    db
      .select({ id: scans.id })
      .from(scans)
      .where(eq(scans.id, write.scanId))
      .for("update"),

    db.insert(surveyContributions).select(
      db
        .select({
          id: cast<string>(contributionId, "uuid", "id"),
          userId: cast<string | null>(write.userId, "text", "userId"),
          consentVersion: cast<string>(
            write.consentVersion,
            "text",
            "consentVersion",
          ),
          consentedAt: cast<Date>(
            write.consentedAt.toISOString(),
            "timestamptz",
            "consentedAt",
          ),
          handLengthBinMm: cast<number>(
            write.handLengthBinMm,
            "smallint",
            "handLengthBinMm",
          ),
          palmWidthBinMm: cast<number>(
            write.palmWidthBinMm,
            "smallint",
            "palmWidthBinMm",
          ),
          gripStyle: cast<GripStyle>(
            write.gripStyle,
            "grip_style",
            "gripStyle",
          ),
          mainUse: cast<string | null>(write.mainUse, "text", "mainUse"),
          feedback: cast<string | null>(write.feedback, "text", "feedback"),
        })
        .from(scans)
        .where(
          and(eq(scans.id, write.scanId), isNull(scans.surveyContributedAt)),
        ),
    ),
  ];

  const { userId } = write;
  if (userId !== null) {
    if (write.ratings.length > 0) {
      statements.push(
        db.delete(surveyRatings).where(
          and(
            eq(surveyRatings.userId, userId),
            inArray(
              surveyRatings.mouseId,
              write.ratings.map((rating) => rating.mouseId),
            ),
            thisContributionExists(),
          ),
        ),
      );
    }
    if (
      write.ratings.some((rating) => rating.isCurrent) ||
      write.otherMouse?.isCurrent === true
    ) {
      statements.push(
        db
          .update(surveyRatings)
          .set({ isCurrent: false })
          .where(
            and(
              eq(surveyRatings.userId, userId),
              eq(surveyRatings.isCurrent, true),
              thisContributionExists(),
            ),
          ),
        db
          .update(surveyOtherMice)
          .set({ isCurrent: false })
          .where(
            and(
              eq(surveyOtherMice.userId, userId),
              eq(surveyOtherMice.isCurrent, true),
              thisContributionExists(),
            ),
          ),
      );
    }
    if (write.mainUse !== null) {
      statements.push(
        db
          .update(surveyContributions)
          .set({ mainUse: null })
          .where(
            and(
              eq(surveyContributions.userId, userId),
              ne(surveyContributions.id, contributionId),
              isNotNull(surveyContributions.mainUse),
              thisContributionExists(),
            ),
          ),
      );
    }
    if (write.otherMouse !== null) {
      statements.push(
        db
          .delete(surveyOtherMice)
          .where(
            and(
              eq(surveyOtherMice.userId, userId),
              sql`lower(btrim(${surveyOtherMice.brand})) = lower(btrim(${write.otherMouse.brand}))`,
              thisContributionExists(),
            ),
          ),
      );
    }
  }

  for (const rating of write.ratings) {
    statements.push(
      db.insert(surveyRatings).select(
        db
          .select({
            contributionId: cast<string>(
              contributionId,
              "uuid",
              "contributionId",
            ),
            mouseId: cast<string>(rating.mouseId, "uuid", "mouseId"),
            userId: cast<string | null>(write.userId, "text", "userId"),
            satisfaction: cast<number>(
              rating.satisfaction,
              "smallint",
              "satisfaction",
            ),
            duration: cast<string | null>(rating.duration, "text", "duration"),
            painPoints: cast<PainPoint[]>(
              JSON.stringify(rating.painPoints),
              "jsonb",
              "painPoints",
            ),
            isCurrent: cast<boolean>(rating.isCurrent, "boolean", "isCurrent"),
          })
          .from(surveyContributions)
          .where(eq(surveyContributions.id, contributionId)),
      ),
    );
  }

  if (write.otherMouse !== null) {
    const other = write.otherMouse;
    statements.push(
      db.insert(surveyOtherMice).select(
        db
          .select({
            id: sql<string>`gen_random_uuid()`.as("id"),
            contributionId: cast<string>(
              contributionId,
              "uuid",
              "contributionId",
            ),
            userId: cast<string | null>(write.userId, "text", "userId"),
            brand: cast<string>(other.brand, "text", "brand"),
            sizeFeel: cast<string>(other.sizeFeel, "text", "sizeFeel"),
            isCurrent: cast<boolean>(other.isCurrent, "boolean", "isCurrent"),
          })
          .from(surveyContributions)
          .where(eq(surveyContributions.id, contributionId)),
      ),
    );
  }

  statements.push(
    db
      .update(scans)
      .set({ surveyContributedAt: write.markedAt })
      .where(and(eq(scans.id, write.scanId), isNull(scans.surveyContributedAt)))
      .returning({ id: scans.id }),
  );

  return statements as Statements;
}

/** The real `SurveyRepo`, over the Neon HTTP driver. */
export function createDrizzleSurveyRepo(db: Db = getDb()): SurveyRepo {
  return {
    async findMouseIdsBySlug(slugs) {
      if (slugs.length === 0) return new Map();
      const rows = await db
        .select({ id: mice.id, slug: mice.slug })
        .from(mice)
        .where(inArray(mice.slug, [...slugs]));
      return new Map(rows.map((row) => [row.slug, row.id]));
    },

    async recordContribution(write): Promise<RecordContributionResult> {
      // Generated here so every statement of the batch can name the row before
      // any of it exists (same pattern as `insertScanWithMeasurements`).
      const statements = buildContributionStatements(
        db,
        write,
        crypto.randomUUID(),
      );
      const results = (await db.batch(statements)) as unknown[][];
      const scanFound = results[0]!.length > 0;
      const marked = results[results.length - 1]!.length > 0;
      if (!scanFound) return "scan_gone";
      return marked ? "stored" : "already_contributed";
    },

    async withdrawContributions(userId) {
      // Ratings and other mice cascade from the contribution row.
      const removed = await db
        .delete(surveyContributions)
        .where(eq(surveyContributions.userId, userId))
        .returning({ id: surveyContributions.id });
      return removed.length;
    },
  };
}
