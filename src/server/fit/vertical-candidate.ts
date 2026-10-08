import type { HandMeasurements } from "../../lib/contracts/measurement";
import { VERTICAL_FORM_FACTOR_RATIO } from "./coefficients";
import { gaussianScore } from "./gaussian";
import type { CatalogueMouse } from "./types";
import {
  PALM_THICKNESS_LEVELS,
  PALM_THICKNESS_ORDINAL,
  VERTICAL_CANDIDATE_STATUS,
  VERTICAL_CLOSE_SIGMA_FRACTION,
  VERTICAL_CONFIG_A,
  type PalmThicknessLevel,
  type SectionQuantity,
  type ThicknessWiring,
  type VerticalCandidateConfig,
  type VerticalTargetRule,
} from "./vertical-candidate-constants";
import type { VerticalSectionStation } from "./vertical-candidate-sections";

export type { PalmThicknessLevel } from "./vertical-candidate-constants";

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
  Partial<Pick<HandMeasurements, "palmLengthMm">> & {
    /**
     * Optional, user-chosen palm thickness (phase 2, 未拍板). Missing
     * (`undefined`) = not used: the result is then identical to phase 1. Any
     * other value that is not one of the three levels is refused.
     */
    palmThickness?: PalmThicknessLevel;
  };

/** Mouse fields the candidate reads. A `CatalogueMouse` satisfies it. */
export type VerticalMouseInput = Pick<
  CatalogueMouse,
  "lengthMm" | "widthMm" | "heightMm"
> & {
  /**
   * Optional cross-section data (see vertical-candidate-sections.ts). Only
   * wiring B reads it, and only when a palm thickness is given.
   */
  sections?: readonly VerticalSectionStation[];
};

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
  | "vertical_width_proxy_wide"
  // Wiring B: the width-proxy slot compares a cross-section quantity instead.
  | "vertical_section_close"
  | "vertical_section_small"
  | "vertical_section_large";

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
  /** A non-finite or non-positive hand or mouse dimension, or a bad level. */
  | "invalid_input"
  /** Wiring B with a thickness given, but the mouse has no usable sections. */
  | "section_data_missing";

/**
 * Present on a result ONLY when a palm thickness actually changed the
 * computation (a wiring other than "none" and a level given). Absent otherwise,
 * so a phase-1 call returns a phase-1-shaped object.
 */
export interface VerticalThicknessApplied {
  level: PalmThicknessLevel;
  ordinal: -1 | 0 | 1;
  wiring: "prior" | "section";
  /** Wiring A: the multiplier on every size target. Wiring B: the factor on the section target. */
  targetScale: number;
  /** Wiring B: the quantity and mean mouse value that replaced the width proxy. */
  section?: { quantity: SectionQuantity; mouseMm: number };
}

