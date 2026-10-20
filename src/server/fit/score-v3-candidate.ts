import {
  GRIP_STYLES,
  type FitCalibration,
  type FitCoverage,
  type FitPreferences,
  type FitResponse,
  type GripStyle,
} from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { calibrateV3 } from "./calibration-v3-candidate";
import {
  ENGINE_VERSION_V3,
  GRIP_WIDTH_FACTOR_V3,
  HEIGHT_FACTOR,
  LENGTH_FACTOR,
  THICKNESS_HEIGHT_SHIFT_MM_V3,
} from "./coefficients";
import type { ExclusionOptions } from "./exclusions-v1";
import { gripWeights, type GripWeights } from "./grip-weights";
import type { Priors } from "./priors";
import {
  compareScoredV1,
  excludedEntryV1,
  gripChoiceV1,
  handTypeFieldV1,
  scoreMouseV1,
  toFitEntryV1,
  type GripContext,
  type ScoredMouseV1,
} from "./score-v1";
import { planV2, type PlanV2 } from "./score-v2-candidate";
import type { FitTargets } from "./targets";
import type { CatalogueMouse } from "./types";

export { ENGINE_VERSION_V3 } from "./coefficients";

/**
 * fit-v3.0 candidate engine (未拍板; Kirby's provisional settings of
 * 2026-10-19). Internal and test-only: not the default engine, and not wired
 * into the results page, the analysis or the share card (they do not handle
 * `calibration` yet; see the contract).
 *
 * It is the v2 candidate with three changes, nothing else:
 *
 * 1. The grip-width target is palmWidth x 1.00 (v1 and v2: 0.88).
 * 2. A palm-thickness answer moves the height target the other way: thick
 *    lowers it by 1.5 mm, thin raises it by 1.5 mm (v1: the reverse). No
 *    answer, no shift.
 * 3. Personal calibration: a request whose `prefs.references` is not empty
 *    adds one offset each to the length, grip-width and height targets (the
 *    same offset for all three grips), from `calibrateV3`. The response then
 *    carries `calibration`, and its `targets` already include the offsets.
 *
 * Everything else is v2: the length target is clamped to the rankable range
 * for RANKING only (displayed sub-scores and `targets` stay on the true,
 * calibrated targets), an unstated grip blends the three grips equally,
 * `coverage` is reported, and rank stability is a separate step
 * (`attachRankStabilityV3`). v1 and v2 are untouched.
 */
export interface FitV3Options extends ExclusionOptions {
  /** With no stated grip, blend the three grips with weight 1/3 each. Default true. */
  equalWeightsWhenUnknown?: boolean;
}

const EQUAL_GRIP_WEIGHTS: GripWeights = {
  palm: 1 / 3,
  claw: 1 / 3,
  fingertip: 1 / 3,
};

/**
 * v3's targets of every grip before any calibration offset: v1's, with the
 * grip-width factor of 1.00 and the reversed thickness shift. The shift
 * reaches all three grips alike; undefined adds nothing.
 */
export function baseTargetsV3(
  measurements: HandMeasurements,
  palmThickness: FitPreferences["palmThickness"],
): Record<GripStyle, FitTargets> {
  const shiftMm =
    palmThickness === undefined
      ? 0
      : THICKNESS_HEIGHT_SHIFT_MM_V3[palmThickness];
  return Object.fromEntries(
    GRIP_STYLES.map((g) => [
      g,
      {
        lengthMm: measurements.handLengthMm * LENGTH_FACTOR[g],
        gripWidthMm: measurements.palmWidthMm * GRIP_WIDTH_FACTOR_V3,
        heightMm: measurements.handLengthMm * HEIGHT_FACTOR[g] + shiftMm,
      },
    ]),
  ) as Record<GripStyle, FitTargets>;
}

type Direction = "above" | "below" | null;

function directionOf(
  targetMm: number,
  range: readonly [number, number],
): Direction {
  if (targetMm < range[0]) return "below";
  if (targetMm > range[1]) return "above";
  return null;
}

/** The grip state of one v3 call: the choice, the blend, the calibration and both sets of targets. */
export interface GripStateV3 {
  stated: GripStyle | null;
  predicted: GripStyle;
  used: GripStyle;
  weights: GripWeights;
  /** v3's targets before any offset. */
  baseTargets: Record<GripStyle, FitTargets>;
  /** The calibration block, only when the request had references. */
  calibration: FitCalibration | null;
  /** The unclamped targets of every grip, offsets included. */
  trueTargets: Record<GripStyle, FitTargets>;
  /** What every mouse is ranked against: `trueTargets` with clamped lengths. */
  ranking: GripContext;
  /** Per grip in play: which edge its length target was clamped to, if any. */
  clamped: Record<GripStyle, Direction>;
  /** The clamp was applied (something was rankable). */
  clampApplied: boolean;
}

