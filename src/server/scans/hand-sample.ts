/**
 * The de-linked hand sample a scan may leave behind (contract:
 * `src/lib/contracts/hand-sample.ts`, candidate, 未拍板). Pure: no database,
 * no clock of its own, no logging.
 *
 * `toHandSampleRow` builds the row the scan's insert batch adds
 * (`drizzle-repo.ts`). What it keeps is exactly the `hand_samples` columns, no
 * more: the notice version, the UTC month, the hand, the two stated answers,
 * the calibration method, the model version and the rounded lengths. Never an
 * id of the scan, the session or the user, never the calibration evidence,
 * never a time finer than the month. It returns null, and the scan is stored
 * without a sample, when:
 *   - the submission did not carry the current notice version (the person
 *     opted out, or the client is older than the notice);
 *   - rounding would break the table's `hand_samples_plausible` CHECK (for
 *     example a palm length that rounds to the hand length). The scan itself
 *     already passed the contract's own bounds; a sample is optional, a
 *     failed scan is not, so the sample gives way.
 *
 * `sampleMatchKey` is the other half (privacy review, 2026-11-08, candidate):
 * while a scan still exists its copy could be re-identified by matching
 * values, so a person's own delete of the scan, its session or the account
 * also removes ONE value-matching copy per scan (`hand-sample-delete.ts`).
 * The key is computed from the scan as stored, with the same rounding the
 * writer used, so a writer row and its scan's key always agree:
 *   - lengths: the writer rounds the value as `scan_measurements` stores it
 *     (`numeric(5,1)`: `asStoredMm`), then to whole mm (`roundSampleMm`); the
 *     key reads the stored value back and does the same. Rounding the raw
 *     value straight to whole mm could differ by 1 mm at x.45..x.5.
 *   - month: the writer stamps `scans.created_at` and the sample's month from
 *     the same instant; the key takes the UTC month of `created_at`.
 * The stated grip and thickness are not in the key: they are not needed to
 * tell two scans apart well enough, and leaving them out keeps a later edit of
 * an answer from hiding the copy.
 */
import {
  HAND_SAMPLE_NOTICE_VERSION,
  roundSampleMm,
  sampleMonthOf,
} from "../../lib/contracts/hand-sample";
import type { CalibrationMethod } from "../../lib/contracts/measurement";
import type { handSamples } from "../../db/schema";
import type { ScanInsertInput } from "./repo";

/** An insert into `hand_samples`, minus the database-generated id. */
export type HandSampleRow = Omit<typeof handSamples.$inferInsert, "id">;

/** The `hand_samples_plausible` CHECK, on already-rounded values. */
const HAND_LENGTH_RANGE = { min: 100, max: 280 } as const;
const PALM_WIDTH_RANGE = { min: 50, max: 150 } as const;
/** smallint, the column type of every length. */
const SMALLINT_MAX = 32767;

/**
 * A millimetre value as `scan_measurements` keeps it: `numeric(5,1)`, which
 * Postgres rounds half away from zero from the decimal text Drizzle sends
 * (`String(mm)`). Done on that text, so binary floating point cannot tip a
 * value like 150.45 the wrong way.
 */
export function asStoredMm(mm: number): number {
  if (!Number.isFinite(mm)) return mm;
  const text = String(Math.abs(mm));
  if (/e/i.test(text)) return Number(mm.toFixed(1));
  const [whole, fraction = ""] = text.split(".");
  let tenths = Number(`${whole}${fraction[0] ?? "0"}`);
  if ((fraction[1] ?? "0") >= "5") tenths += 1;
  const stored = tenths / 10;
  return mm < 0 ? -stored : stored;
}

/** The whole-millimetre value a sample stores for a measured length. */
export function sampleMm(mm: number): number {
  return roundSampleMm(asStoredMm(mm));
}

/** The rounded lengths of a sample, in `hand_samples` column order. */
export interface SampleLengths {
  handLengthMm: number;
  palmLengthMm: number;
  palmWidthMm: number;
  thumbLengthMm: number | null;
  indexLengthMm: number | null;
  middleLengthMm: number | null;
  ringLengthMm: number | null;
  pinkyLengthMm: number | null;
}

type MaybeMm = number | null | undefined;

function roundedOptional(mm: MaybeMm): number | null {
  return mm === undefined || mm === null ? null : sampleMm(mm);
}

function fitsSmallint(mm: number | null): boolean {
  return mm === null || (Number.isInteger(mm) && Math.abs(mm) <= SMALLINT_MAX);
}

