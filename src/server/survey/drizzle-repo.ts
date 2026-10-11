import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
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
  AnswersWrite,
  ContributionWrite,
  RecordContributionResult,
  ReplaceAnswersResult,
  StoredAnswers,
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
 * The repeat rules for a signed-in person (see `SurveyRepo.recordContribution`):
 * the current marker is cleared and the earlier main use emptied BEFORE the new
 * rows go in, so those rules never touch what this write adds; a rating or an
 * other mouse the person gave before is replaced by the upsert that adds the
 * new one (the comment above the rating statements says why).
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
  }

  // A signed-in person's rating of a mouse, or answer for a brand slug, they
  // gave before is REPLACED by `ON CONFLICT ... DO UPDATE` on the partial unique
  // index (user_id, mouse_id) / (user_id, brand), and the earlier row moves to
  // this contribution. An upsert, not a delete and an insert, because of the
  // current marker: a write that marks no mouse as current leaves the person's
  // marker where it was (survey.ts), and that includes a marker sitting on the
  // very row this write replaces, which a delete would lose. When the write DOES
  // mark one, the clearing UPDATEs above have already emptied the old markers,
  // so `excluded.is_current OR is_current` is just the new value. An anonymous
  // write has no conflict to resolve: NULL user ids are outside both indexes.
  for (const rating of write.ratings) {
    const insertRating = db.insert(surveyRatings).select(
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
    );
    statements.push(
      userId === null
        ? insertRating
        : insertRating.onConflictDoUpdate({
            target: [surveyRatings.userId, surveyRatings.mouseId],
            targetWhere: isNotNull(surveyRatings.userId),
            set: {
              contributionId: sql`excluded.contribution_id`,
              satisfaction: sql`excluded.satisfaction`,
              duration: sql`excluded.duration`,
              painPoints: sql`excluded.pain_points`,
              isCurrent: sql`excluded.is_current OR ${surveyRatings.isCurrent}`,
            },
          }),
    );
  }

  if (write.otherMouse !== null) {
    const other = write.otherMouse;
    const insertOther = db.insert(surveyOtherMice).select(
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
    );
    statements.push(
      userId === null
        ? insertOther
        : insertOther.onConflictDoUpdate({
            target: [surveyOtherMice.userId, surveyOtherMice.brand],
            targetWhere: isNotNull(surveyOtherMice.userId),
            set: {
              contributionId: sql`excluded.contribution_id`,
              sizeFeel: sql`excluded.size_feel`,
              isCurrent: sql`excluded.is_current OR ${surveyOtherMice.isCurrent}`,
            },
          }),
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

/**
 * The person's latest contribution: the newest `consented_at`, then the larger
 * id. A contribution keeps no instant finer than a day (schema.ts), so two of
 * the same UTC day tie and the id, a random uuid, breaks the tie: stable, but
 * not chronological. Used by the read and the edit alike, so what the edit
 * writes is what the read gives back.
 */
const latestOrder = [
  desc(surveyContributions.consentedAt),
  desc(surveyContributions.id),
] as const;

/** A subquery naming the id of the person's latest contribution (NULL if none). */
function latestContributionId(userId: string) {
  return sql`(select ${surveyContributions.id} from ${surveyContributions} where ${surveyContributions.userId} = ${userId} order by ${surveyContributions.consentedAt} desc, ${surveyContributions.id} desc limit 1)`;
}

/**
 * The statements of one edit, in the order `db.batch` runs them as a single
 * atomic request. Exported for the PGlite tests, which run them inside a real
 * transaction. As in `buildContributionStatements` nothing can branch, so "the
 * person has a contribution" is not checked beforehand: it is the guard on
 * every statement.
 *
 *  1. `SELECT ... FOR UPDATE` on the person's latest contribution row. A second
 *     edit waits here until the first has committed, and every later statement
 *     then sees the first's rows (each statement of a READ COMMITTED
 *     transaction takes a fresh snapshot), so two edits end as one of the two
 *     bodies, never a mix; a withdrawal waits here too. No row back means the
 *     person has no contribution: the result is `no_contribution`, and every
 *     other statement matched nothing.
 *  2. Ratings and other mice the body leaves out are deleted.
 *  3. Each named rating and other mouse is upserted on the partial unique index
 *     (user_id, mouse_id) / (user_id, brand), attached to the latest
 *     contribution when new. On conflict the row keeps the contribution it has
 *     (and so the hand profile it was given with) and takes the body's values
 *     and the body's marker EXACTLY: unlike a submission, `is_current` is not
 *     OR-ed with the old one, so "no current mouse" is possible. Every named
 *     row's marker is written, and the rows not named are gone, so no earlier
 *     marker survives an edit.
 *  4. `main_use` is emptied on the person's other contributions, then set,
 *     with the comment, on the latest one. Earlier comments are left alone.
 *
 * A contribution row's hand profile, grip, consent columns and the scans' marks
 * are never named in any statement.
 */
export function buildReplaceAnswersStatements(
  db: Db,
  userId: string,
  write: AnswersWrite,
): Statements {
  const latest = latestContributionId(userId);
  const hasContribution = () =>
    exists(
      db
        .select({ one: sql`1` })
        .from(surveyContributions)
        .where(eq(surveyContributions.userId, userId)),
    );

  const statements: BatchItem<"pg">[] = [
    db
      .select({ id: surveyContributions.id })
      .from(surveyContributions)
      .where(eq(surveyContributions.id, latest))
      .for("update"),

    db.delete(surveyRatings).where(
      and(
        eq(surveyRatings.userId, userId),
        write.ratings.length > 0
          ? notInArray(
              surveyRatings.mouseId,
              write.ratings.map((rating) => rating.mouseId),
            )
          : undefined,
        hasContribution(),
      ),
    ),
    db.delete(surveyOtherMice).where(
      and(
        eq(surveyOtherMice.userId, userId),
        write.otherMice.length > 0
          ? notInArray(
              surveyOtherMice.brand,
              write.otherMice.map((other) => other.brand),
            )
          : undefined,
        hasContribution(),
      ),
    ),
  ];

  for (const rating of write.ratings) {
    statements.push(
      db
        .insert(surveyRatings)
        .select(
          db
            .select({
              contributionId: surveyContributions.id,
              mouseId: cast<string>(rating.mouseId, "uuid", "mouseId"),
              userId: cast<string | null>(userId, "text", "userId"),
              satisfaction: cast<number>(
                rating.satisfaction,
                "smallint",
                "satisfaction",
              ),
              duration: cast<string | null>(
                rating.duration,
                "text",
                "duration",
              ),
              painPoints: cast<PainPoint[]>(
                JSON.stringify(rating.painPoints),
                "jsonb",
                "painPoints",
              ),
              isCurrent: cast<boolean>(
                rating.isCurrent,
                "boolean",
                "isCurrent",
              ),
            })
            .from(surveyContributions)
            .where(eq(surveyContributions.id, latest)),
        )
        .onConflictDoUpdate({
          target: [surveyRatings.userId, surveyRatings.mouseId],
          targetWhere: isNotNull(surveyRatings.userId),
          set: {
            satisfaction: sql`excluded.satisfaction`,
            duration: sql`excluded.duration`,
            painPoints: sql`excluded.pain_points`,
            isCurrent: sql`excluded.is_current`,
          },
        }),
    );
  }

  for (const other of write.otherMice) {
    statements.push(
      db
        .insert(surveyOtherMice)
        .select(
          db
            .select({
              id: sql<string>`gen_random_uuid()`.as("id"),
              contributionId: surveyContributions.id,
              userId: cast<string | null>(userId, "text", "userId"),
              brand: cast<string>(other.brand, "text", "brand"),
              sizeFeel: cast<string>(other.sizeFeel, "text", "sizeFeel"),
              isCurrent: cast<boolean>(other.isCurrent, "boolean", "isCurrent"),
            })
            .from(surveyContributions)
            .where(eq(surveyContributions.id, latest)),
        )
        .onConflictDoUpdate({
          target: [surveyOtherMice.userId, surveyOtherMice.brand],
          targetWhere: isNotNull(surveyOtherMice.userId),
          set: {
            sizeFeel: sql`excluded.size_feel`,
            isCurrent: sql`excluded.is_current`,
          },
        }),
    );
  }

  statements.push(
    db
      .update(surveyContributions)
      .set({ mainUse: null })
      .where(
        and(
          eq(surveyContributions.userId, userId),
          isNotNull(surveyContributions.mainUse),
          ne(surveyContributions.id, latest),
        ),
      ),
    db
      .update(surveyContributions)
      .set({ mainUse: write.mainUse, feedback: write.feedback })
      .where(eq(surveyContributions.id, latest)),
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

    async readAnswers(userId): Promise<StoredAnswers> {
      // One request, four SELECTs. READ COMMITTED gives each statement its own
      // snapshot, so a read that lands in the middle of an edit's commit could
      // pair one edit's ratings with another's main use; the edit commits as one
      // transaction, so the window is a single instant, and a reload shows the
      // finished edit.
      const [latest, use, ratings, others] = await db.batch([
        db
          .select({ feedback: surveyContributions.feedback })
          .from(surveyContributions)
          .where(eq(surveyContributions.userId, userId))
          .orderBy(...latestOrder)
          .limit(1),
        db
          .select({ mainUse: surveyContributions.mainUse })
          .from(surveyContributions)
          .where(
            and(
              eq(surveyContributions.userId, userId),
              isNotNull(surveyContributions.mainUse),
            ),
          )
          .orderBy(...latestOrder)
          .limit(1),
        db
          .select({
            slug: mice.slug,
            satisfaction: surveyRatings.satisfaction,
            duration: surveyRatings.duration,
            painPoints: surveyRatings.painPoints,
            isCurrent: surveyRatings.isCurrent,
          })
          .from(surveyRatings)
          .innerJoin(mice, eq(mice.id, surveyRatings.mouseId))
          .where(eq(surveyRatings.userId, userId))
          .orderBy(asc(mice.slug)),
        db
          .select({
            brand: surveyOtherMice.brand,
            sizeFeel: surveyOtherMice.sizeFeel,
            isCurrent: surveyOtherMice.isCurrent,
          })
          .from(surveyOtherMice)
          .where(eq(surveyOtherMice.userId, userId))
          .orderBy(asc(surveyOtherMice.brand)),
      ]);
      return {
        mainUse: use[0]?.mainUse ?? null,
        feedback: latest[0]?.feedback ?? null,
        ratings,
        otherMice: others,
      };
    },

    async replaceAnswers(userId, write): Promise<ReplaceAnswersResult> {
      const results = (await db.batch(
        buildReplaceAnswersStatements(db, userId, write),
      )) as unknown[][];
      return results[0]!.length > 0 ? "stored" : "no_contribution";
    },
  };
}
