import { HUMP_PLACEMENTS, flareDirection } from "../../lib/contracts/descriptors";
import type { FitPreferences, GripStyle, ReasonCode } from "../../lib/contracts/fit";
import {
  BASE_WEIGHTS,
  CURVATURE_ADJUSTMENT_MM,
  FRONT_FLARE_SCORE,
  HEIGHT_HUMP_HEIGHT_WEIGHT,
  HEIGHT_HUMP_HUMP_WEIGHT,
  HUMP_BEST_INDEX,
  HUMP_LEVEL_OFF_MULTIPLIER,
  IDEAL_SIGMA_FRACTION,
  SIGMA_MM,
  SIGMA_WEIGHT_G,
  THUMB_REST_ERGONOMIC_ADJUSTMENT_MM,
  THUMB_SCORE,
} from "./coefficients";
import { gaussianScore } from "./gaussian";
import type { CatalogueMouse, SubscoreResult } from "./types";

const isPalm = (grip: GripStyle) => grip === "palm";

// ── length ────────────────────────────────────────────────────────────────

export function scoreLength(mouse: CatalogueMouse, targetMm: number): SubscoreResult {
  const deltaMm = mouse.lengthMm - targetMm;
  const score = gaussianScore(deltaMm, SIGMA_MM.length);
  const code: ReasonCode =
    Math.abs(deltaMm) <= SIGMA_MM.length * IDEAL_SIGMA_FRACTION
      ? "length_ideal"
      : deltaMm < 0
        ? "length_short"
        : "length_long";
  return {
    score,
    weight: BASE_WEIGHTS.length,
    reason: { code, params: { deltaMm, targetMm } },
  };
}

// ── gripWidth ─────────────────────────────────────────────────────────────

export function scoreGripWidth(mouse: CatalogueMouse, targetMm: number): SubscoreResult {
  const curvature = mouse.sideCurvature;
  const curvatureAdjMm = curvature === null ? 0 : CURVATURE_ADJUSTMENT_MM[curvature];
  const ergonomicThumbAdjMm =
    mouse.shape === "ergonomic" && mouse.thumbRest === true
      ? THUMB_REST_ERGONOMIC_ADJUSTMENT_MM
      : 0;
  const effectiveWidthMm = mouse.widthMm + curvatureAdjMm + ergonomicThumbAdjMm;
  const deltaMm = effectiveWidthMm - targetMm;
  const score = gaussianScore(deltaMm, SIGMA_MM.gripWidth);
  const code: ReasonCode =
    Math.abs(deltaMm) <= SIGMA_MM.gripWidth * IDEAL_SIGMA_FRACTION
      ? "width_ideal"
      : deltaMm < 0
        ? "width_narrow"
        : "width_wide";
  // §3: "Null curvature → use 0 adj but lower this sub-score's weight by half."
  const weight = curvature === null ? BASE_WEIGHTS.gripWidth / 2 : BASE_WEIGHTS.gripWidth;
  return {
    score,
    weight,
    reason: {
      code,
      params: { deltaMm, targetMm, effectiveWidthMm, curvatureAdjMm, ergonomicThumbAdjMm },
    },
  };
}

// ── heightHump ────────────────────────────────────────────────────────────

export function scoreHeightHump(
  mouse: CatalogueMouse,
  targetMm: number,
  usedGrip: GripStyle,
): SubscoreResult {
  const deltaMm = mouse.heightMm - targetMm;
  const heightScore = gaussianScore(deltaMm, SIGMA_MM.height);

  if (mouse.humpPlacement === null) {
    // §3: "Null hump → height only, reason descriptor_unknown param-free
    // for the hump part."
    return {
      score: heightScore,
      weight: BASE_WEIGHTS.heightHump,
      reason: { code: "descriptor_unknown", params: {} },
    };
  }

  const actualIndex = HUMP_PLACEMENTS.indexOf(mouse.humpPlacement);
  const bestIndices = HUMP_BEST_INDEX[usedGrip];
  const levelsOff = Math.min(...bestIndices.map((i) => Math.abs(i - actualIndex)));
  const humpScore = 100 * HUMP_LEVEL_OFF_MULTIPLIER[levelsOff];
  const score = Math.round(
    HEIGHT_HUMP_HEIGHT_WEIGHT * heightScore + HEIGHT_HUMP_HUMP_WEIGHT * humpScore,
  );
  const code: ReasonCode = levelsOff === 0 ? "hump_matches_grip" : "hump_mismatch_grip";
  return {
    score,
    weight: BASE_WEIGHTS.heightHump,
    reason: { code, params: { deltaMm, targetMm, humpLevelsOff: levelsOff } },
  };
}

// ── frontFlare ────────────────────────────────────────────────────────────

export function scoreFrontFlare(mouse: CatalogueMouse, usedGrip: GripStyle): SubscoreResult {
  if (mouse.frontFlare === null) {
    return {
      score: null,
      weight: BASE_WEIGHTS.frontFlare,
      reason: { code: "descriptor_unknown", params: {} },
    };
  }
  const table = isPalm(usedGrip) ? FRONT_FLARE_SCORE.palm : FRONT_FLARE_SCORE.clawOrFingertip;
  const score = table[mouse.frontFlare];
  const direction = flareDirection(mouse.frontFlare);
  let code: ReasonCode;
  if (isPalm(usedGrip)) {
    code = mouse.frontFlare === "inward_aggressive" ? "flare_crowds_fingers" : "flare_neutral";
  } else if (direction === "outward") {
    code = "flare_supports_fingers";
  } else if (direction === "flat") {
    code = "flare_neutral";
  } else {
    code = "flare_crowds_fingers";
  }
  return { score, weight: BASE_WEIGHTS.frontFlare, reason: { code, params: {} } };
}

// ── thumb ─────────────────────────────────────────────────────────────────

export function scoreThumb(mouse: CatalogueMouse, usedGrip: GripStyle): SubscoreResult {
  if (mouse.thumbRest === null) {
    return {
      score: null,
      weight: BASE_WEIGHTS.thumb,
      reason: { code: "descriptor_unknown", params: {} },
    };
  }
  const table = isPalm(usedGrip) ? THUMB_SCORE.palm : THUMB_SCORE.clawOrFingertip;
  if (mouse.thumbRest) {
    const code: ReasonCode = isPalm(usedGrip) ? "thumb_rest_supports" : "thumb_rest_unneeded";
    return { score: table.withRest, weight: BASE_WEIGHTS.thumb, reason: { code, params: {} } };
  }
  return {
    score: table.withoutRest,
    weight: BASE_WEIGHTS.thumb,
    reason: { code: "thumb_neutral", params: {} },
  };
}

// ── weight ────────────────────────────────────────────────────────────────

export function scoreWeight(mouse: CatalogueMouse, prefs: FitPreferences): SubscoreResult {
  if (!prefs.weightG) {
    return {
      score: null,
      weight: BASE_WEIGHTS.weight,
      reason: { code: "no_preference", params: {} },
    };
  }
  if (mouse.weightG === null) {
    // Contract gap: no dedicated reason code for a catalogue row missing
    // weight while the user has a preference — reusing descriptor_unknown
    // (see PR notes).
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
  const deltaG = mouse.weightG < min ? min - mouse.weightG : mouse.weightG - max;
  const score = gaussianScore(deltaG, SIGMA_WEIGHT_G);
  const code: ReasonCode = mouse.weightG < min ? "weight_lighter" : "weight_heavier";
  return {
    score,
    weight: BASE_WEIGHTS.weight,
    reason: { code, params: { deltaG, minG: min, maxG: max } },
  };
}
