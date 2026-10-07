import type { HandMeasurements } from "../../lib/contracts/measurement";
import { VERTICAL_FORM_FACTOR_RATIO } from "./coefficients";
import { gaussianScore } from "./gaussian";
import type { CatalogueMouse } from "./types";
import {
  VERTICAL_CANDIDATE_STATUS,
  VERTICAL_CLOSE_SIGMA_FRACTION,
  VERTICAL_CONFIG_A,
  type VerticalCandidateConfig,
  type VerticalTargetRule,
} from "./vertical-candidate-constants";

/**
 * Vertical-mouse CANDIDATE scorer. 未拍板（candidate）: pure, no I/O, and not
 * called by `scoreFit`; nothing about existing scores, ranking or
 * ENGINE_VERSION changes. See vertical-candidate-constants.ts for every number
 * and why it is what it is (mostly: no basis, only a starting point).
 *
 * Only two things are said about a mouse: how close its size is to a target
 * derived from the hand. Nothing here is a health or comfort claim.
 */

/** Hand fields the candidate reads. Any full `HandMeasurements` satisfies it. */
export type VerticalHandInput = Pick<
  HandMeasurements,
  "handLengthMm" | "palmWidthMm"
> &
  Partial<Pick<HandMeasurements, "palmLengthMm">>;

/** Mouse fields the candidate reads. A `CatalogueMouse` satisfies it. */
export type VerticalMouseInput = Pick<
  CatalogueMouse,
  "lengthMm" | "widthMm" | "heightMm"
>;

/** Size-closeness only. Deliberately not a contract ReasonCode. */
export type VerticalReasonCode =
  | "vertical_length_close"
  | "vertical_length_short"
  | "vertical_length_long"
  | "vertical_height_close"
  | "vertical_height_low"
  | "vertical_height_high"
  | "vertical_width_proxy_close"
  | "vertical_width_proxy_narrow"
  | "vertical_width_proxy_wide";

export interface VerticalSubscore {
  /** 0–100, rounded like the horizontal sub-scores. */
  score: number;
  /** Same score before rounding, so sensitivity checks do not tie. */
  scoreUnrounded: number;
  weight: number;
  targetMm: number;
  /** mouse dimension − target, in mm. */
  deltaMm: number;
  reason: VerticalReasonCode;
}

export type VerticalSubscoreKey = "length" | "height" | "widthProxy";

export type VerticalNotApplicableReason =
  /** height ÷ length is at or under VERTICAL_FORM_FACTOR_RATIO. */
  | "not_vertical_form_factor"
  /** A non-finite or non-positive hand or mouse dimension. */
  | "invalid_input";

export type VerticalCandidateResult =
  | {
      applicable: true;
      status: typeof VERTICAL_CANDIDATE_STATUS;
      /** 0–100 weighted mean of the sub-scores, rounded. */
      total: number;
      totalUnrounded: number;
      subscores: Record<VerticalSubscoreKey, VerticalSubscore>;
    }
  | {
      applicable: false;
      status: typeof VERTICAL_CANDIDATE_STATUS;
      reason: VerticalNotApplicableReason;
    };

/**
 * Same test `excludeReason` uses (height ÷ length strictly above the shared
 * ratio), so the two cannot drift apart. NaN compares false, so a malformed
 * mouse is "not vertical" here and caught by the validity check first.
 */
export function isVerticalFormFactor(
  mouse: Pick<CatalogueMouse, "lengthMm" | "heightMm">,
): boolean {
  return mouse.heightMm / mouse.lengthMm > VERTICAL_FORM_FACTOR_RATIO;
}

const isPositiveFinite = (n: number | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

function targetMm(hand: VerticalHandInput, rule: VerticalTargetRule): number {
  return (hand[rule.source] as number) * rule.factor;
}

function sizeCode(
  deltaMm: number,
  sigmaMm: number,
  codes: {
    close: VerticalReasonCode;
    low: VerticalReasonCode;
    high: VerticalReasonCode;
  },
): VerticalReasonCode {
  if (Math.abs(deltaMm) <= sigmaMm * VERTICAL_CLOSE_SIGMA_FRACTION) {
    return codes.close;
  }
  return deltaMm < 0 ? codes.low : codes.high;
}

function part(
  mouseMm: number,
  target: number,
  sigmaMm: number,
  weight: number,
  codes: Parameters<typeof sizeCode>[2],
): VerticalSubscore {
  const deltaMm = mouseMm - target;
  const scoreUnrounded = 100 * Math.exp(-0.5 * (deltaMm / sigmaMm) ** 2);
  return {
    score: gaussianScore(deltaMm, sigmaMm),
    scoreUnrounded,
    weight,
    targetMm: target,
    deltaMm,
    reason: sizeCode(deltaMm, sigmaMm, codes),
  };
}

/**
 * Scores one vertical mouse for one hand. A mouse that is not a vertical form
 * factor is REFUSED (`applicable: false`), not scored: the horizontal engine
 * owns those, and a vertical-grip target would be meaningless for them. Bad
 * numbers are refused the same way instead of throwing, so a caller can map
 * both to "no candidate score".
 *
 * `config` defaults to mapping A; the spike script passes variants.
 */
export function scoreVerticalCandidate(
  hand: VerticalHandInput,
  mouse: VerticalMouseInput,
  config: VerticalCandidateConfig = VERTICAL_CONFIG_A,
): VerticalCandidateResult {
  const status = VERTICAL_CANDIDATE_STATUS;
  if (
    !isPositiveFinite(hand.handLengthMm) ||
    !isPositiveFinite(hand.palmWidthMm) ||
    !isPositiveFinite(mouse.lengthMm) ||
    !isPositiveFinite(mouse.widthMm) ||
    !isPositiveFinite(mouse.heightMm)
  ) {
    return { applicable: false, status, reason: "invalid_input" };
  }
  if (!isVerticalFormFactor(mouse)) {
    return { applicable: false, status, reason: "not_vertical_form_factor" };
  }

  const { targets, sigmaMm, weights } = config;
  const subscores: Record<VerticalSubscoreKey, VerticalSubscore> = {
    length: part(
      mouse.lengthMm,
      targetMm(hand, targets.length),
      sigmaMm.length,
      weights.length,
      {
        close: "vertical_length_close",
        low: "vertical_length_short",
        high: "vertical_length_long",
      },
    ),
    height: part(
      mouse.heightMm,
      targetMm(hand, targets.height),
      sigmaMm.height,
      weights.height,
      {
        close: "vertical_height_close",
        low: "vertical_height_low",
        high: "vertical_height_high",
      },
    ),
    widthProxy: part(
      mouse.widthMm,
      targetMm(hand, targets.widthProxy),
      sigmaMm.widthProxy,
      weights.widthProxy,
      {
        close: "vertical_width_proxy_close",
        low: "vertical_width_proxy_narrow",
        high: "vertical_width_proxy_wide",
      },
    ),
  };

  const parts = Object.values(subscores);
  const weightSum = parts.reduce((sum, s) => sum + s.weight, 0);
  const totalUnrounded =
    parts.reduce((sum, s) => sum + s.scoreUnrounded * s.weight, 0) / weightSum;

  return {
    applicable: true,
    status,
    total: Math.round(totalUnrounded),
    totalUnrounded,
    subscores,
  };
}
