import { SIGMA_MEAS_MM, SIGMA_MM } from "./coefficients";

/**
 * Every NEW number the fit-v2 structure prototype uses lives in this file.
 * 未拍板 (candidate): none of them has a measured basis for a mouse. Numbers
 * that v1 already owns (target factors, sub-score weights, hump and flare
 * tables, thumb-rest slope) are NOT copied here: v2 imports them from
 * `./coefficients` unchanged (no new mouse-geometry coefficient, by design).
 *
 * Nothing here is read by v0, v1 or the default engine path.
 */

export const ENGINE_VERSION_V2 = "fit-v2-structure-candidate.0";

/** Stated explicitly, as in coefficients.ts: flip only after real validation. */
export const ENGINE_IS_PROVISIONAL = true;

/** A symmetric 2x2 matrix, row-major. */
export type Matrix2 = readonly [
  readonly [number, number],
  readonly [number, number],
];

/**
 * Σ_input: covariance of the scan's (handLength, palmWidth) error, mm^2, in
 * that order. Supplied by the caller; these are only the defaults.
 *
 * The product captures a FRAME OF THE VIDEO (`CAMERA_CONSTANTS.capture.source =
 * "frame"`), which has no EXIF. So the DEFAULT below is the frame, no-EXIF
 * simulation; the with-EXIF value is kept only as a comparison.
 *
 * 候選，無實測依據. Everything below is the output of the scan error budget
 * SIMULATION (branch `scan-error-budget-2026-10-16`, commit b8c44949,
 * `npx tsx scripts/scan-error-budget.ts`, seed 20261016, N = 2000, joint
 * profile B), not a measurement. Kirby's single-person, single-phone S25
 * repeat run (5 scans) gave SD 0.84 mm (hand length) and 0.55 mm (palm width)
 * and a hand length 0.8 mm under his tape: one device, one hand, a tape of
 * unrecorded definition; it cannot calibrate any of this.
 */

/**
 * Frame, no EXIF, the CURRENT pipeline (an unreliable focal estimate means no
 * parallax correction). Pooled with equal weight over tilt caps of 10 / 20 /
 * 30 / 45 degrees (the real tilt distribution is unknown, so the spread
 * between caps is part of this covariance), plus the variance of an unknown
 * systematic landmark displacement uniform in +-2 mm (half^2 / 3 = 1.33 mm^2
 * on each axis; the +-2 mm is self-set, no source). It is bimodal: about half
 * the scans are corrected (near unbiased, larger spread), the rest are not
 * (about +6 mm long). This is a covariance AROUND the bias vector
 * `BIAS_INPUT_FRAME_B`; if the bias is not subtracted use
 * `SIGMA_INPUT_FRAME_B_UNCORRECTED` instead.
 */
export const SIGMA_INPUT_FRAME_B: Matrix2 = [
  [18.77, 4.82],
  [4.82, 6.09],
];

/**
 * The matching bias vector: the pooled mean of (handLength, palmWidth) error,
 * mm. The measured value minus this is the corrected input. It is dominated by
 * the scans that fall back to no parallax correction, so it moves with the
 * tilt distribution and with any change to the pipeline (it is +3.0 to +4.8 mm
 * for hand length across the simulated profiles, and the spread of the cap
 * means is 1.1 mm). The simulation cannot say whether the real phone
 * pipeline has this bias: Kirby's S25 shows a hand-length bias of -0.8 mm
 * against a tape of unrecorded definition, so subtracting +3.85 mm there
 * would overshoot unless the unknown landmark and definition offsets happen
 * to be about +4.6 mm in the other direction. 候選，無實測依據; set it to
 * [0, 0] to switch the correction off.
 */
export const BIAS_INPUT_FRAME_B: readonly [number, number] = [3.85, 1.32];

/**
 * The same, for the candidate fix in the error budget (a nominal 26 mm-
 * equivalent focal prior, uniform +-20% per scan, replaces "no parallax
 * correction" when the paper-corner estimate is unreliable). Not what the
 * product does today; kept so v2 can be run against it. 候選，無實測依據.
 */
export const SIGMA_INPUT_FRAME_NOMINAL_PRIOR_B: Matrix2 = [
  [5.59, 0.39],
  [0.39, 4.02],
];
export const BIAS_INPUT_FRAME_NOMINAL_PRIOR_B: readonly [number, number] = [
  0.01, -0.41,
];

/**
 * COMPARISON ONLY: with an EXIF focal length (not what the frame capture
 * gives), joint profile B, tilt <= 10 degrees. 候選，無實測依據; same source.
 * It has no systematic landmark term and no bias vector.
 */
export const SIGMA_INPUT_B_WITH_EXIF: Matrix2 = [
  [2.58, 0.28],
  [0.28, 1.61],
];

/**
 * The second-moment matrix Sigma + b b^T: the covariance to use when a known
 * bias b is NOT subtracted from the input (the mean-squared error matrix
 * instead of the covariance around the mean).
 */
export function sigmaWithUncorrectedBias(
  sigma: Matrix2,
  bias: readonly [number, number],
): Matrix2 {
  return [
    [sigma[0][0] + bias[0] * bias[0], sigma[0][1] + bias[0] * bias[1]],
    [sigma[1][0] + bias[1] * bias[0], sigma[1][1] + bias[1] * bias[1]],
  ];
}

