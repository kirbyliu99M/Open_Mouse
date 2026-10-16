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
 * 候選，無實測依據. Source: the scan error budget SIMULATION (branch
 * `scan-error-budget-2026-10-16`, commit 213a1ba6, profile B), not a
 * measurement. Kirby's single-person, single-phone S25 repeat run (5 scans)
 * gave SD 0.84 mm (hand length) and 0.55 mm (palm width), which is one device
 * and says nothing about other phones.
 */
export const SIGMA_INPUT_B_WITH_EXIF: Matrix2 = [
  [2.58, 0.28],
  [0.28, 1.61],
];

/**
 * Same profile with no EXIF focal length (the focal is estimated from the
 * paper corners). 候選，無實測依據; same source. The simulation also found a
 * systematic bias of about +5 mm that a covariance cannot express and that is
 * NOT included here.
 */
export const SIGMA_INPUT_B_NO_EXIF: Matrix2 = [
  [10.39, 3.07],
  [3.07, 2.95],
];

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
 * symmetric, which is what v1 does. Evidence (D4) does not support any
 * asymmetry, so it stays 1 and is off by default. 候選，無實測依據; source: none.
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
  /** Σ_input over (handLength, palmWidth), mm^2. */
  sigmaInput: Matrix2;
  /** Preference tolerance per dimension (the lower-side sigma), mm. */
  tolerance: Tolerance;
  /** Upper-side tolerance / lower-side tolerance, per dimension; 1 = symmetric. */
  asymmetry: Tolerance;
  /** A dimension is in range while its sub-score is at least this. */
  rangeThresholdScore: number;
  gripUnknownMode: GripUnknownMode;
}

/**
 * The v2 defaults. Σ_input is the SIMULATED profile-B-with-EXIF value (see
 * above): it is far tighter than v1's diag(36, 16), so the default v2 totals
 * are sharper than v1's. 候選，無實測依據.
 */
export const DEFAULT_PARAMS_V2: FitV2Params = {
  sigmaInput: SIGMA_INPUT_B_WITH_EXIF,
  tolerance: TOLERANCE_MM,
  asymmetry: ASYMMETRY,
  rangeThresholdScore: RANGE_THRESHOLD_SCORE,
  gripUnknownMode: GRIP_UNKNOWN_MODE,
};

/**
 * The setting under which v2 reproduces v1: v1's measurement variances as a
 * diagonal Σ_input, v1's sigma as the tolerance, symmetric, v1's grip
 * weights when no grip is stated.
 */
export const V1_EQUIVALENT_PARAMS_V2: FitV2Params = {
  sigmaInput: SIGMA_INPUT_V1_EQUIVALENT,
  tolerance: TOLERANCE_MM,
  asymmetry: { length: 1, gripWidth: 1, height: 1 },
  rangeThresholdScore: RANGE_THRESHOLD_SCORE,
  gripUnknownMode: "v1_ratio",
};
