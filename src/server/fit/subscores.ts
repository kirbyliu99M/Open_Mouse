import {
  HUMP_PLACEMENTS,
  flareDirection,
} from "../../lib/contracts/descriptors";
import type {
  FitPreferences,
  GripStyle,
  ReasonCode,
} from "../../lib/contracts/fit";
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

/**
 * Shared "which way is it off, and by how much a band" reason-code picker:
 * |delta| at or under IDEAL_SIGMA_FRACTION·sigma is the ideal code, else the
 * low/high code by the sign of delta. Used by length, gripWidth and the
 * height component of heightHump.
 */
function magnitudeCode(
  deltaMm: number,
  sigmaMm: number,
  codes: { ideal: ReasonCode; low: ReasonCode; high: ReasonCode },
): ReasonCode {
  if (Math.abs(deltaMm) <= sigmaMm * IDEAL_SIGMA_FRACTION) return codes.ideal;
  return deltaMm < 0 ? codes.low : codes.high;
}

// ── length ────────────────────────────────────────────────────────────────

export function scoreLength(
  mouse: CatalogueMouse,
  targetMm: number,
): SubscoreResult {
  const deltaMm = mouse.lengthMm - targetMm;
  const score = gaussianScore(deltaMm, SIGMA_MM.length);
  const code = magnitudeCode(deltaMm, SIGMA_MM.length, {
    ideal: "length_ideal",
    low: "length_short",
    high: "length_long",
  });
  return {
    score,
    weight: BASE_WEIGHTS.length,
    reason: { code, params: { deltaMm, targetMm } },
  };
}

// ── gripWidth ─────────────────────────────────────────────────────────────

