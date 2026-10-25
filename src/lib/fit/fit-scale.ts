/**
 * The engine's scale (landmark-raw-v3, V3.2 candidate, 未拍板; Kirby
 * 2026-10-22, design R7 §3.1, D1 = B, D3).
 *
 * The fit engine, the hand type, the survey bins, the grip prediction and the
 * similar-hand cells were all tuned on frame scans with NO parallax
 * correction. A scan that WAS corrected (`parallaxCorrected: true`, whatever
 * its focal source and whatever its measurement version: older EXIF and
 * homography records included, D3) reads a few per cent shorter, so before
 * any of them reads it its hand length, palm length and palm width are
 * multiplied by `FIT_SCALE_FROM_CORRECTED` (simulated ratios, 模擬, to be
 * replaced by the ones measured on Kirby's S25, D5). The rule reads the flag,
 * never the version. Finger lengths are left as they are: the engine does
 * not read them.
 *
 * The person sees these same engine-scale numbers (D1 = B): every place that
 * shows a scanned hand length or palm width shows `engineScaleMeasurements`,
 * so the page and the engine agree. A typed (`manual-entry`) size is shown as
 * typed; only the engine reads its width times
 * `MANUAL_ENTRY.widthToLandmarkScale`.
 *
 * Pure: the input is never modified, and an input that needs no change is
 * returned as it is (the same object), so an uncorrected scan is byte for
 * byte what it was.
 */
import {
  FIT_SCALE_FROM_CORRECTED,
  MANUAL_ENTRY,
  type CalibrationMethod,
} from "../contracts/measurement";

/** The lengths the engine scale touches; any other field is carried over as it is. */
interface ScalableLengths {
  readonly handLengthMm: number;
  readonly palmLengthMm: number;
  readonly palmWidthMm: number;
}

/** A finite number, so a ratio can be applied to it. */
const finite = (n: number) => Number.isFinite(n);

/**
 * The measurements on the engine's scale for display and for every reader of
 * a scan's size: a parallax-corrected scan's hand length, palm length and palm
 * width times `FIT_SCALE_FROM_CORRECTED`; anything else (`parallaxCorrected`
 * false, null or unknown) exactly as stored, the same object. A length that is
 * not a finite number is left as it is.
 */
export function engineScaleMeasurements<M extends ScalableLengths>(
  measurements: M,
  parallaxCorrected: boolean | null | undefined,
): M {
  if (parallaxCorrected !== true) return measurements;
  const k = FIT_SCALE_FROM_CORRECTED;
  return {
    ...measurements,
    handLengthMm: finite(measurements.handLengthMm)
      ? measurements.handLengthMm * k.handLength
      : measurements.handLengthMm,
    palmLengthMm: finite(measurements.palmLengthMm)
      ? measurements.palmLengthMm * k.palmLength
      : measurements.palmLengthMm,
    palmWidthMm: finite(measurements.palmWidthMm)
      ? measurements.palmWidthMm * k.palmWidth
      : measurements.palmWidthMm,
  };
}

export interface FitScaleContext {
  /** `scans.calibration_method`; null or absent for a row written before the column. */
  readonly calibrationMethod: CalibrationMethod | null | undefined;
  /** `calibration_evidence.parallaxCorrected`; null or absent when the evidence has none. */
  readonly parallaxCorrected: boolean | null | undefined;
}

/**
 * What the fit engine, the hand type, the survey bins, the grip prediction,
 * the similar-hand cells and the feedback snapshot read (design R7 §3.1):
 *
 * - `manual-entry`: the typed palm width times
 *   `MANUAL_ENTRY.widthToLandmarkScale` (0.77), as before v3; everything else
 *   as typed. A typed size is never parallax-corrected.
 * - `parallaxCorrected: true`: `engineScaleMeasurements`.
 * - anything else: as stored, the same object.
 *
 * The scaled width is NOT clamped to the contract's range: the engine does not
 * validate measurements.
 */
export function fitScaleMeasurements<M extends ScalableLengths>(
  measurements: M,
  context: FitScaleContext,
): M {
  if (context.calibrationMethod === "manual-entry") {
    const typed = measurements.palmWidthMm;
    if (!finite(typed)) return measurements;
    return {
      ...measurements,
      palmWidthMm: typed * MANUAL_ENTRY.widthToLandmarkScale,
    };
  }
  return engineScaleMeasurements(measurements, context.parallaxCorrected);
}

/**
 * `calibration_evidence.parallaxCorrected` read from the stored jsonb (or a
 * submission's calibration): `true` or `false` when it is a boolean there,
 * `null` otherwise (no evidence, an older shape, anything else).
 */
export function parallaxCorrectedOf(evidence: unknown): boolean | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
    return null;
  const flag = (evidence as Record<string, unknown>).parallaxCorrected;
  return typeof flag === "boolean" ? flag : null;
}

/**
 * What a page shows for a scan it holds with its calibration evidence (the
 * submission's `calibration`): `engineScaleMeasurements` by the evidence's
 * own `parallaxCorrected` (D1 = B). A typed size (`manual-entry`,
 * `user-length` reference) is never corrected, so it is shown as it is.
 */
export function shownScanMeasurements<M extends ScalableLengths>(
  measurements: M,
  calibration: unknown,
): M {
  return engineScaleMeasurements(
    measurements,
    parallaxCorrectedOf(calibration),
  );
}
