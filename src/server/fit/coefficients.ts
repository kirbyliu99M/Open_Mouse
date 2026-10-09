import type {
  FrontFlare,
  SideCurvature,
} from "../../lib/contracts/descriptors";
import type { GripStyle, Subscore } from "../../lib/contracts/fit";

/**
 * Every tunable number the fit engine uses, in one place. Provisional until
 * Kirby's mouse ratings arrive (docs/STATUS.md: "M3 coefficients are
 * unvalidated") — keep this the only file a coefficient lives in.
 *
 * Bump `ENGINE_VERSION` when a score, weight, total or ranking can change for
 * the same input. Changing only which reason code or params a sub-score reports
 * does not: `fit_results` is unique on (scan, mouse, engineVersion) and upserts
 * `reasons` on conflict, so a re-fit under the same version simply overwrites
 * them, while a new version would leave a second row per mouse for the same
 * scan. (G4: a palm grip with no thumb rest now reports `thumb_rest_missing`
 * instead of `thumb_neutral`, with the same score, so no bump.)
 */
export const ENGINE_VERSION = "fit-v0-provisional";

/**
 * Whether the coefficients below are still unvalidated. Stated explicitly so
 * nothing has to infer it from the version string's spelling; flip it when
 * the owner-rating validation lands, in the same change that bumps
 * `ENGINE_VERSION`.
 */
export const ENGINE_IS_PROVISIONAL = true;

/** §2 targets: length = handLength × k, keyed by the grip actually used. */
export const LENGTH_FACTOR: Record<GripStyle, number> = {
  palm: 0.66,
  claw: 0.62,
  fingertip: 0.58,
};

export const GRIP_WIDTH_FACTOR = 0.88;

export const HEIGHT_FACTOR: Record<GripStyle, number> = {
  palm: 0.21,
  claw: 0.2,
  fingertip: 0.18,
};

/** §1 grip prediction thresholds on r = palmLength / handLength. */
export const GRIP_PREDICTION = {
  /** r at or above this → palm. */
  palmAtOrAbove: 0.58,
  /** r at or above this (and below palmAtOrAbove) → claw; else fingertip. */
  clawAtOrAbove: 0.54,
} as const;

/** §4 weights table, before any per-mouse halving (gripWidth §3). */
export const BASE_WEIGHTS: Record<Subscore, number> = {
  length: 0.3,
  gripWidth: 0.25,
  heightHump: 0.2,
  frontFlare: 0.1,
  thumb: 0.1,
  weight: 0.05,
};

/**
 * §4 (revised): a null sub-score no longer drops out of the total — it
 * contributes this neutral prior at its full weight instead. Without this,
 * the total is a mean over *fewer* terms as data goes missing, which lets a
 * mostly-unclassified mouse outrank a fully-assessed one on a couple of
 * lucky matches (see PR #21 notes). `weight` is exempt: "no preference
 * given" is not missing data, so it is excluded from the total entirely,
 * same as before.
 */
export const UNKNOWN_PRIOR_SCORE = 75;

/** Gaussian sigmas, in mm (or g for weight), per §3. */
export const SIGMA_MM = {
  length: 6,
  gripWidth: 5,
  height: 3,
} as const;

export const SIGMA_WEIGHT_G = 10;

/**
 * "Ideal" reason-code band: |delta| at or under this fraction of sigma reads
 * as the _ideal reason (length_ideal, width_ideal, hump-matched height
 * band). The issue specifies the Gaussian score shape but not this
 * reason-code boundary — it is a documented choice, not a derived one.
 */
export const IDEAL_SIGMA_FRACTION = 0.5;

/** §3 gripWidth: curvature's contribution to effective width, already signed. */
export const CURVATURE_ADJUSTMENT_MM: Record<SideCurvature, number> = {
  inward_aggressive: -4,
  inward: -2,
  flat: 0,
  outward: 2,
  outward_aggressive: 4,
};

/** §3 gripWidth: further adjustment for an ergonomic mouse with a thumb rest. */
export const THUMB_REST_ERGONOMIC_ADJUSTMENT_MM = -12;