/**
 * The lengths a sample of these measurements stores, or null when the
 * table's CHECK (or its smallint columns) would refuse them. Shared by the
 * writer and the match key, so the two can never round differently.
 */
function sampleLengths(m: {
  handLengthMm: MaybeMm;
  palmLengthMm: MaybeMm;
  palmWidthMm: MaybeMm;
  thumbLengthMm?: MaybeMm;
  indexLengthMm?: MaybeMm;
  middleLengthMm?: MaybeMm;
  ringLengthMm?: MaybeMm;
  pinkyLengthMm?: MaybeMm;
}): SampleLengths | null {
  if (
    typeof m.handLengthMm !== "number" ||
    typeof m.palmLengthMm !== "number" ||
    typeof m.palmWidthMm !== "number"
  )
    return null;
  const lengths: SampleLengths = {
    handLengthMm: sampleMm(m.handLengthMm),
    palmLengthMm: sampleMm(m.palmLengthMm),
    palmWidthMm: sampleMm(m.palmWidthMm),
    thumbLengthMm: roundedOptional(m.thumbLengthMm),
    indexLengthMm: roundedOptional(m.indexLengthMm),
    middleLengthMm: roundedOptional(m.middleLengthMm),
    ringLengthMm: roundedOptional(m.ringLengthMm),
    pinkyLengthMm: roundedOptional(m.pinkyLengthMm),
  };
  const plausible =
    lengths.handLengthMm >= HAND_LENGTH_RANGE.min &&
    lengths.handLengthMm <= HAND_LENGTH_RANGE.max &&
    lengths.palmWidthMm >= PALM_WIDTH_RANGE.min &&
    lengths.palmWidthMm <= PALM_WIDTH_RANGE.max &&
    lengths.palmLengthMm < lengths.handLengthMm;
  if (!plausible || !Object.values(lengths).every(fitsSmallint)) return null;
  return lengths;
}

/**
 * The sample row for a scan being inserted, or null (see the header). `now`
 * MUST be the instant written to that scan's `created_at`, so the scan's
 * `sampleMatchKey` finds this row again.
 */
export function toHandSampleRow(
  input: ScanInsertInput,
  now: Date,
): HandSampleRow | null {
  if (input.sampleNotice !== HAND_SAMPLE_NOTICE_VERSION) return null;
  const lengths = sampleLengths(input.measurements);
  if (!lengths) return null;
  return {
    noticeVersion: input.sampleNotice,
    sampledMonth: sampleMonthOf(now),
    hand: input.hand,
    gripStyleStated: input.gripStyleStated ?? null,
    palmThicknessStated: input.palmThicknessStated ?? null,
    calibrationMethod: input.calibrationMethod,
    measurementModelVersion: input.measurementModelVersion,
    ...lengths,
  };
}

/** A stored scan, as read for `sampleMatchKey` (scans + scan_measurements). */
export interface ScanSampleSource {
  hand: "left" | "right";
  createdAt: Date;
  /** Null on rows from before migration 0006: those never had a sample. */
  calibrationMethod: CalibrationMethod | null;
  measurementModelVersion: string | null;
  handLengthMm: number;
  palmLengthMm: number;
  palmWidthMm: number;
  thumbLengthMm: number | null;
  indexLengthMm: number | null;
  middleLengthMm: number | null;
  ringLengthMm: number | null;
  pinkyLengthMm: number | null;
}

/** What a scan's copy, if it has one, must equal (nullable lengths: IS NOT DISTINCT FROM). */
export interface SampleMatchKey extends SampleLengths {
  hand: "left" | "right";
  calibrationMethod: CalibrationMethod;
  measurementModelVersion: string;
  sampledMonth: Date;
}

/**
 * The key a stored scan's copy would carry, or null when the scan cannot
 * have one (no method or model version recorded, or values the writer would
 * have skipped). Whether it HAS one is not known, by design: the delete
 * removes at most one row per key and is a no-op when none matches.
 */
export function sampleMatchKey(scan: ScanSampleSource): SampleMatchKey | null {
  if (scan.calibrationMethod === null || scan.measurementModelVersion === null)
    return null;
  if (
    !(scan.createdAt instanceof Date) ||
    Number.isNaN(scan.createdAt.getTime())
  )
    return null;
  const lengths = sampleLengths(scan);
  if (!lengths) return null;
  return {
    hand: scan.hand,
    calibrationMethod: scan.calibrationMethod,
    measurementModelVersion: scan.measurementModelVersion,
    sampledMonth: sampleMonthOf(scan.createdAt),
    ...lengths,
  };
}
