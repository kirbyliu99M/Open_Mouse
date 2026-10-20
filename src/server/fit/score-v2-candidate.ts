import {
  GRIP_STYLES,
  type ExclusionReason,
  type FitCoverage,
  type FitPreferences,
  type FitResponse,
  type GripStyle,
} from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { ENGINE_VERSION_V2 } from "./coefficients";
import { excludeReasonV1, type ExclusionOptions } from "./exclusions-v1";
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
import { computeTargetsByGrip, type FitTargets } from "./targets";
import type { CatalogueMouse } from "./types";

export { ENGINE_VERSION_V2 } from "./coefficients";

/**
 * fit-v2.0 candidate engine (未拍板). Internal and test-only this round: not
 * the default engine, and not wired into the results page, the analysis or
 * the share card (they do not handle `coverage` yet; see the contract).
 *
 * Every v1 coefficient, weight, σ, prior, exclusion rule and the ranking order
 * are reused unchanged (it calls v1's own `scoreMouseV1` and helpers). It
 * adds two ranking options, independent of each other; with both off it is
 * v1 item for item (only `engineVersion` differs):
 *
 * - `clampLength` (default on): the length target of every grip in play is
 *   clamped to [min, max] of the lengths of the rankable mice (those that pass
 *   `excludeReasonV1` with the same preferences and options) for RANKING. The
 *   order, `total`, `confidence` and the tie-break come from the clamped
 *   targets; the displayed `subscores` (scores, reason codes, params) and
 *   `targets` stay on the TRUE targets. Grip width and height are not clamped.
 *   A target equal to an edge is in range. With nothing rankable there is no
 *   range: no clamp, and no `coverage`.
 * - `equalWeightsWhenUnknown` (default on): with no stated grip the blend is
 *   1/3 per grip. `predicted`, `used` and `handType` stay v1's (the arg-max of
 *   v1's soft weights), never an arg-max of the equal weights.
 *
 * A `wrong_hand` exclusion's `total` is scored against the same ranking grip
 * context as the ranked mice (clamped targets, the same weights), so it
 * differs from v1 exactly when the ranking does.
 */
export interface FitV2Options extends ExclusionOptions {
  /** Rank against the length target clamped to the rankable range. Default true. */
  clampLength?: boolean;
  /** With no stated grip, blend the three grips with weight 1/3 each. Default true. */
  equalWeightsWhenUnknown?: boolean;
}

/** What one v2 call fixes before it looks at the hand: exclusions and the range they leave. */
export interface PlanV2 {
  /** Every excluded mouse, in catalogue order. */
  excluded: readonly { mouse: CatalogueMouse; reason: ExclusionReason }[];
  /** The mice that are ranked, in catalogue order. */
  rankable: readonly CatalogueMouse[];
  /** [min, max] of the rankable lengths, or null when nothing is rankable. */
  lengthRangeMm: readonly [number, number] | null;
}

/**
 * Exclusions do not depend on the measurements, so a call that ranks several
 * hands against one catalogue (rank stability) plans once.
 */
export function planV2(
  catalogue: readonly CatalogueMouse[],
  hand: "left" | "right",
  prefs: FitPreferences,
  options: FitV2Options = {},
): PlanV2 {
  const excluded: { mouse: CatalogueMouse; reason: ExclusionReason }[] = [];
  const rankable: CatalogueMouse[] = [];
  for (const mouse of catalogue) {
    const reason = excludeReasonV1(mouse, hand, prefs, options);
    if (reason) excluded.push({ mouse, reason });
    else rankable.push(mouse);
  }
  let lengthRangeMm: readonly [number, number] | null = null;
  if (rankable.length > 0) {
    let min = rankable[0]!.lengthMm;
    let max = min;
    for (const m of rankable) {
      if (m.lengthMm < min) min = m.lengthMm;
      if (m.lengthMm > max) max = m.lengthMm;
    }
    lengthRangeMm = [min, max];
  }
  return { excluded, rankable, lengthRangeMm };
}

const EQUAL_GRIP_WEIGHTS: GripWeights = {
  palm: 1 / 3,
  claw: 1 / 3,
  fingertip: 1 / 3,
};