/**
 * §3 heightHump: best hump-placement indices (into HUMP_PLACEMENTS) for the
 * grip used to score.
 */
export const HUMP_BEST_INDEX: Record<GripStyle, readonly number[]> = {
  palm: [2, 3], // back_moderate, back_aggressive
  claw: [1, 2], // back_minimal, back_moderate
  fingertip: [0], // center
};

/** Multiplier on the 100-point hump-match score per level away from best. */
export const HUMP_LEVEL_OFF_MULTIPLIER: Record<number, number> = {
  0: 1,
  1: 0.85,
  2: 0.6,
  3: 0.4,
};

export const HEIGHT_HUMP_HEIGHT_WEIGHT = 0.6;
export const HEIGHT_HUMP_HUMP_WEIGHT = 0.4;

/** §3 frontFlare lookup, by whether the grip used treats fingers as flared. */
export const FRONT_FLARE_SCORE: {
  clawOrFingertip: Record<FrontFlare, number>;
  palm: Record<FrontFlare, number>;
} = {
  clawOrFingertip: {
    inward_aggressive: 60,
    inward_moderate: 60,
    inward_slight: 60,
    flat: 80,
    outward_slight: 100,
    outward_moderate: 95,
    outward_aggressive: 85,
  },
  palm: {
    inward_aggressive: 60,
    inward_moderate: 80,
    inward_slight: 80,
    flat: 80,
    outward_slight: 80,
    outward_moderate: 80,
    outward_aggressive: 80,
  },
};

/** §3 thumb lookup, by grip used and thumb-rest presence. */
export const THUMB_SCORE = {
  palm: { withRest: 100, withoutRest: 75 },
  clawOrFingertip: { withRest: 65, withoutRest: 85 },
} as const;

/** §5 exclusions: height/length above this is a vertical form factor. */
export const VERTICAL_FORM_FACTOR_RATIO = 0.55;

// ── fit-v1 (candidate) ─────────────────────────────────────────────────────
// Everything below belongs to the v1 candidate engine (docs/fit-algorithm.md).
// Nothing above this line is read by v1 with a different meaning, and v0 reads
// nothing below it. 未拍板: every number here is a candidate.

/** Which engine the fit route uses. Switching it is the one-line change Kirby approves. */
export type EngineId = "v0" | "v1";
export const DEFAULT_ENGINE: EngineId = "v0";

/** `fit_results` is unique on (scan, mouse, engineVersion), so a new version needs no migration. */
export const ENGINE_VERSION_V1 = "fit-v1-candidate.2";

/**
 * Logistic scale `s` of the soft grip weights, on r = palmLength / handLength.
 * The spec's first guess was 0.008, but at 0.008 a 0.5 mm palm-length step
 * moved one mouse's total by 3 to 4 points on the golden hands; the sweep
 * needs s of about 0.012 or more to stay within 2, and 0.016 leaves margin.
 * Candidate (未拍板).
 */
export const GRIP_SOFTNESS = 0.016;

/**
 * Measurement standard deviations (mm) folded into every Gaussian as
 * σ_eff = √(σ² + (k · σ_meas)²). Candidates, to be replaced by the M2
 * repeatability numbers.
 */
export const SIGMA_MEAS_MM = {
  handLength: 6,
  palmWidth: 4,
} as const;

/**
 * CALIB-1: v1's thumb-rest adjustment for an ergonomic mouse with a thumb rest
 * grows with the listed width: -(BASE + SLOPE * max(0, widthMm - FROM)) mm.
 * Up to FROM mm it is the v0 constant (12 mm); above it, the wider side wings
 * of MMO and large ergonomic mice cost more. v0 keeps
 * `THUMB_REST_ERGONOMIC_ADJUSTMENT_MM`. Candidates (未拍板).
 */
export const THUMB_REST_BASE_MM = 12;
export const THUMB_REST_WIDE_SLOPE = 0.5;
export const THUMB_REST_WIDE_FROM_MM = 80;
