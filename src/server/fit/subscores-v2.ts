import { HUMP_PLACEMENTS } from "../../lib/contracts/descriptors";
import type { GripStyle, ReasonCode } from "../../lib/contracts/fit";
import {
  BASE_WEIGHTS,
  CURVATURE_ADJUSTMENT_MM,
  HEIGHT_HUMP_HEIGHT_WEIGHT,
  HEIGHT_HUMP_HUMP_WEIGHT,
  HUMP_BEST_INDEX,
  HUMP_LEVEL_OFF_MULTIPLIER,
  IDEAL_SIGMA_FRACTION,
} from "./coefficients";
import { thumbRestAdjustmentMm } from "./subscores-v1";
import type { CatalogueMouse, SubscoreResult } from "./types";

// Front flare, thumb and weight are v1's own functions, re-exported untouched.
export { scoreFrontFlare, scoreThumb, scoreWeightV1 } from "./subscores-v1";

/**
 * v2 sub-scores for the three dimensions that carry a Gaussian (length, grip
 * width, height + hump). They are v1's functions with one change: the sigma
 * comes from the caller, and may differ above and below the target
 * (`asymmetry`), instead of being hard-wired to v1's sigma_eff. Everything
 * else (curvature and thumb-rest width adjustment, hump table, weights,
 * halving of the grip-width weight) is v1's, imported from `./coefficients`
 * and `./subscores-v1`. With symmetric sigma equal to v1's sigma_eff the
 * results are the same numbers (tests/unit/fit-v2-equivalence.test.ts).
 */

/** The Gaussian's sigma below and above the target (delta = mouse - target), mm. */
export interface SideSigma {
  lo: number;
  hi: number;
}

/** 100 * exp(-1/2 (delta/sigma)^2), sigma chosen by the side of delta. Clamped to 0-100. */
export function splitGaussianRaw(delta: number, sigma: SideSigma): number {
  const s = delta < 0 ? sigma.lo : sigma.hi;
  const raw = 100 * Math.exp(-0.5 * (delta / s) ** 2);
  return Math.max(0, Math.min(100, raw));
}

function magnitudeCode(
  delta: number,
  sigma: SideSigma,
  codes: { ideal: ReasonCode; low: ReasonCode; high: ReasonCode },
): ReasonCode {
  const s = delta < 0 ? sigma.lo : sigma.hi;
  if (Math.abs(delta) <= s * IDEAL_SIGMA_FRACTION) return codes.ideal;
  return delta < 0 ? codes.low : codes.high;
}

export function scoreLengthV2(
  mouse: CatalogueMouse,
  targetMm: number,
  sigma: SideSigma,
): SubscoreResult {
  const deltaMm = mouse.lengthMm - targetMm;
  return {
    score: splitGaussianRaw(deltaMm, sigma),
    weight: BASE_WEIGHTS.length,
    reason: {
      code: magnitudeCode(deltaMm, sigma, {
        ideal: "length_ideal",
        low: "length_short",
        high: "length_long",
      }),
      params: { deltaMm, targetMm },
    },
  };
}

/** The width the grip-width sub-score compares with the target (v1's adjustments, unchanged). */
export function effectiveWidthMm(mouse: CatalogueMouse): number {
  const curvature = mouse.sideCurvature;
  const curvatureAdjMm =
    curvature === null ? 0 : CURVATURE_ADJUSTMENT_MM[curvature];
  const ergonomicThumbAdjMm =
    mouse.shape === "ergonomic" && mouse.thumbRest === true
      ? thumbRestAdjustmentMm(mouse.widthMm)
      : 0;
  return mouse.widthMm + curvatureAdjMm + ergonomicThumbAdjMm;
}

export function scoreGripWidthV2(
  mouse: CatalogueMouse,
  targetMm: number,
  sigma: SideSigma,
): SubscoreResult {
  const effective = effectiveWidthMm(mouse);
  const deltaMm = effective - targetMm;
  // Halved only while sideCurvature is unknown (v1 section 4).
  const weight =
    mouse.sideCurvature === null
      ? BASE_WEIGHTS.gripWidth / 2
      : BASE_WEIGHTS.gripWidth;
  return {
    score: splitGaussianRaw(deltaMm, sigma),
    weight,
    reason: {
      code: magnitudeCode(deltaMm, sigma, {
        ideal: "width_ideal",
        low: "width_narrow",
        high: "width_wide",
      }),
      params: { deltaMm, targetMm, effectiveWidthMm: effective },
    },
  };
}

export function scoreHeightHumpV2(
  mouse: CatalogueMouse,
  targetMm: number,
  grip: GripStyle,
  sigma: SideSigma,
): SubscoreResult {
  const deltaMm = mouse.heightMm - targetMm;
  const heightScore = splitGaussianRaw(deltaMm, sigma);
  const heightCode = magnitudeCode(deltaMm, sigma, {
    ideal: "height_ideal",
    low: "height_low",
    high: "height_high",
  });

  if (mouse.humpPlacement === null) {
    return {
      score: heightScore,
      weight: BASE_WEIGHTS.heightHump,
      reason: { code: heightCode, params: { deltaMm, targetMm } },
    };
  }

  const actualIndex = HUMP_PLACEMENTS.indexOf(mouse.humpPlacement);
  const levelsOff = Math.min(
    ...HUMP_BEST_INDEX[grip].map((i) => Math.abs(i - actualIndex)),
  );
  const humpScore = 100 * HUMP_LEVEL_OFF_MULTIPLIER[levelsOff];
  const humpCode: ReasonCode =
    levelsOff === 0 ? "hump_matches_grip" : "hump_mismatch_grip";
  return {
    score:
      HEIGHT_HUMP_HEIGHT_WEIGHT * heightScore +
      HEIGHT_HUMP_HUMP_WEIGHT * humpScore,
    weight: BASE_WEIGHTS.heightHump,
    reason: {
      code: Math.round(heightScore) < humpScore ? heightCode : humpCode,
      params: { deltaMm, targetMm, humpLevelsOff: levelsOff },
    },
  };
}