export function scoreGripWidth(
  mouse: CatalogueMouse,
  targetMm: number,
): SubscoreResult {
  const curvature = mouse.sideCurvature;
  const curvatureAdjMm =
    curvature === null ? 0 : CURVATURE_ADJUSTMENT_MM[curvature];
  const ergonomicThumbAdjMm =
    mouse.shape === "ergonomic" && mouse.thumbRest === true
      ? THUMB_REST_ERGONOMIC_ADJUSTMENT_MM
      : 0;
  const effectiveWidthMm = mouse.widthMm + curvatureAdjMm + ergonomicThumbAdjMm;
  const deltaMm = effectiveWidthMm - targetMm;
  const score = gaussianScore(deltaMm, SIGMA_MM.gripWidth);
  const code = magnitudeCode(deltaMm, SIGMA_MM.gripWidth, {
    ideal: "width_ideal",
    low: "width_narrow",
    high: "width_wide",
  });
  // §3: "Null curvature → use 0 adj but lower this sub-score's weight by
  // half." Kept even after the null-score prior (coefficients.ts,
  // UNKNOWN_PRIOR_SCORE) landed: the two are not redundant. gripWidth's
  // score here is never null — curvature just defaults its adjustment to 0
  // — so the prior never applies to it. Halving the weight is a distinct,
  // still-meaningful signal: a real score computed on incomplete
  // information should sway the total less than one backed by full data.
  const weight =
    curvature === null ? BASE_WEIGHTS.gripWidth / 2 : BASE_WEIGHTS.gripWidth;
  return {
    score,
    weight,
    reason: {
      code,
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

// ── heightHump ────────────────────────────────────────────────────────────

export function scoreHeightHump(
  mouse: CatalogueMouse,
  targetMm: number,
  usedGrip: GripStyle,
): SubscoreResult {
  const deltaMm = mouse.heightMm - targetMm;
  const heightScore = gaussianScore(deltaMm, SIGMA_MM.height);
  const heightCode = magnitudeCode(deltaMm, SIGMA_MM.height, {
    ideal: "height_ideal",
    low: "height_low",
    high: "height_high",
  });

  if (mouse.humpPlacement === null) {
    // §3 (revised): hump unclassified → height only, and the reason names
    // the height band (there is no hump component to compare it against).
    return {
      score: heightScore,
      weight: BASE_WEIGHTS.heightHump,
      reason: { code: heightCode, params: { deltaMm, targetMm } },
    };
  }

  const actualIndex = HUMP_PLACEMENTS.indexOf(mouse.humpPlacement);
  const bestIndices = HUMP_BEST_INDEX[usedGrip];
  const levelsOff = Math.min(
    ...bestIndices.map((i) => Math.abs(i - actualIndex)),
  );
  const humpScore = 100 * HUMP_LEVEL_OFF_MULTIPLIER[levelsOff];
  const humpCode: ReasonCode =
    levelsOff === 0 ? "hump_matches_grip" : "hump_mismatch_grip";
  const score = Math.round(
    HEIGHT_HUMP_HEIGHT_WEIGHT * heightScore +
      HEIGHT_HUMP_HUMP_WEIGHT * humpScore,
  );
  // §3 (revised): the reason names whichever component scored lower — the
  // weaker one is the more useful explanation of why the subscore isn't
  // higher. A tie (both parts perfect) favors the hump code, since that is
  // the only way "hump_matches_grip" is ever reachable: humpScore tops out
  // at 100, so it can only tie heightScore, never exceed it.
  const code = heightScore < humpScore ? heightCode : humpCode;
  return {
    score,
    weight: BASE_WEIGHTS.heightHump,
    reason: { code, params: { deltaMm, targetMm, humpLevelsOff: levelsOff } },
  };
}

// ── frontFlare ────────────────────────────────────────────────────────────

export function scoreFrontFlare(
  mouse: CatalogueMouse,
  usedGrip: GripStyle,
): SubscoreResult {
  if (mouse.frontFlare === null) {
    return {
      score: null,
      weight: BASE_WEIGHTS.frontFlare,
      reason: { code: "descriptor_unknown", params: {} },
    };
  }
  const table = isPalm(usedGrip)
    ? FRONT_FLARE_SCORE.palm
    : FRONT_FLARE_SCORE.clawOrFingertip;
  const score = table[mouse.frontFlare];
  const direction = flareDirection(mouse.frontFlare);
  let code: ReasonCode;
  if (isPalm(usedGrip)) {
    code =
      mouse.frontFlare === "inward_aggressive"
        ? "flare_crowds_fingers"
        : "flare_neutral";
  } else if (direction === "outward") {
    code = "flare_supports_fingers";
  } else if (direction === "flat") {
    code = "flare_neutral";
  } else {
    code = "flare_crowds_fingers";
  }
  return {
    score,
    weight: BASE_WEIGHTS.frontFlare,
    reason: { code, params: {} },
  };
}

// ── thumb ─────────────────────────────────────────────────────────────────

export function scoreThumb(
  mouse: CatalogueMouse,
  usedGrip: GripStyle,
): SubscoreResult {
  if (mouse.thumbRest === null) {
    return {
      score: null,
      weight: BASE_WEIGHTS.thumb,
      reason: { code: "descriptor_unknown", params: {} },
    };
  }
  const table = isPalm(usedGrip)
    ? THUMB_SCORE.palm
    : THUMB_SCORE.clawOrFingertip;
  if (mouse.thumbRest) {
    const code: ReasonCode = isPalm(usedGrip)
      ? "thumb_rest_supports"
      : "thumb_rest_unneeded";
    return {
      score: table.withRest,
      weight: BASE_WEIGHTS.thumb,
      reason: { code, params: {} },
    };
  }
  // No thumb rest. The score is the same either way (`table.withoutRest`);
  // only the reason differs. A palm grip would normally rest the thumb on one,
  // so its absence is a tradeoff worth saying; for claw and fingertip grips
  // it is genuinely neutral.
  const code: ReasonCode = isPalm(usedGrip)
    ? "thumb_rest_missing"
    : "thumb_neutral";
  return {
    score: table.withoutRest,
    weight: BASE_WEIGHTS.thumb,
    reason: { code, params: {} },
  };
}

// ── weight ────────────────────────────────────────────────────────────────

export function scoreWeight(
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
  const deltaG =
    mouse.weightG < min ? min - mouse.weightG : mouse.weightG - max;
  const score = gaussianScore(deltaG, SIGMA_WEIGHT_G);
  const code: ReasonCode =
    mouse.weightG < min ? "weight_lighter" : "weight_heavier";
  return {
    score,
    weight: BASE_WEIGHTS.weight,
    reason: { code, params: { deltaG, minG: min, maxG: max } },
  };
}
