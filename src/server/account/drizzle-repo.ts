import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import {
  scanMeasurements,
  scanSessions,
  scans,
  surveyContributions,
  users,
} from "../../db/schema";
import type { AccountRepo, AccountScan } from "./repo";

/** The real `AccountRepo`, over the Neon HTTP driver. */
export function createDrizzleAccountRepo(db = getDb()): AccountRepo {
  return {
    async listScans(userId) {
      const rows = await db
        .select({
          scanId: scans.id,
          createdAt: scans.createdAt,
          hand: scans.hand,
          gripStyleStated: scans.gripStyleStated,
          handLengthMm: scanMeasurements.handLengthMm,
          palmLengthMm: scanMeasurements.palmLengthMm,
          palmWidthMm: scanMeasurements.palmWidthMm,
          thumbLengthMm: scanMeasurements.thumbLengthMm,
          indexLengthMm: scanMeasurements.indexLengthMm,
          middleLengthMm: scanMeasurements.middleLengthMm,
          ringLengthMm: scanMeasurements.ringLengthMm,
          pinkyLengthMm: scanMeasurements.pinkyLengthMm,
          palmThicknessMm: scanMeasurements.palmThicknessMm,
          knuckleHeightMm: scanMeasurements.knuckleHeightMm,
          gripApertureMm: scanMeasurements.gripApertureMm,
          thumbAngleDeg: scanMeasurements.thumbAngleDeg,
        })
        .from(scans)
        // scan_sessions scopes ownership; a signed-in user's rows never
        // carry an expires_at (the DB CHECK constraint requires it), so
        // there is no "expired means gone" filter needed here — only a
        // claimed session reaches this query at all.
        .innerJoin(scanSessions, eq(scans.sessionId, scanSessions.id))
        .innerJoin(scanMeasurements, eq(scanMeasurements.scanId, scans.id))
        .where(eq(scanSessions.userId, userId))
        .orderBy(desc(scans.createdAt));

      return rows.map((r): AccountScan => ({
        scanId: r.scanId,
        createdAt: r.createdAt.toISOString(),
        hand: r.hand,
        gripStyleStated: r.gripStyleStated,
        measurements: {
          handLengthMm: r.handLengthMm,
          palmLengthMm: r.palmLengthMm,
          palmWidthMm: r.palmWidthMm,
          thumbLengthMm: r.thumbLengthMm,
          indexLengthMm: r.indexLengthMm,
          middleLengthMm: r.middleLengthMm,
          ringLengthMm: r.ringLengthMm,
          pinkyLengthMm: r.pinkyLengthMm,
          palmThicknessMm: r.palmThicknessMm,
          knuckleHeightMm: r.knuckleHeightMm,
          gripApertureMm: r.gripApertureMm,
          thumbAngleDeg: r.thumbAngleDeg,
        },
      }));
    },

    async deleteAllScans(userId) {
      // Counted separately from the delete: a DELETE on scan_sessions
      // cascades to scans, but its own RETURNING would report session rows,
      // not scan rows — and "how many scans did you just delete" is the
      // number that matters to someone confirming this action.
      const owned = await db
        .select({ scanId: scans.id })
        .from(scans)
        .innerJoin(scanSessions, eq(scans.sessionId, scanSessions.id))
        .where(eq(scanSessions.userId, userId));
      // One batch (one atomic request), so the button that promises
      // "everything" never deletes the scans and leaves the answers, or the
      // account, or the other way round. The first two deletes are explicit
      // because the survey contract says the withdrawal is by name, whatever
      // else happens to the user row. Deleting the `users` row also cascades
      // to `accounts`, `auth_sessions`, `scan_sessions` (and through them
      // scans, measurements, fit results and the analysis cache),
      // `survey_contributions`, `survey_ratings` and `survey_other_mice`. A
      // scan's `survey_contributed_at` mark goes with the scan.
      await db.batch([
        db
          .delete(surveyContributions)
          .where(eq(surveyContributions.userId, userId)),
        db.delete(scanSessions).where(eq(scanSessions.userId, userId)),
        db.delete(users).where(eq(users.id, userId)),
      ]);
      return owned.length;
    },
  };
}
