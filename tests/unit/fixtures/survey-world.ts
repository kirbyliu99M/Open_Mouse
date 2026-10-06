/**
 * One interface over two stores for the survey tests: an in-memory fake
 * (`ScanRepo` + `SurveyRepo`, no database) and the real repos on PGlite (a real
 * Postgres with the repo's own migrations applied, so the CHECKs, the unique
 * indexes and the cascades are live, and the contribution's statements run in a
 * real transaction). A test written against `SurveyWorld` runs against both, so
 * the fake's rules cannot quietly drift from the SQL's (same pattern as
 * `scan-world.ts`).
 *
 * `server-only` must be mocked by the importing test file
 * (`vi.mock("server-only", () => ({}))`); the real repos load lazily so the
 * mock is in place by then.
 *
 * Not covered by either world: two submissions for the same scan at the same
 * instant. PGlite is one connection, so the row lock that serialises them
 * (drizzle-repo.ts) is argued from Postgres' documented behaviour, not run.
 */
import type { PGlite } from "@electric-sql/pglite";
import type {
  OwnedScan,
  ScanOwnershipContext,
  ScanRepo,
} from "../../../src/server/scans/repo";
import type {
  ContributionWrite,
  RecordContributionResult,
  SurveyRepo,
} from "../../../src/server/survey/repo";
import { createFakeRepo } from "./fake-scan-repo";
import { migratedDatabase } from "./pglite";

export interface WorldScan {
  scanId: string;
  sessionId: string;
  /** The anonymous session cookie that proves ownership; null for a claimed session. */
  cookieSessionId: string | null;
}

export interface AddScanOptions {
  /** Owner of the session; null or absent is an anonymous session. */
  userId?: string | null;
  /** Anonymous session expiry; default one hour after `NOW`. Ignored when claimed. */
  expiresAt?: Date;
  hand?: "left" | "right";
  gripStated?: "palm" | "claw" | "fingertip" | null;
  handLengthMm?: number;
  palmLengthMm?: number;
  palmWidthMm?: number;
}

export interface StoredContribution {
  userId: string | null;
  consentVersion: string;
  consentedAt: Date;
  handLengthBinMm: number;
  palmWidthBinMm: number;
  gripStyle: string;
  mainUse: string | null;
  feedback: string | null;
  ratings: {
    slug: string;
    satisfaction: number;
    duration: string | null;
    painPoints: string[];
    isCurrent: boolean;
    userId: string | null;
  }[];
  otherMice: {
    brand: string;
    sizeFeel: string;
    isCurrent: boolean;
    userId: string | null;
  }[];
}

export interface SurveyWorld {
  readonly name: string;
  readonly scanRepo: ScanRepo;
  readonly surveyRepo: SurveyRepo;
  /** Empties every table, for a fresh start between tests. */
  reset(): Promise<void>;
  addUser(id: string): Promise<void>;
  /** A catalogue mouse; returns its `mice.id`. */
  addMouse(slug: string): Promise<string>;
  addScan(options?: AddScanOptions): Promise<WorldScan>;
  /** The scan's `survey_contributed_at`, or null when it has not contributed. */
  scanMark(scanId: string): Promise<Date | null>;
  /**
   * Every stored contribution with its ratings and other mice, ordered by hand
   * length bin, then palm width bin (a contribution has no timestamp finer than
   * a day, so tests tell theirs apart by giving each scan its own hand length).
   */
  contributions(): Promise<StoredContribution[]>;
  /** Everything stored for contributions, as text, for "holds no scan id" checks. */
  rawContributionText(): Promise<string>;
  /** Deletes one scan row, as `DELETE /api/scans/{id}` does. */
  deleteScan(scanId: string): Promise<void>;
  close(): Promise<void>;
}

export const NOW = new Date("2026-10-06T08:15:30.123Z");

