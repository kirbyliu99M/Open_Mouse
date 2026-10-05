/**
 * Fit bands — which plain-language band a 0 to 100 fit score falls in.
 *
 * Pure, and safe on both sides of the seam: the results page and the analysis
 * prompt both read it, so the page and the prose can never grade one score
 * differently. The band ids and their order (best first) are the contract in
 * `../contracts/fit-bands`; this file only says where one band ends.
 *
 * Every threshold below is a CANDIDATE (未拍板): not validated against any
 * distribution of real scores, and not confirmed by Kirby. The coefficients
 * behind a total are still provisional (`fit-v0-provisional`), so a band says
 * how an estimate reads, never how accurate it is.
 */
import { FIT_BANDS, type FitBand } from "../contracts/fit-bands";

/** Lowest total in `very_good`. Candidate, 未拍板, not validated against any distribution. */
export const VERY_GOOD_MIN = 85;
/** Lowest total in `good`. Candidate, 未拍板, not validated against any distribution. */
export const GOOD_MIN = 70;
/** Lowest total in `fair`. Candidate, 未拍板, not validated against any distribution. */
export const FAIR_MIN = 50;
/** The bottom of the scale: `poor` runs from here up to just under `FAIR_MIN`. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Lowest total of each band. Totals below `FAIR_MIN` are `poor`. */
export const FIT_BAND_MIN_TOTAL: Readonly<Record<FitBand, number>> = {
  very_good: VERY_GOOD_MIN,
  good: GOOD_MIN,
  fair: FAIR_MIN,
  poor: SCORE_MIN,
};

/**
 * The band a score falls in, or `null` for `null`: a sub-score nobody could
 * rate is not a band.
 *
 * A score the contract would reject (not an integer, below 0 or above 100)
 * THROWS a `RangeError`; it is not clamped. Clamping would quietly grade a
 * broken number, and the engine's own schema already refuses it upstream.
 */
export function bandOf(score: number | null): FitBand | null {
  if (score === null) return null;
  if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
    throw new RangeError(
      `A fit score is a whole number from ${SCORE_MIN} to ${SCORE_MAX}, got ${score}.`,
    );
  }
  for (const band of FIT_BANDS) {
    if (score >= FIT_BAND_MIN_TOTAL[band]) return band;
  }
  // Unreachable: `poor` starts at SCORE_MIN, which the check above guarantees.
  throw new RangeError(`No fit band covers ${score}.`);
}
