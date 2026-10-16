import type {
  CalibrationMethod,
  HandMeasurements,
} from "../../lib/contracts/measurement";
import { MANUAL_ENTRY } from "../../lib/contracts/measurement";

/**
 * The measurements the fit engine scores, which are not always the ones stored
 * (candidate, Kirby 2026-10-17: OK). A typed (`manual-entry`) hand width is a
 * ruler, skin-to-skin width; fit v1's grip-width target was made for a scan's
 * joint-centre width (landmarks 5 to 17). So for scoring only, a typed width is
 * multiplied by `MANUAL_ENTRY.widthToLandmarkScale`. The stored value, the
 * value the page shows and the contract's checks stay as typed: callers keep
 * their own `measurements` and pass only this function's result to the engine.
 *
 * Every other method, and a scan with no recorded method, scores as stored.
 * Pure: the input is never modified. The scaled width is clamped to the
 * contract's width range instead of throwing (better a score than a 500); a
 * width that is not a finite number cannot be scaled and is left as it is.
 */
export function scoringMeasurements(
  measurements: HandMeasurements,
  calibrationMethod: CalibrationMethod | null | undefined,
): HandMeasurements {
  if (calibrationMethod !== "manual-entry") return measurements;
  const typed = measurements.palmWidthMm;
  if (!Number.isFinite(typed)) return measurements;
  const { min, max } = MANUAL_ENTRY.handWidthRangeMm;
  const scaled = typed * MANUAL_ENTRY.widthToLandmarkScale;
  return { ...measurements, palmWidthMm: Math.min(max, Math.max(min, scaled)) };
}