let counter = 0;
const uuid = (prefix: string) =>
  `${prefix}0000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

/**
 * The brand key the database matches on: `lower(btrim(brand))`. ASCII-only
 * test brands keep the fake and Postgres in agreement whatever the locale.
 */
const brandKey = (brand: string) => brand.trim().toLowerCase();

const DEFAULT_SCAN = {
  hand: "right" as const,
  gripStated: null,
  handLengthMm: 186.4,
  palmLengthMm: 106.2,
  palmWidthMm: 82.7,
};

// --- the in-memory world ----------------------------------------------------

interface FakeScanRow {
  scanId: string;
  sessionId: string;
  hand: "left" | "right";
  gripStated: "palm" | "claw" | "fingertip" | null;
  handLengthMm: number;
  palmLengthMm: number;
  palmWidthMm: number;
}

interface FakeContribution {
  id: string;
  write: Omit<ContributionWrite, "scanId" | "markedAt">;
  ratings: (ContributionWrite["ratings"][number] & { userId: string | null })[];
  otherMice: (NonNullable<ContributionWrite["otherMouse"]> & {
    userId: string | null;
  })[];
  mainUse: string | null;
}

export function createFakeSurveyWorld(): SurveyWorld {
  const { repo: baseRepo, sessions } = createFakeRepo();
  const scansById = new Map<string, FakeScanRow>();
  const marks = new Map<string, Date>();
  const miceBySlug = new Map<string, string>();
  let stored: FakeContribution[] = [];

  const owns = (row: FakeScanRow, ctx: ScanOwnershipContext) => {
    const session = sessions.get(row.sessionId);
    if (!session) return false;
    if (ctx.userId !== null && session.userId === ctx.userId) return true;
    return (
      ctx.cookieSessionId !== null &&
      session.id === ctx.cookieSessionId &&
      session.userId === null &&
      session.expiresAt !== null &&
      session.expiresAt.getTime() > ctx.now.getTime()
    );
  };

  const scanRepo: ScanRepo = {
    ...baseRepo,
    async findOwnedScan(scanId, ctx): Promise<OwnedScan | null> {
      const row = scansById.get(scanId);
      if (!row || !owns(row, ctx)) return null;
      return {
        hand: row.hand,
        gripStyleStated: row.gripStated,
        measurements: {
          handLengthMm: row.handLengthMm,
          palmLengthMm: row.palmLengthMm,
          palmWidthMm: row.palmWidthMm,
        },
      };
    },
  };

  const slugOf = (mouseId: string) =>
    [...miceBySlug].find(([, id]) => id === mouseId)![0];

  const surveyRepo: SurveyRepo = {
    async findMouseIdsBySlug(slugs) {
      return new Map(
        slugs.flatMap((slug) =>
          miceBySlug.has(slug) ? [[slug, miceBySlug.get(slug)!] as const] : [],
        ),
      );
    },

    async recordContribution(
      write: ContributionWrite,
    ): Promise<RecordContributionResult> {
      if (!scansById.has(write.scanId)) return "scan_gone";
      if (marks.has(write.scanId)) return "already_contributed";
      const mine = (c: FakeContribution) =>
        write.userId !== null && c.write.userId === write.userId;
      if (write.userId !== null) {
        const rated = new Set(write.ratings.map((r) => r.mouseId));
        const marksCurrent =
          write.ratings.some((r) => r.isCurrent) ||
          write.otherMouse?.isCurrent === true;
        for (const c of stored.filter(mine)) {
          c.ratings = c.ratings.filter((r) => !rated.has(r.mouseId));
          if (marksCurrent) {
            for (const r of c.ratings) r.isCurrent = false;
            for (const o of c.otherMice) o.isCurrent = false;
          }
          if (write.mainUse !== null) c.mainUse = null;
          if (write.otherMouse) {
            c.otherMice = c.otherMice.filter(
              (o) => brandKey(o.brand) !== brandKey(write.otherMouse!.brand),
            );
          }
        }
      }
      const { scanId: _scanId, markedAt: _markedAt, ...kept } = write;
      void _scanId;
      void _markedAt;
      stored.push({
        id: uuid("3"),
        write: kept,
        ratings: write.ratings.map((r) => ({ ...r, userId: write.userId })),
        otherMice: write.otherMouse
          ? [{ ...write.otherMouse, userId: write.userId }]
          : [],
        mainUse: write.mainUse,
      });
      marks.set(write.scanId, write.markedAt);
      return "stored";
    },

    async withdrawContributions(userId) {
      const before = stored.length;
      stored = stored.filter((c) => c.write.userId !== userId);
      return before - stored.length;
    },
  };

  return {
    name: "in-memory fakes",
    scanRepo,
    surveyRepo,
    async reset() {
      sessions.clear();
      scansById.clear();
      marks.clear();
      miceBySlug.clear();
      stored = [];
    },
    async addUser() {},
    async addMouse(slug) {
      const id = uuid("2");
      miceBySlug.set(slug, id);
      return id;
    },
    async addScan(options = {}) {
      const o = { ...DEFAULT_SCAN, ...options };
      const sessionId = uuid("0");
      const userId = o.userId ?? null;
      sessions.set(sessionId, {
        id: sessionId,
        userId,
        expiresAt:
          userId === null
            ? (options.expiresAt ?? new Date(NOW.getTime() + 3_600_000))
            : null,
      });
      const scanId = uuid("1");
      scansById.set(scanId, { scanId, sessionId, ...o });
      return {
        scanId,
        sessionId,
        cookieSessionId: userId === null ? sessionId : null,
      };
    },
    async scanMark(scanId) {
      return marks.get(scanId) ?? null;
    },
    async contributions() {
      const byBins = [...stored].sort(
        (a, b) =>
          a.write.handLengthBinMm - b.write.handLengthBinMm ||
          a.write.palmWidthBinMm - b.write.palmWidthBinMm,
      );
      return byBins.map((c) => ({
        userId: c.write.userId,
        consentVersion: c.write.consentVersion,
        consentedAt: c.write.consentedAt,
        handLengthBinMm: c.write.handLengthBinMm,
        palmWidthBinMm: c.write.palmWidthBinMm,
        gripStyle: c.write.gripStyle,
        mainUse: c.mainUse,
        feedback: c.write.feedback,
        ratings: c.ratings
          .map((r) => ({
            slug: slugOf(r.mouseId),
            satisfaction: r.satisfaction,
            duration: r.duration,
            painPoints: r.painPoints,
            isCurrent: r.isCurrent,
            userId: r.userId,
          }))
          .sort((a, b) => a.slug.localeCompare(b.slug)),
        otherMice: c.otherMice.map((o) => ({
          brand: o.brand,
          sizeFeel: o.sizeFeel,
          isCurrent: o.isCurrent,
          userId: o.userId,
        })),
      }));
    },
    async rawContributionText() {
      return JSON.stringify(stored);
    },
    async deleteScan(scanId) {
      scansById.delete(scanId);
      marks.delete(scanId);
    },
    async close() {},
  };
}

// --- the real repos on PGlite -----------------------------------------------

/**
 * PGlite's drizzle driver has no `db.batch` (neon-http's atomic multi-query
 * request). Run the batch's queries in order inside one real transaction
 * instead: BEGIN, each statement, COMMIT, and ROLLBACK if any of them throws.
 * PGlite is one session, so the statements the drizzle builders send share the
 * transaction the `pg.exec` calls open. Unlike `withSequentialBatch`
 * (./pglite.ts), this keeps the all-or-nothing property the survey write
 * depends on, so a test can prove a failure leaves nothing behind.
 */
export function withTransactionalBatch<Db>(pg: PGlite, db: object): Db {
  return Object.assign(db, {
    batch: async (queries: PromiseLike<unknown>[]) => {
      await pg.exec("BEGIN");
      try {
        const results: unknown[] = [];
        for (const query of queries) results.push(await query);
        await pg.exec("COMMIT");
        return results;
      } catch (error) {
        await pg.exec("ROLLBACK");
        throw error;
      }
    },
  }) as unknown as Db;
}

export async function createPgliteSurveyWorld(): Promise<
  SurveyWorld & { pg: PGlite; db: object }
> {
  const { createDrizzleScanRepo } =
    await import("../../../src/server/scans/drizzle-repo");
  const { createDrizzleSurveyRepo } =
    await import("../../../src/server/survey/drizzle-repo");
  type ScanDb = NonNullable<Parameters<typeof createDrizzleScanRepo>[0]>;

  const { pg, db } = await migratedDatabase();
  const batchDb = withTransactionalBatch<ScanDb>(pg, db);

  const rows = async <T>(sql: string, params: unknown[] = []) =>
    (await pg.query<T>(sql, params)).rows;

  return {
    name: "real repos on PGlite",
    pg,
    db: batchDb,
    scanRepo: createDrizzleScanRepo(batchDb),
    surveyRepo: createDrizzleSurveyRepo(batchDb),
    async reset() {
      await pg.exec(
        `truncate table users, mice, scan_sessions, rate_limits cascade`,
      );
    },
    async addUser(id) {
      await pg.query(`insert into users (id) values ($1)`, [id]);
    },
    async addMouse(slug) {
      const { rows: inserted } = await pg.query<{ id: string }>(
        `insert into mice (slug, brand, model, length_mm, width_mm, height_mm, size, source_url, spec_retrieved_at)
         values ($1, 'Brand', $1, 120, 65, 38, 'medium', 'https://example.com/m', now()) returning id`,
        [slug],
      );
      return inserted[0]!.id;
    },
    async addScan(options = {}) {
      const o = { ...DEFAULT_SCAN, ...options };
      const userId = o.userId ?? null;
      const expiresAt =
        userId === null
          ? (options.expiresAt ?? new Date(NOW.getTime() + 3_600_000))
          : null;
      const { rows: session } = await pg.query<{ id: string }>(
        `insert into scan_sessions (user_id, expires_at) values ($1, $2) returning id`,
        [userId, expiresAt?.toISOString() ?? null],
      );
      const sessionId = session[0]!.id;
      const { rows: scan } = await pg.query<{ id: string }>(
        `insert into scans (session_id, hand, grip_style_stated) values ($1, $2, $3) returning id`,
        [sessionId, o.hand, o.gripStated],
      );
      const scanId = scan[0]!.id;
      await pg.query(
        `insert into scan_measurements (scan_id, hand_length_mm, palm_length_mm, palm_width_mm) values ($1, $2, $3, $4)`,
        [scanId, o.handLengthMm, o.palmLengthMm, o.palmWidthMm],
      );
      return {
        scanId,
        sessionId,
        cookieSessionId: userId === null ? sessionId : null,
      };
    },
    async scanMark(scanId) {
      const found = await rows<{ survey_contributed_at: Date | null }>(
        `select survey_contributed_at from scans where id = $1`,
        [scanId],
      );
      return found[0]?.survey_contributed_at ?? null;
    },
    async contributions() {
      const contributions = await rows<{
        id: string;
        user_id: string | null;
        consent_version: string;
        consented_at: Date;
        hand_length_bin_mm: number;
        palm_width_bin_mm: number;
        grip_style: string;
        main_use: string | null;
        feedback: string | null;
      }>(
        `select * from survey_contributions order by hand_length_bin_mm, palm_width_bin_mm, id`,
      );
      const ratings = await rows<{
        contribution_id: string;
        slug: string;
        satisfaction: number;
        duration: string | null;
        pain_points: string[];
        is_current: boolean;
        user_id: string | null;
      }>(
        `select r.*, m.slug from survey_ratings r join mice m on m.id = r.mouse_id order by m.slug`,
      );
      const others = await rows<{
        contribution_id: string;
        brand: string;
        size_feel: string;
        is_current: boolean;
        user_id: string | null;
      }>(`select * from survey_other_mice order by brand`);
      return contributions.map((c) => ({
        userId: c.user_id,
        consentVersion: c.consent_version,
        consentedAt: c.consented_at,
        handLengthBinMm: c.hand_length_bin_mm,
        palmWidthBinMm: c.palm_width_bin_mm,
        gripStyle: c.grip_style,
        mainUse: c.main_use,
        feedback: c.feedback,
        ratings: ratings
          .filter((r) => r.contribution_id === c.id)
          .map((r) => ({
            slug: r.slug,
            satisfaction: r.satisfaction,
            duration: r.duration,
            painPoints: r.pain_points,
            isCurrent: r.is_current,
            userId: r.user_id,
          })),
        otherMice: others
          .filter((o) => o.contribution_id === c.id)
          .map((o) => ({
            brand: o.brand,
            sizeFeel: o.size_feel,
            isCurrent: o.is_current,
            userId: o.user_id,
          })),
      }));
    },
    async rawContributionText() {
      const all = await Promise.all(
        ["survey_contributions", "survey_ratings", "survey_other_mice"].map(
          (table) => rows(`select * from ${table}`),
        ),
      );
      return JSON.stringify(all);
    },
    async deleteScan(scanId) {
      await pg.query(`delete from scans where id = $1`, [scanId]);
    },
    close: () => pg.close(),
  };
}
