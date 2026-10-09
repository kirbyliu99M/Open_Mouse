import { HUMP_PLACEMENTS } from "../../lib/contracts/descriptors";
import type {
  FitPreferences,
  GripStyle,
  ReasonCode,
} from "../../lib/contracts/fit";
import {
  BASE_WEIGHTS,
  CURVATURE_ADJUSTMENT_MM,
  GRIP_WIDTH_FACTOR,
  HEIGHT_FACTOR,
  HEIGHT_HUMP_HEIGHT_WEIGHT,
  HEIGHT_HUMP_HUMP_WEIGHT,
  HUMP_BEST_INDEX,
  HUMP_LEVEL_OFF_MULTIPLIER,
  IDEAL_SIGMA_FRACTION,
  LENGTH_FACTOR,
  SIGMA_MEAS_MM,
  SIGMA_MM,
  SIGMA_WEIGHT_G,
  THUMB_REST_BASE_MM,
  THUMB_REST_WIDE_FROM_MM,
  THUMB_REST_WIDE_SLOPE,
} from "./coefficients";
import type { CatalogueMouse, SubscoreResult } from "./types";

export { scoreFrontFlare, scoreThumb } from "./subscores";

/**
 * v1 sub-scores (docs/fit-algorithm.md §4). Same shapes, reasons and weights
 * as v0 (`./subscores`), with two differences:
 *
 *  - scores are NOT rounded: rounding inside the engine is what made v0's
 *    totals step by whole points. Only the displayed numbers are rounded, by
 *    the caller.
 *  - every Gaussian widens its sigma by the measurement noise of the hand
 *    measurement its target comes from, sigma_eff = sqrt(sigma^2 + (k * sigma_meas)^2).
 */

/** sigma_eff = sqrt(sigma^2 + (k * sigmaMeas)^2), k the hand-measurement factor of the target. */
export function sigmaEff(sigma: number, k: number, sigmaMeas: number): number {
  return Math.sqrt(sigma ** 2 + (k * sigmaMeas) ** 2);
}

/** 100 * exp(-1/2 (delta/sigma)^2), unrounded and clamped to 0-100. */
export function gaussianRaw(delta: number, sigma: number): number {
  const raw = 100 * Math.exp(-0.5 * (delta / sigma) ** 2);
  return Math.max(0, Math.min(100, raw));
}

export const SIGMA_EFF = {
  length: (grip: GripStyle) =>
    sigmaEff(SIGMA_MM.length, LENGTH_FACTOR[grip], SIGMA_MEAS_MM.handLength),
  gripWidth: () =>
    sigmaEff(SIGMA_MM.gripWidth, GRIP_WIDTH_FACTOR, SIGMA_MEAS_MM.palmWidth),
  height: (grip: GripStyle) =>
    sigmaEff(SIGMA_MM.height, HEIGHT_FACTOR[grip], SIGMA_MEAS_MM.handLength),
} as const;

function magnitudeCode(
  delta: number,
  sigma: number,
  codes: { ideal: ReasonCode; low: ReasonCode; high: ReasonCode },
): ReasonCode {
  if (Math.abs(delta) <= sigma * IDEAL_SIGMA_FRACTION) return codes.ideal;
  return delta < 0 ? codes.low : codes.high;
}

export function scoreLengthV1(
  mouse: CatalogueMouse,
  targetMm: number,
  grip: GripStyle,
): SubscoreResult {
  const deltaMm = mouse.lengthMm - targetMm;
  const sigma = SIGMA_EFF.length(grip);
  return {
    score: gaussianRaw(deltaMm, sigma),
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

/**
 * CALIB-1: the (negative) adjustment for an ergonomic mouse with a thumb rest.
 * -12 mm up to 80 mm wide, then 0.5 mm more for each mm of width above 80.
 */
export function thumbRestAdjustmentMm(widthMm: number): number {
  return -(
    THUMB_REST_BASE_MM +
    THUMB_REST_WIDE_SLOPE * Math.max(0, widthMm - THUMB_REST_WIDE_FROM_MM)
  );
}

export function scoreGripWidthV1(
  mouse: CatalogueMouse,
  targetMm: number,
): SubscoreResult {
  const curvature = mouse.sideCurvature;
  const curvatureAdjMm =
    curvature === null ? 0 : CURVATURE_ADJUSTMENT_MM[curvature];
  const ergonomicThumbAdjMm =
    mouse.shape === "ergonomic" && mouse.thumbRest === true
      ? thumbRestAdjustmentMm(mouse.widthMm)
      : 0;
  const effectiveWidthMm = mouse.widthMm + curvatureAdjMm + ergonomicThumbAdjMm;
  const deltaMm = effectiveWidthMm - targetMm;
  const sigma = SIGMA_EFF.gripWidth();
  // Halved only while sideCurvature is unknown (docs/fit-algorithm.md §4).
  const weight =
    curvature === null ? BASE_WEIGHTS.gripWidth / 2 : BASE_WEIGHTS.gripWidth;
  return {
    score: gaussianRaw(deltaMm, sigma),
    weight,
    reason: {
      code: magnitudeCode(deltaMm, sigma, {
        ideal: "width_ideal",
        low: "width_narrow",
        high: "width_wide",
      }),
      params: {
        deltaMm,
        targetMm,
        effectiveWidthMm,
        curvatureAdjMm,
        ergonomicThumbAdjMm,
      },
    },
  };
}

export function scoreHeightHumpV1(
  mouse: CatalogueMouse,
  targetMm: number,
  grip: GripStyle,
): SubscoreResult {
  const deltaMm = mouse.heightMm - targetMm;
  const sigma = SIGMA_EFF.height(grip);
  const heightScore = gaussianRaw(deltaMm, sigma);
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
      // Compare rounded, as v0 does: with an unrounded height score a hump
      // match would almost never be reported, because the height part is
      // rarely exactly 100.
      code: Math.round(heightScore) < humpScore ? heightCode : humpCode,
      params: { deltaMm, targetMm, humpLevelsOff: levelsOff },
    },
  };
}

export function scoreWeightV1(
  mouse: CatalogueMouse,
  prefs: FitPreferences,
): SubscoreResult {
  if (!prefs.weightG) {
    return {
      score: null,
      weight: BASE_WEIGHTS.weight,
      reason: { code: "no_preference", params: {} },
    };
  }
  if (mouse.weightG === null) {
    return {
      score: null,
      weight: BASE_WEIGHTS.weight,
      reason: { code: "descriptor_unknown", params: {} },
    };
  }
  const { min, max } = prefs.weightG;
  if (mouse.weightG >= min && mouse.weightG <= max) {
    return {
      score: 100,
      weight: BASE_WEIGHTS.weight,
      reason: { code: "weight_in_range", params: { minG: min, maxG: max } },
    };
  }
  const deltaG =
    mouse.weightG < min ? min - mouse.weightG : mouse.weightG - max;
  return {
    score: gaussianRaw(deltaG, SIGMA_WEIGHT_G),
    weight: BASE_WEIGHTS.weight,
    reason: {
      code: mouse.weightG < min ? "weight_lighter" : "weight_heavier",
      params: { deltaG, minG: min, maxG: max },
    },
  };
}