export type VerticalCandidateResult =
  | {
      applicable: true;
      status: typeof VERTICAL_CANDIDATE_STATUS;
      /** 0–100 weighted mean of the sub-scores, rounded. */
      total: number;
      totalUnrounded: number;
      subscores: Record<VerticalSubscoreKey, VerticalSubscore>;
      thickness?: VerticalThicknessApplied;
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

const isThicknessLevel = (v: unknown): v is PalmThicknessLevel =>
  typeof v === "string" &&
  (PALM_THICKNESS_LEVELS as readonly string[]).includes(v);

function sectionValue(
  s: VerticalSectionStation,
  quantity: SectionQuantity,
): number {
  switch (quantity) {
    case "minFeretMm":
      return s.minFeretMm;
    case "minRectShortMm":
      return s.minRectShortMm;
    case "outerGirthMm":
      return s.outerGirthMm;
    case "widthAxisMm":
      return s.widthMm;
  }
}

/**
 * Mean of one section quantity over the requested stations, or null if the
 * stations list is empty, a station is missing, or a value is not a positive
 * finite number. Stations match by exact `ny` (they are 0.4 / 0.5 / … literals).
 */
export function sectionMeanMm(
  sections: readonly VerticalSectionStation[] | undefined,
  stations: readonly number[],
  quantity: SectionQuantity,
): number | null {
  if (!sections || stations.length === 0) return null;
  let sum = 0;
  for (const ny of stations) {
    const station = sections.find((s) => s.ny === ny);
    if (!station) return null;
    const v = sectionValue(station, quantity);
    if (!isPositiveFinite(v)) return null;
    sum += v;
  }
  return sum / stations.length;
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
 *
 * Palm thickness (phase 2, 未拍板): `hand.palmThickness` is read only when
 * `config.thickness` is a wiring other than "none". Missing level, or wiring
 * "none", takes the exact phase-1 code path (no extra arithmetic), so the
 * result is bit-for-bit the phase-1 one.
 */
export function scoreVerticalCandidate(
  hand: VerticalHandInput,
  mouse: VerticalMouseInput,
  config: VerticalCandidateConfig = VERTICAL_CONFIG_A,
): VerticalCandidateResult {
  const status = VERTICAL_CANDIDATE_STATUS;
  const level = hand.palmThickness;
  if (
    !isPositiveFinite(hand.handLengthMm) ||
    !isPositiveFinite(hand.palmWidthMm) ||
    !isPositiveFinite(mouse.lengthMm) ||
    !isPositiveFinite(mouse.widthMm) ||
    !isPositiveFinite(mouse.heightMm) ||
    (level !== undefined && !isThicknessLevel(level))
  ) {
    return { applicable: false, status, reason: "invalid_input" };
  }
  if (!isVerticalFormFactor(mouse)) {
    return { applicable: false, status, reason: "not_vertical_form_factor" };
  }

  const { targets, sigmaMm, weights } = config;
  const wiring: ThicknessWiring = config.thickness ?? { kind: "none" };

  // Wiring A: one scale on every size target. 1 (and no multiply) otherwise.
  let thickness: VerticalThicknessApplied | undefined;
  let priorScale: number | undefined;
  if (level !== undefined && wiring.kind === "prior") {
    const ordinal = PALM_THICKNESS_ORDINAL[level];
    priorScale = 1 - wiring.stepPerOrdinal * ordinal;
    thickness = { level, ordinal, wiring: "prior", targetScale: priorScale };
  }
  const target = (rule: VerticalTargetRule): number =>
    priorScale === undefined
      ? targetMm(hand, rule)
      : targetMm(hand, rule) * priorScale;

  const lengthPart = part(
    mouse.lengthMm,
    target(targets.length),
    sigmaMm.length,
    weights.length,
    {
      close: "vertical_length_close",
      low: "vertical_length_short",
      high: "vertical_length_long",
    },
  );
  const heightPart = part(
    mouse.heightMm,
    target(targets.height),
    sigmaMm.height,
    weights.height,
    {
      close: "vertical_height_close",
      low: "vertical_height_low",
      high: "vertical_height_high",
    },
  );

  // Wiring B swaps the width-proxy slot for a cross-section quantity.
  let widthPart: VerticalSubscore;
  if (level !== undefined && wiring.kind === "section") {
    const mouseMm = sectionMeanMm(
      mouse.sections,
      wiring.stations,
      wiring.quantity,
    );
    if (mouseMm === null) {
      return { applicable: false, status, reason: "section_data_missing" };
    }
    const scale = wiring.scale[level] ** wiring.direction;
    widthPart = part(
      mouseMm,
      hand.palmWidthMm * wiring.ratioToPalmWidth * scale,
      wiring.sigmaMm,
      weights.widthProxy,
      {
        close: "vertical_section_close",
        low: "vertical_section_small",
        high: "vertical_section_large",
      },
    );
    thickness = {
      level,
      ordinal: PALM_THICKNESS_ORDINAL[level],
      wiring: "section",
      targetScale: scale,
      section: { quantity: wiring.quantity, mouseMm },
    };
  } else {
    widthPart = part(
      mouse.widthMm,
      target(targets.widthProxy),
      sigmaMm.widthProxy,
      weights.widthProxy,
      {
        close: "vertical_width_proxy_close",
        low: "vertical_width_proxy_narrow",
        high: "vertical_width_proxy_wide",
      },
    );
  }

  const subscores: Record<VerticalSubscoreKey, VerticalSubscore> = {
    length: lengthPart,
    height: heightPart,
    widthProxy: widthPart,
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
    ...(thickness ? { thickness } : {}),
  };
}