/** SIGMA_INPUT_FRAME_B for a run that does not subtract BIAS_INPUT_FRAME_B (about [[33.6, 9.9], [9.9, 7.8]]). */
export const SIGMA_INPUT_FRAME_B_UNCORRECTED: Matrix2 =
  sigmaWithUncorrectedBias(SIGMA_INPUT_FRAME_B, BIAS_INPUT_FRAME_B);

/**
 * v1's measurement noise as a diagonal Σ_input: diag(6^2, 4^2) mm^2. This is
 * what makes v2 reproduce v1 (the "v1-equivalent" setting). Source: v1
 * `SIGMA_MEAS_MM`, itself a candidate.
 */
export const SIGMA_INPUT_V1_EQUIVALENT: Matrix2 = [
  [SIGMA_MEAS_MM.handLength ** 2, 0],
  [0, SIGMA_MEAS_MM.palmWidth ** 2],
];

/** Preference tolerance per target dimension, mm. v1's σ, unchanged. 候選，無實測依據; source: v1 SIGMA_MM. */
export interface Tolerance {
  length: number;
  gripWidth: number;
  height: number;
}
export const TOLERANCE_MM: Tolerance = {
  length: SIGMA_MM.length,
  gripWidth: SIGMA_MM.gripWidth,
  height: SIGMA_MM.height,
};

/**
 * Upper-side tolerance divided by lower-side tolerance, per dimension. 1 is
 * symmetric, which is what v1 does. Directional evidence for "too small is
 * worse than too large" exists (Eksioglu 2004, Yoo 2011, Oude Hengel 2008:
 * the narrow side drops more); a NUMBER does not (three different devices and
 * outcome measures, none in mouse mm). So the structure is kept and the value
 * stays 1, off by default, until there is data to size it. 候選，無實測依據;
 * source: none for the value.
 */
export const ASYMMETRY: Tolerance = { length: 1, gripWidth: 1, height: 1 };

/**
 * A mouse dimension is "in range" while its sub-score is at least this (0-100).
 * 60 is about +-1.0 sigma_eff. 候選，無實測依據; source: none.
 */
export const RANGE_THRESHOLD_SCORE = 60;

/**
 * Number of resampled "true hands" for the ranking-stability estimate and the
 * PRNG seed that makes it reproducible. 候選，無實測依據; source: none (M = 200
 * is a cost choice, not a convergence result).
 */
export const STABILITY_SAMPLES = 200;
export const STABILITY_SEED = 20261016;

/**
 * How a missing grip is handled. "equal" (default): the three grips get weight
 * 1/3 each and the result is flagged `gripUnknown`; the hand's palm/hand
 * ratio is NOT read (D3: no source links hand size to grip). "v1_ratio":
 * v1 section 2's soft weights, kept only so v1 can be reproduced.
 */
export type GripUnknownMode = "equal" | "v1_ratio";
export const GRIP_UNKNOWN_MODE: GripUnknownMode = "equal";

export const EQUAL_GRIP_WEIGHT = 1 / 3;

/** Everything a v2 run reads that the caller may override. */
export interface FitV2Params {
  /** Σ_input over (handLength, palmWidth), mm^2: the covariance of the error AROUND `biasInput`. */
  sigmaInput: Matrix2;
  /**
   * Systematic bias of (handLength, palmWidth), mm: the input is corrected by
   * subtracting it BEFORE the targets are computed and the uncertainty is
   * propagated. 0 = no correction. Σ_input cannot express a bias, which is why
   * it is a separate input.
   */
  biasInput: readonly [number, number];
  /** Preference tolerance per dimension (the lower-side sigma), mm. */
  tolerance: Tolerance;
  /** Upper-side tolerance / lower-side tolerance, per dimension; 1 = symmetric. */
  asymmetry: Tolerance;
  /** A dimension is in range while its sub-score is at least this. */
  rangeThresholdScore: number;
  gripUnknownMode: GripUnknownMode;
}

/**
 * The v2 defaults. Σ_input and the bias vector are the SIMULATED frame,
 * no-EXIF values (see above): the pipeline the product actually runs. Σ_input
 * is tighter than v1's diag(36, 16) (SD 4.3 and 2.5 mm against 6 and 4), and
 * the bias correction moves every target (hand length -3.85 mm, palm width
 * -1.32 mm). 候選，無實測依據.
 */
export const DEFAULT_PARAMS_V2: FitV2Params = {
  sigmaInput: SIGMA_INPUT_FRAME_B,
  biasInput: BIAS_INPUT_FRAME_B,
  tolerance: TOLERANCE_MM,
  asymmetry: ASYMMETRY,
  rangeThresholdScore: RANGE_THRESHOLD_SCORE,
  gripUnknownMode: GRIP_UNKNOWN_MODE,
};

/**
 * The setting under which v2 reproduces v1: v1's measurement variances as a
 * diagonal Σ_input, NO bias correction, v1's sigma as the tolerance,
 * symmetric, v1's grip weights when no grip is stated.
 */
export const V1_EQUIVALENT_PARAMS_V2: FitV2Params = {
  sigmaInput: SIGMA_INPUT_V1_EQUIVALENT,
  biasInput: [0, 0],
  tolerance: TOLERANCE_MM,
  asymmetry: { length: 1, gripWidth: 1, height: 1 },
  rangeThresholdScore: RANGE_THRESHOLD_SCORE,
  gripUnknownMode: "v1_ratio",
};
