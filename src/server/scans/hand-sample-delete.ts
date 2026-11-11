import "server-only";
/**
 * Removing a scan's de-linked copy when the PERSON deletes the scan, its
 * anonymous session, or their account (privacy review 2026-11-08, candidate;
 * the rule: `hand-sample.ts`). Not used by the 24 h expiry sweep, the 90-day
 * inactive purge or the expiry cron: the copy is meant to outlive those, and
 * the notice says so.
 *
 * `deleteMatchingSamples(db, scope)` is ONE statement, put in the same
 * `db.batch` as the scan (or session) delete and before it. The match is
 * evaluated in SQL when the statement runs, inside the batch's transaction,
 * so there is no window between reading the scans and deleting their copies:
 *
 *   1. `doomed`: the scans in `scope` (a condition over "scans",
 *      "scan_measurements" and "scan_sessions", the same one the scan delete
 *      uses), grouped by the copy's key with a count per key;
 *   2. for each key, up to `count` matching `hand_samples` rows (LATERAL ...
 *      LIMIT), since identical rows may belong to other people: never more
 *      than one row per deleted scan.
 *
 * The key mirrors the writer exactly (`sampleMatchKey` in hand-sample.ts is
 * the same rule in TypeScript, and tests/unit/hand-samples-db.test.ts proves
 * the two agree on 5,000 generated scans):
 *   - lengths: `round(x)` of the stored `numeric(5,1)` value. Postgres rounds
 *     numeric half away from zero, which is JavaScript's `Math.round` for the
 *     positive lengths the writer rounds (`sampleMm`);
 *   - month: `date_trunc('month', created_at AT TIME ZONE 'UTC')` back to
 *     timestamptz, the writer's `sampleMonthOf` of the same instant;
 *   - absent fingers match only absent fingers (IS NOT DISTINCT FROM);
 *   - a scan with no calibration method or model version (before migration
 *     0006) matches nothing, as it never had a copy.
 * Implausible keys need no filter: the table's CHECK means no row has them.
 */
import { sql, type SQL } from "drizzle-orm";
import type { getDb } from "../../db/client";

type Db = ReturnType<typeof getDb>;

/** The single DELETE of the copies of the scans `scope` selects. */
export function deleteMatchingSamples(db: Db, scope: SQL | undefined) {
  return db.execute(sql`
    WITH doomed AS (
      SELECT "scans"."hand" AS hand,
             "scan_measurements"."calibration_method"::text AS calibration_method,
             "scan_measurements"."measurement_model_version" AS model_version,
             (date_trunc('month', "scans"."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS sampled_month,
             round("scan_measurements"."hand_length_mm") AS hand_length_mm,
             round("scan_measurements"."palm_length_mm") AS palm_length_mm,
             round("scan_measurements"."palm_width_mm") AS palm_width_mm,
             round("scan_measurements"."thumb_length_mm") AS thumb_length_mm,
             round("scan_measurements"."index_length_mm") AS index_length_mm,
             round("scan_measurements"."middle_length_mm") AS middle_length_mm,
             round("scan_measurements"."ring_length_mm") AS ring_length_mm,
             round("scan_measurements"."pinky_length_mm") AS pinky_length_mm,
             count(*) AS copies
        FROM "scans"
        JOIN "scan_measurements" ON "scan_measurements"."scan_id" = "scans"."id"
        JOIN "scan_sessions" ON "scan_sessions"."id" = "scans"."session_id"
       WHERE ${scope ?? sql`false`}
       GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    )
    DELETE FROM "hand_samples"
     WHERE "hand_samples"."id" IN (
       SELECT picked.id
         FROM doomed
         CROSS JOIN LATERAL (
           SELECT hs.id
             FROM "hand_samples" hs
            WHERE hs.hand = doomed.hand
              AND hs.calibration_method = doomed.calibration_method
              AND hs.measurement_model_version = doomed.model_version
              AND hs.sampled_month = doomed.sampled_month
              AND hs.hand_length_mm = doomed.hand_length_mm
              AND hs.palm_length_mm = doomed.palm_length_mm
              AND hs.palm_width_mm = doomed.palm_width_mm
              AND hs.thumb_length_mm IS NOT DISTINCT FROM doomed.thumb_length_mm
              AND hs.index_length_mm IS NOT DISTINCT FROM doomed.index_length_mm
              AND hs.middle_length_mm IS NOT DISTINCT FROM doomed.middle_length_mm
              AND hs.ring_length_mm IS NOT DISTINCT FROM doomed.ring_length_mm
              AND hs.pinky_length_mm IS NOT DISTINCT FROM doomed.pinky_length_mm
            LIMIT doomed.copies
         ) AS picked
     )
  `);
}