export function gripStateV3(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  plan: PlanV2,
  options: FitV3Options = {},
): GripStateV3 {
  const { r, stated, predicted, used } = gripChoiceV1(measurements, prefs);
  const equal = options.equalWeightsWhenUnknown ?? true;
  const weights: GripWeights =
    stated === null && equal
      ? { ...EQUAL_GRIP_WEIGHTS }
      : gripWeights(r, stated);
  const gripsInPlay = GRIP_STYLES.filter((g) => weights[g] > 0);

  const baseTargets = baseTargetsV3(measurements, prefs.palmThickness);

  // Design choice (documented, not a bug): a reference the person gave no
  // grips for is judged only in `used`, the grip this hand is predicted (or
  // stated) to use, and the offset it yields is then applied to the targets of
  // all three grips alike. It does not say which grip the person holds that
  // mouse in, and the prediction is the best guess there is.
  const references = prefs.references ?? [];
  const result =
    references.length > 0
      ? calibrateV3(references, catalogue, baseTargets, used)
      : null;
  const shift = result?.shiftsMm ?? { length: 0, gripWidth: 0, height: 0 };

  const trueTargets = Object.fromEntries(
    GRIP_STYLES.map((g) => [
      g,
      {
        lengthMm: baseTargets[g].lengthMm + shift.length,
        gripWidthMm: baseTargets[g].gripWidthMm + shift.gripWidth,
        heightMm: baseTargets[g].heightMm + shift.height,
      },
    ]),
  ) as Record<GripStyle, FitTargets>;

  // v2's clamp, after the offset: the length target of every grip in play is
  // brought into the rankable range for ranking.
  const range = plan.lengthRangeMm;
  const clamped: Record<GripStyle, Direction> = {
    palm: null,
    claw: null,
    fingertip: null,
  };
  const rankingTargets = { ...trueTargets };
  if (range !== null) {
    for (const g of gripsInPlay) {
      const direction = directionOf(trueTargets[g].lengthMm, range);
      clamped[g] = direction;
      if (direction !== null) {
        rankingTargets[g] = {
          ...trueTargets[g],
          lengthMm: direction === "above" ? range[1] : range[0],
        };
      }
    }
  }

  return {
    stated,
    predicted,
    used,
    weights,
    baseTargets,
    calibration: result?.calibration ?? null,
    trueTargets,
    ranking: { used, weights, gripsInPlay, targetsByGrip: rankingTargets },
    clamped,
    clampApplied: range !== null,
  };
}

/**
 * The ranking only, as `rankV2` is for v2: `scoreFitV3` and the rank
 * stability both rank through this one function.
 */
export function rankV3(
  plan: PlanV2,
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  priors: Priors,
  options: FitV3Options = {},
): { state: GripStateV3; ranked: ScoredMouseV1[] } {
  const state = gripStateV3(measurements, catalogue, prefs, plan, options);
  const ranked: ScoredMouseV1[] = plan.rankable.map((mouse) => ({
    mouse,
    score: scoreMouseV1(mouse, state.ranking, priors, prefs),
  }));
  ranked.sort(compareScoredV1);
  return { state, ranked };
}

/**
 * The fit-v3.0 candidate engine. Same arguments as `scoreFitV2`. Pure: it
 * reads its arguments and changes none of them. It never computes rank
 * stability.
 */
export function scoreFitV3(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
  priors: Priors,
  options: FitV3Options = {},
): Omit<FitResponse, "scanId"> {
  const plan = planV2(catalogue, hand, prefs, options);
  const { state, ranked } = rankV3(
    plan,
    measurements,
    catalogue,
    prefs,
    priors,
    options,
  );
  const { stated, predicted, used, weights, trueTargets } = state;

  // As in v2: displayed sub-scores come from the true targets of the grip
  // used, recomputed only when that grip's length was clamped.
  const usedClamped = state.clamped[used] !== null;
  const display: GripContext = {
    used,
    weights: { palm: 0, claw: 0, fingertip: 0, [used]: 1 },
    gripsInPlay: [used],
    targetsByGrip: trueTargets,
  };
  const results = ranked.map(({ mouse, score }, i) =>
    toFitEntryV1(
      mouse,
      score,
      i + 1,
      usedClamped
        ? scoreMouseV1(mouse, display, priors, prefs).subscores
        : score.subscores,
    ),
  );

  const excluded = plan.excluded.map(({ mouse, reason }) =>
    excludedEntryV1(mouse, reason, state.ranking, priors, prefs),
  );

  let coverage: FitCoverage | undefined;
  if (state.clampApplied && plan.lengthRangeMm !== null) {
    coverage = {
      lengthOutOfRange: state.ranking.gripsInPlay.some(
        (g) => state.clamped[g] !== null,
      ),
      direction: state.clamped[used],
      usedGripLengthTargetMm: trueTargets[used].lengthMm,
      catalogueLengthRangeMm: [plan.lengthRangeMm[0], plan.lengthRangeMm[1]],
    };
  }

  return {
    engineVersion: ENGINE_VERSION_V3,
    hand,
    gripStyle: {
      stated,
      predicted,
      used,
      ...(stated === null ? { weights } : {}),
    },
    // The hand-type label is display only and reads the uncalibrated v1
    // targets, as in v1 and v2.
    ...handTypeFieldV1(measurements, used, catalogue),
    targets: trueTargets[used],
    excluded,
    results,
    ...(coverage ? { coverage } : {}),
    ...(state.calibration ? { calibration: state.calibration } : {}),
  };
}
