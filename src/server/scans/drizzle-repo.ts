import "server-only";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../../db/client";
import { scanMeasurements, scanSessions, scans } from "../../db/schema";
import type { ScanInsertInput, ScanRepo, SessionRecord } from "./repo";

/**
 * The real `ScanRepo`, over the Neon HTTP driver.
 *
 * `insertScanWithMeasurements` uses `db.batch(...)` rather than a CTE: the
 * driver has no interactive transactions, but `db.batch` sends the whole
 * array as one HTTP request that Neon executes atomically, so a mid-way
 * failure leaves neither row. The application generates `scans.id` itself
 * (`crypto.randomUUID()`, same pattern as `users.id` in `src/db/schema.ts`)
 * so the `scan_measurements` statement can reference it up front — a
 * database-generated id from the first statement wouldn't be available to
 * the second until the batch already ran. A CTE (`WITH s AS (INSERT INTO
 * scans ... RETURNING id) INSERT INTO scan_measurements SELECT id FROM s
 * ...`) would work too, but `db.batch` keeps both inserts as ordinary
 * Drizzle query builders instead of one hand-written SQL string.
 */
export function createDrizzleScanRepo(db = getDb()): ScanRepo {
  return {
    async findValidSession(sessionId, now): Promise<SessionRecord | null> {
      const rows = await db
        .select({ id: scanSessions.id })
        .from(scanSessions)
        .where(
          and(
            eq(scanSessions.id, sessionId),
            // A signed-in session (M6) has no expiresAt and never expires here.
            or(isNull(scanSessions.expiresAt), gt(scanSessions.expiresAt, now)),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async createAnonymousSession(expiresAt): Promise<SessionRecord> {
      const [row] = await db
        .insert(scanSessions)
        .values({ expiresAt })
        .returning({ id: scanSessions.id });
      return row;
    },

    async insertScanWithMeasurements(input: ScanInsertInput) {
      const scanId = crypto.randomUUID();
      const m = input.measurements;
      await db.batch([
        db.insert(scans).values({
          id: scanId,
          sessionId: input.sessionId,
          hand: input.hand,
          gripStyleStated: input.gripStyleStated ?? undefined,
          gripStylePredicted: null, // M3
        }),
        db.insert(scanMeasurements).values({
          scanId,
          handLengthMm: m.handLengthMm,
          palmLengthMm: m.palmLengthMm,
          palmWidthMm: m.palmWidthMm,
          thumbLengthMm: m.thumbLengthMm,
          indexLengthMm: m.indexLengthMm,
          middleLengthMm: m.middleLengthMm,
          ringLengthMm: m.ringLengthMm,
          pinkyLengthMm: m.pinkyLengthMm,
          palmThicknessMm: m.palmThicknessMm,
          knuckleHeightMm: m.knuckleHeightMm,
          gripApertureMm: m.gripApertureMm,
          thumbAngleDeg: m.thumbAngleDeg,
          scaleCheckRatio: input.scaleCheckRatio,
        }),
      ]);
      return { scanId };
    },

    async deleteSession(sessionId) {
      await db.delete(scanSessions).where(eq(scanSessions.id, sessionId));
    },

    async deleteExpiredAnonymousSessions(now) {
      // Mirrors the predicate in expiry.ts exactly.
      const deleted = await db
        .delete(scanSessions)
        .where(
          and(isNull(scanSessions.userId), lte(scanSessions.expiresAt, now)),
        )
        .returning({ id: scanSessions.id });
      return deleted.length;
    },
  };
}
