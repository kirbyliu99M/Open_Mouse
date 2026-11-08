/**
 * The de-linked hand sample a scan may leave behind (contract:
 * `src/lib/contracts/hand-sample.ts`, candidate, 未拍板). Pure: no database,
 * no clock of its own, no logging. `drizzle-repo.ts` calls it while it builds
 * the scan's insert batch and adds the row to that same batch.
 *
 * What the row keeps is exactly the `hand_samples` columns, no more: the
 * notice version, the UTC month, the hand, the two stated answers, the
 * calibration method, the model version and the rounded lengths. Never an id
 * of the scan, the session or the user, never the calibration evidence, never
 * a time finer than the month.
 *
 * It returns null, and the scan is stored without a sample, when:
 *   - the submission did not carry the current notice version (the person
 *     opted out, or the client is older than the notice);
 *   - rounding would break the table's `hand_samples_plausible` CHECK (for
 *     example a palm length that rounds to the hand length). The scan itself
 *     already passed the contract's own bounds; a sample is optional, a
 *     failed scan is not, so the sample gives way.
 */
import {
  HAND_SAMPLE_NOTICE_VERSION,
  roundSampleMm,
  sampleMonthOf,
} from "../../lib/contracts/hand-sample";
import type { handSamples } from "../../db/schema";
import type { ScanInsertInput } from "./repo";

/** An insert into `hand_samples`, minus the database-generated id. */
export type HandSampleRow = Omit<typeof handSamples.$inferInsert, "id">;

/** The `hand_samples_plausible` CHECK, on already-rounded values. */
const HAND_LENGTH_RANGE = { min: 100, max: 280 } as const;
const PALM_WIDTH_RANGE = { min: 50, max: 150 } as const;
/** smallint, the column type of every length. */
const SMALLINT_MAX = 32767;

function roundedOptional(mm: number | undefined): number | null {
  return mm === undefined ? null : roundSampleMm(mm);
}

function fitsSmallint(mm: number | null): boolean {
  return mm === null || (Number.isInteger(mm) && Math.abs(mm) <= SMALLINT_MAX);
}

export function toHandSampleRow(
  input: ScanInsertInput,
  now: Date,
): HandSampleRow | null {
  if (input.sampleNotice !== HAND_SAMPLE_NOTICE_VERSION) return null;

  const m = input.measurements;
  const handLengthMm = roundSampleMm(m.handLengthMm);
  const palmLengthMm = roundSampleMm(m.palmLengthMm);
  const palmWidthMm = roundSampleMm(m.palmWidthMm);
  const fingers = {
    thumbLengthMm: roundedOptional(m.thumbLengthMm),
    indexLengthMm: roundedOptional(m.indexLengthMm),
    middleLengthMm: roundedOptional(m.middleLengthMm),
    ringLengthMm: roundedOptional(m.ringLengthMm),
    pinkyLengthMm: roundedOptional(m.pinkyLengthMm),
  };

  const plausible =
    handLengthMm >= HAND_LENGTH_RANGE.min &&
    handLengthMm <= HAND_LENGTH_RANGE.max &&
    palmWidthMm >= PALM_WIDTH_RANGE.min &&
    palmWidthMm <= PALM_WIDTH_RANGE.max &&
    palmLengthMm < handLengthMm;
  const storable = [
    handLengthMm,
    palmLengthMm,
    palmWidthMm,
    ...Object.values(fingers),
  ].every(fitsSmallint);
  if (!plausible || !storable) return null;

  return {
    noticeVersion: input.sampleNotice,
    sampledMonth: sampleMonthOf(now),
    hand: input.hand,
    gripStyleStated: input.gripStyleStated ?? null,
    palmThicknessStated: input.palmThicknessStated ?? null,
    calibrationMethod: input.calibrationMethod,
    measurementModelVersion: input.measurementModelVersion,
    handLengthMm,
    palmLengthMm,
    palmWidthMm,
    ...fingers,
  };
}
