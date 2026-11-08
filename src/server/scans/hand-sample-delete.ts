import "server-only";
/**
 * Removing a scan's de-linked copy when the PERSON deletes the scan, its
 * anonymous session, or their account (privacy review 2026-11-08, candidate;
 * the rule and the key: `hand-sample.ts`). Not used by the 24 h expiry sweep,
 * the 90-day inactive purge or the expiry cron: the copy is meant to outlive
 * those, and the notice says so.
 *
 * How it is used: the caller reads the scans it is about to delete with
 * `SAMPLE_SOURCE_COLUMNS` (same ownership condition as its delete), turns each
 * into `sampleMatchKey`, and puts `deleteMatchingSamples(db, keys)` in the SAME
 * `db.batch` as the scan delete, before it. One statement per distinct key,
 * removing at most as many rows as there are scans with that key (`LIMIT n`):
 * identical rows may belong to other people, so never more. The statements
 * run one after the other inside the batch's transaction.
 */
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { getDb } from "../../db/client";
import { handSamples, scanMeasurements, scans } from "../../db/schema";
import type { SampleMatchKey } from "./hand-sample";

type Db = ReturnType<typeof getDb>;

/** What to select (from scans joined with scan_measurements) for `sampleMatchKey`. */
export const SAMPLE_SOURCE_COLUMNS = {
  hand: scans.hand,
  createdAt: scans.createdAt,
  calibrationMethod: scanMeasurements.calibrationMethod,
  measurementModelVersion: scanMeasurements.measurementModelVersion,
  handLengthMm: scanMeasurements.handLengthMm,
  palmLengthMm: scanMeasurements.palmLengthMm,
  palmWidthMm: scanMeasurements.palmWidthMm,
  thumbLengthMm: scanMeasurements.thumbLengthMm,
  indexLengthMm: scanMeasurements.indexLengthMm,
  middleLengthMm: scanMeasurements.middleLengthMm,
  ringLengthMm: scanMeasurements.ringLengthMm,
  pinkyLengthMm: scanMeasurements.pinkyLengthMm,
} as const;

function keyId(key: SampleMatchKey): string {
  return JSON.stringify([
    key.hand,
    key.calibrationMethod,
    key.measurementModelVersion,
    key.sampledMonth.toISOString(),
    key.handLengthMm,
    key.palmLengthMm,
    key.palmWidthMm,
    key.thumbLengthMm,
    key.indexLengthMm,
    key.middleLengthMm,
    key.ringLengthMm,
    key.pinkyLengthMm,
  ]);
}

/** Identical keys together, with how many scans share each. */
export function groupSampleKeys(
  keys: readonly (SampleMatchKey | null)[],
): { key: SampleMatchKey; count: number }[] {
  const groups = new Map<string, { key: SampleMatchKey; count: number }>();
  for (const key of keys) {
    if (!key) continue;
    const id = keyId(key);
    const group = groups.get(id);
    if (group) group.count += 1;
    else groups.set(id, { key, count: 1 });
  }
  return [...groups.values()];
}

function nullable(
  column: (typeof handSamples)[
    | "thumbLengthMm"
    | "indexLengthMm"
    | "middleLengthMm"
    | "ringLengthMm"
    | "pinkyLengthMm"],
  value: number | null,
): SQL {
  // IS NOT DISTINCT FROM: an absent finger matches only an absent finger.
  return value === null ? isNull(column) : eq(column, value);
}

function matches(key: SampleMatchKey): SQL {
  return and(
    eq(handSamples.hand, key.hand),
    eq(handSamples.calibrationMethod, key.calibrationMethod),
    eq(handSamples.measurementModelVersion, key.measurementModelVersion),
    eq(handSamples.sampledMonth, key.sampledMonth),
    eq(handSamples.handLengthMm, key.handLengthMm),
    eq(handSamples.palmLengthMm, key.palmLengthMm),
    eq(handSamples.palmWidthMm, key.palmWidthMm),
    nullable(handSamples.thumbLengthMm, key.thumbLengthMm),
    nullable(handSamples.indexLengthMm, key.indexLengthMm),
    nullable(handSamples.middleLengthMm, key.middleLengthMm),
    nullable(handSamples.ringLengthMm, key.ringLengthMm),
    nullable(handSamples.pinkyLengthMm, key.pinkyLengthMm),
  )!;
}

/** One DELETE per distinct key, each removing at most one row per scan that has it. */
export function deleteMatchingSamples(
  db: Db,
  keys: readonly (SampleMatchKey | null)[],
) {
  return groupSampleKeys(keys).map(({ key, count }) =>
    db
      .delete(handSamples)
      .where(
        inArray(
          handSamples.id,
          db
            .select({ id: handSamples.id })
            .from(handSamples)
            .where(matches(key))
            .limit(count),
        ),
      ),
  );
}
