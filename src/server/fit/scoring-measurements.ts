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
 * Pure: the input is never modified. The scaled width is NOT clamped to the
 * contract's width range: the engine does not validate measurements, and a
 * floor of 50 mm would flatten every typed width under about 65 mm (a small
 * hand) to the same score input. A width that is not a finite number cannot be
 * scaled and is left as it is.
 */
export function scoringMeasurements(
  measurements: HandMeasurements,
  calibrationMethod: CalibrationMethod | null | undefined,
): HandMeasurements {
  if (calibrationMethod !== "manual-entry") return measurements;
  const typed = measurements.palmWidthMm;
  if (!Number.isFinite(typed)) return measurements;
  return {
    ...measurements,
    palmWidthMm: typed * MANUAL_ENTRY.widthToLandmarkScale,
  };
}
