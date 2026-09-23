import "server-only";
import { and, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../../db/client";
import { scanMeasurements, scanSessions, scans } from "../../db/schema";
import type {
  OwnedScan,
  ScanInsertInput,
  ScanOwnershipContext,
  ScanRepo,
  SessionRecord,
} from "./repo";

function ownershipPredicate(ctx: ScanOwnershipContext) {
  const ownership = [];
  if (ctx.userId !== null) {
    ownership.push(eq(scanSessions.userId, ctx.userId));
  }
  if (ctx.cookieSessionId !== null) {
    ownership.push(
      and(
        eq(scanSessions.id, ctx.cookieSessionId),
        or(isNull(scanSessions.expiresAt), gt(scanSessions.expiresAt, ctx.now)),
      ),
    );
  }
  return ownership.length > 0 ? or(...ownership) : undefined;
}

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
      // isNull(userId): never deletes a session a signed-in user has
      // claimed — only `/account`'s explicit delete-everything does that.
      await db
        .delete(scanSessions)
        .where(
          and(eq(scanSessions.id, sessionId), isNull(scanSessions.userId)),
        );
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

    async claimSession(sessionId, userId, now) {
      // One UPDATE, gated on all three conditions at once: this is the
      // caller's own session id (equality on the primary key), it is not
      // already claimed by someone else (`user_id IS NULL`), and it has not
      // expired (expired means gone — issue #17 amendment). Any condition
      // failing makes this a no-op; it never throws and never reassigns.
      await db
        .update(scanSessions)
        .set({ userId, expiresAt: null })
        .where(
          and(
            eq(scanSessions.id, sessionId),
            isNull(scanSessions.userId),
            or(isNull(scanSessions.expiresAt), gt(scanSessions.expiresAt, now)),
          ),
        );
    },

    async findOwnedScan(
      scanId: string,
      ctx: ScanOwnershipContext,
    ): Promise<OwnedScan | null> {
      // Each half of the ownership rule (routes.ts header) is optional
      // depending on what the caller presents; only include the ones that
      // apply. Neither present (signed out, no cookie) can never match
      // anything, so skip the query entirely rather than run an OR with no
      // real conditions in it.
      const ownership = ownershipPredicate(ctx);
      if (!ownership) return null;

      const rows = await db
        .select({
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
        .innerJoin(scanSessions, eq(scans.sessionId, scanSessions.id))
        .innerJoin(scanMeasurements, eq(scanMeasurements.scanId, scans.id))
        .where(and(eq(scans.id, scanId), ownership))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return {
        hand: row.hand,
        gripStyleStated: row.gripStyleStated,
        measurements: {
          handLengthMm: row.handLengthMm,
          palmLengthMm: row.palmLengthMm,
          palmWidthMm: row.palmWidthMm,
          thumbLengthMm: row.thumbLengthMm ?? undefined,
          indexLengthMm: row.indexLengthMm ?? undefined,
          middleLengthMm: row.middleLengthMm ?? undefined,
          ringLengthMm: row.ringLengthMm ?? undefined,
          pinkyLengthMm: row.pinkyLengthMm ?? undefined,
          palmThicknessMm: row.palmThicknessMm ?? undefined,
          knuckleHeightMm: row.knuckleHeightMm ?? undefined,
          gripApertureMm: row.gripApertureMm ?? undefined,
          thumbAngleDeg: row.thumbAngleDeg ?? undefined,
        },
      };
    },

    async deleteOwnedScan(scanId, ctx) {
      const ownership = ownershipPredicate(ctx);
      if (!ownership) return false;

      // One DELETE with an ownership subquery. No read/delete gap, and only
      // the scan row is targeted; its dependent rows cascade from that row.
      const deleted = await db
        .delete(scans)
        .where(
          and(
            eq(scans.id, scanId),
            inArray(
              scans.sessionId,
              db
                .select({ id: scanSessions.id })
                .from(scanSessions)
                .where(ownership),
            ),
          ),
        )
        .returning({ id: scans.id });
      return deleted.length > 0;
    },
  };
}
