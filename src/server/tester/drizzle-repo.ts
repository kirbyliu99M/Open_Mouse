/**
 * `TesterShotRepo` over the `tester_shots` table (migration 0016), plus the
 * two reads/deletes the local scripts need (`createTesterAdmin`). No
 * `server-only` import: `scripts/tester-export.ts` and
 * `scripts/tester-delete.ts` run this file under tsx. It holds no secret; the
 * connection comes from the caller. Covered against PGlite by
 * tests/unit/tester-db.test.ts.
 */
import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { getDb } from "../../db/client";
import { testerShots } from "../../db/schema";
import type { NewTesterShotRow, TesterShotRepo } from "./repo";

type Db = ReturnType<typeof getDb>;
type DbArg = Db | (() => Db);

const handleOf = (db: DbArg) => () => (typeof db === "function" ? db() : db);

/** The row's columns from a checked record (contract `testerRecordSchema`). */
export function testerShotValues(row: NewTesterShotRow) {
  const r = row.record;
  const { handLength, palmWidth } = r.tape;
  return {
    shotId: row.shotId,
    participant: row.participant,
    consentVersion: r.consent,
    day: row.day,
    hand: r.tape.hand,
    measurers: handLength.b || palmWidth.b ? 2 : 1,
    handLengthA1: handLength.a.first,
    handLengthA2: handLength.a.second,
    handLengthB1: handLength.b?.first ?? null,
    handLengthB2: handLength.b?.second ?? null,
    palmWidthA1: palmWidth.a.first,
    palmWidthA2: palmWidth.a.second,
    palmWidthB1: palmWidth.b?.first ?? null,
    palmWidthB2: palmWidth.b?.second ?? null,
    palmWidthEdge: r.tape.palmWidthEdge ?? null,
    phoneModel: r.phoneModel,
    surface: r.surface,
    lighting: r.lighting,
    reference: r.reference,
    cardType: r.cardType ?? null,
    deliberatelyPoor: r.deliberatelyPoor,
    captureMode: r.captureMode,
    attempts: r.attempts,
    firstTryOk: r.firstTryOk,
    failureCodes: [...r.failureCodes],
    gaveUp: r.gaveUp,
    measuredHandLengthMm: r.measured?.handLengthMm ?? null,
    measuredPalmWidthMm: r.measured?.palmWidthMm ?? null,
    measurementModelVersion: r.measured?.measurementModelVersion ?? null,
    calibrationMethod: r.measured?.calibrationMethod ?? null,
    photoPathname: row.photoPathname,
    photoWidthPx: row.photoPathname ? (r.photo?.widthPx ?? null) : null,
    photoHeightPx: row.photoPathname ? (r.photo?.heightPx ?? null) : null,
  };
}

/** `db` may be a factory, so nothing touches the database before a route has let the request through. */
export function createDrizzleTesterShotRepo(db: DbArg): TesterShotRepo {
  const handle = handleOf(db);
  return {
    async hasShot(shotId) {
      const [row] = await handle()
        .select({ id: testerShots.id })
        .from(testerShots)
        .where(eq(testerShots.shotId, shotId))
        .limit(1);
      return row !== undefined;
    },
    async insert(row) {
      const inserted = await handle()
        .insert(testerShots)
        .values(testerShotValues(row))
        .onConflictDoNothing({ target: testerShots.shotId })
        .returning({ id: testerShots.id });
      return inserted.length > 0;
    },
    async listPhotosBefore(cutoffDay, limit) {
      const rows = await handle()
        .select({
          id: testerShots.id,
          photoPathname: testerShots.photoPathname,
        })
        .from(testerShots)
        .where(
          and(
            isNotNull(testerShots.photoPathname),
            lt(testerShots.day, cutoffDay),
          ),
        )
        .orderBy(asc(testerShots.day), asc(testerShots.id))
        .limit(limit);
      return rows.flatMap((r) =>
        r.photoPathname ? [{ id: r.id, photoPathname: r.photoPathname }] : [],
      );
    },
    async clearPhotos(ids) {
      if (ids.length === 0) return 0;
      const cleared = await handle()
        .update(testerShots)
        .set({ photoPathname: null })
        .where(inArray(testerShots.id, [...ids]))
        .returning({ id: testerShots.id });
      return cleared.length;
    },
    async existingPathnames(pathnames) {
      if (pathnames.length === 0) return [];
      const rows = await handle()
        .select({ photoPathname: testerShots.photoPathname })
        .from(testerShots)
        .where(inArray(testerShots.photoPathname, [...pathnames]));
      return rows.flatMap((r) => (r.photoPathname ? [r.photoPathname] : []));
    },
  };
}

export type TesterShotRow = typeof testerShots.$inferSelect;

/** What the local scripts read and delete (never a route). */
export function createTesterAdmin(db: DbArg) {
  const handle = handleOf(db);
  return {
    async listAll(): Promise<TesterShotRow[]> {
      return handle()
        .select()
        .from(testerShots)
        .orderBy(
          asc(testerShots.participant),
          asc(testerShots.day),
          asc(testerShots.id),
        );
    },
    async listParticipant(participant: string): Promise<TesterShotRow[]> {
      return handle()
        .select()
        .from(testerShots)
        .where(eq(testerShots.participant, participant))
        .orderBy(asc(testerShots.day), asc(testerShots.id));
    },
    async deleteParticipant(participant: string): Promise<number> {
      const deleted = await handle()
        .delete(testerShots)
        .where(eq(testerShots.participant, participant))
        .returning({ id: testerShots.id });
      return deleted.length;
    },
  };
}