type Direction = "above" | "below" | null;

function directionOf(
  targetMm: number,
  range: readonly [number, number],
): Direction {
  if (targetMm < range[0]) return "below";
  if (targetMm > range[1]) return "above";
  return null;
}

/** The grip state of one v2 call: the choice, the blend and both sets of targets. */
export interface GripStateV2 {
  stated: GripStyle | null;
  predicted: GripStyle;
  used: GripStyle;
  weights: GripWeights;
  /** The unclamped targets of every grip (thickness shift included). */
  trueTargets: Record<GripStyle, FitTargets>;
  /** What every mouse is ranked against: `trueTargets` with clamped lengths. */
  ranking: GripContext;
  /** Per grip in play: which edge its length target was clamped to, if any. */
  clamped: Record<GripStyle, Direction>;
  /** The clamp was applied (an option on and something rankable). */
  clampApplied: boolean;
}

export function gripStateV2(
  measurements: HandMeasurements,
  prefs: FitPreferences,
  plan: PlanV2,
  options: FitV2Options = {},
): GripStateV2 {
  const { r, stated, predicted, used } = gripChoiceV1(measurements, prefs);
  const equal = options.equalWeightsWhenUnknown ?? true;
  const weights =
    stated === null && equal
      ? { ...EQUAL_GRIP_WEIGHTS }
      : gripWeights(r, stated);
  const gripsInPlay = GRIP_STYLES.filter((g) => weights[g] > 0);

  // Candidate (v1): an undefined palmThickness (no answer) adds no shift.
  const trueTargets = computeTargetsByGrip(
    measurements.handLengthMm,
    measurements.palmWidthMm,
    prefs.palmThickness,
  );

  const range = (options.clampLength ?? true) ? plan.lengthRangeMm : null;
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
    trueTargets,
    ranking: { used, weights, gripsInPlay, targetsByGrip: rankingTargets },
    clamped,
    clampApplied: range !== null,
  };
}

/**
 * The ranking only: every rankable mouse scored against the ranking grip
 * context and sorted in v1 §6 order. No response is assembled and no display
 * sub-score is recomputed; `scoreFitV2` and the rank stability both rank
 * through this one function, so their orders cannot drift apart.
 */
export function rankV2(
  plan: PlanV2,
  measurements: HandMeasurements,
  prefs: FitPreferences,
  priors: Priors,
  options: FitV2Options = {},
): { state: GripStateV2; ranked: ScoredMouseV1[] } {
  const state = gripStateV2(measurements, prefs, plan, options);
  const ranked: ScoredMouseV1[] = plan.rankable.map((mouse) => ({
    mouse,
    score: scoreMouseV1(mouse, state.ranking, priors, prefs),
  }));
  ranked.sort(compareScoredV1);
  return { state, ranked };
}

/**
 * The fit-v2.0 candidate engine. Same arguments as `scoreFitV1`, with the two
 * v2 options next to the exclusion options. Pure: it reads its arguments and
 * changes none of them. It never computes rank stability (that is
 * `attachRankStability`, a separate step).
 */
export function scoreFitV2(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
  priors: Priors,
  options: FitV2Options = {},
): Omit<FitResponse, "scanId"> {
  const plan = planV2(catalogue, hand, prefs, options);
  const { state, ranked } = rankV2(plan, measurements, prefs, priors, options);
  const { stated, predicted, used, weights, trueTargets } = state;

  // Displayed sub-scores come from the true targets of the grip used. They
  // differ from the ranking ones only when that grip's length was clamped,
  // so only then are they computed a second time.
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
    engineVersion: ENGINE_VERSION_V2,
    hand,
    gripStyle: {
      stated,
      predicted,
      used,
      // As in v1: `weights` only when no grip was stated (here, possibly equal).
      ...(stated === null ? { weights } : {}),
    },
    ...handTypeFieldV1(measurements, used, catalogue),
    targets: trueTargets[used],
    excluded,
    results,
    ...(coverage ? { coverage } : {}),
  };
}
