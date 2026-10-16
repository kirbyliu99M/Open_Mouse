import {
  GRIP_STYLES,
  SUBSCORES,
  type ExclusionReason,
  type FitPreferences,
  type GripStyle,
  type Subscore,
} from "../../lib/contracts/fit";
import type { Size } from "../../lib/contracts/descriptors";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import {
  DEFAULT_PARAMS_V2,
  ENGINE_IS_PROVISIONAL,
  ENGINE_VERSION_V2,
  EQUAL_GRIP_WEIGHT,
  type FitV2Params,
  type Tolerance,
} from "./coefficients-v2";
import {
  assertCovariance,
  inverse3,
  quadForm,
  targetCovariance,
  type Matrix3,
  type Vector3,
} from "./covariance-v2";
import { excludeReasonV1, type ExclusionOptions } from "./exclusions-v1";
import { argmaxGrip, gripWeights } from "./grip-weights";
import type { Priors } from "./priors";
import { compareRankKeys } from "./score-v1";
import {
  effectiveWidthMm,
  scoreFrontFlare,
  scoreGripWidthV2,
  scoreHeightHumpV2,
  scoreLengthV2,
  scoreThumb,
  scoreWeightV1,
  type SideSigma,
} from "./subscores-v2";
import { computeTargetsByGrip, type FitTargets } from "./targets";
import type { CatalogueMouse, SubscoreResult } from "./types";

export { ENGINE_IS_PROVISIONAL, ENGINE_VERSION_V2 } from "./coefficients-v2";

/**
 * fit-v2 STRUCTURE prototype (候選, 未拍板). Offline only: not wired into
 * `engine.ts`, the API or the contract. Same sub-scores, weights and tables as
 * v1; what changes is how uncertainty and grip are handled.
 *
 * ## The maths: tolerance, measurement noise and correlation
 *
 * Two different things widen a Gaussian, and v2 keeps them apart:
 *
 *  - `tolerance` (sigma_i): how far a mouse may sit from the ideal before the
 *    person minds. A preference, v1's sigma (6, 5, 3 mm).
 *  - `Sigma_target`: how wrong the target itself may be, because the hand
 *    measurement is wrong. Derived, never typed in.
 *
 * Input x = (handLength, palmWidth) is measured with error e ~ N(0, Sigma_in).
 * Every target is linear in x (targets.ts), t = J x + c, so the target error is
 * eta = J e ~ N(0, Sigma_t) with Sigma_t = J Sigma_in J^T. For one grip
 *
 *     J = [[a_g, 0], [0, 0.88], [b_g, 0]]      rows: length, gripWidth, height
 *
 * Sigma_t[length][height] = a_g b_g Var(handLength): length and height both
 * come from handLength, so their errors are perfectly correlated. (v1 used
 * the right variances, k^2 sigma_meas^2, but treated the errors as
 * independent.) Sigma_t[length][gripWidth] = a_g 0.88 Cov(handLength, palmWidth).
 *
 * Score of one dimension against the TRUE target tau = t + eta, with
 * s(m - tau) = exp(-1/2 (m - tau)^2 / sigma^2). Averaging over eta (a
 * Gaussian convolved with a Gaussian, closed form):
 *
 *     E[s] = sigma / sqrt(sigma^2 + v) * exp(-1/2 delta^2 / (sigma^2 + v)),
 *     v = Sigma_t[i][i], delta = m - t.
 *
 * v1 (and v2) drop the leading factor, so a perfect match stays 100: the
 * score is the peak-normalised form with sigma_eff^2 = sigma^2 + v. The
 * ranking is unaffected by the dropped factor within one dimension but it is
 * not the exact expectation; that is a v1 choice kept on purpose.
 *
 * Why correlation does not move the TOTAL: total = sum_i w_i s_i is linear in
 * the sub-scores, so E[total] = sum_i w_i E[s_i] and every term needs only its
 * own marginal variance v_i = Sigma_t[i][i]. The off-diagonals cancel out of
 * the expected total. v2's marginal total therefore equals v1's whenever the
 * diagonals agree, however the errors correlate. Correlation matters wherever
 * the dimensions are combined non-additively:
 *
 *  - the spread of the total, hence ranking stability (`stability-v2.ts`
 *    resamples the hand jointly, so length and height move together);
 *  - a joint match. For the product score exp(-1/2 d^T T^-1 d), T = diag(sigma^2),
 *    E over eta is |T|^1/2 / |T + Sigma_t|^1/2 * exp(-1/2 d^T (T + Sigma_t)^-1 d).
 *    `jointMatch` is that, peak-normalised, as a diagnostic (not in the total).
 *
 * `asymmetry` makes the tolerance different above and below the target
 * (split Gaussian). Convolving a split Gaussian with a Gaussian has no closed
 * form of this shape, so each side simply uses its own tolerance in
 * sigma_side^2 = tolerance_side^2 + v: an approximation, exact when
 * asymmetry = 1.
 */

type Subscores = Record<Subscore, SubscoreResult>;

export type Dim = "length" | "gripWidth" | "height";
export const DIMS: readonly Dim[] = ["length", "gripWidth", "height"];

/** Sigma (below, above) for each of the three Gaussian dimensions. */
export type DimSigma = Record<Dim, SideSigma>;

export function resolveParams(
  overrides: Partial<FitV2Params> = {},
): FitV2Params {
  const params: FitV2Params = {
    ...DEFAULT_PARAMS_V2,
    ...overrides,
    tolerance: { ...DEFAULT_PARAMS_V2.tolerance, ...overrides.tolerance },
    asymmetry: { ...DEFAULT_PARAMS_V2.asymmetry, ...overrides.asymmetry },
  };
  assertCovariance(params.sigmaInput);
  return params;
}

/** What the target error is made of, for one grip: tolerance and measurement kept apart. */
export interface GripUncertainty {
  /** Lower-side preference tolerance, mm (v1's sigma). */
  tolerance: Tolerance;
  /** Upper-side preference tolerance, mm (tolerance x asymmetry). */
  toleranceHi: Tolerance;
  /** J Sigma_in J^T over (length, gripWidth, height), mm^2. */
  targetCovariance: Matrix3;
  /** sqrt of the diagonal of targetCovariance, mm. */
  measurementSd: Tolerance;
  /** sqrt(tolerance^2 + variance) below the target, per dimension, mm. */
  sigmaEff: DimSigma;
}

function dimSigma(
  params: FitV2Params,
  variance: Record<Dim, number>,
): DimSigma {
  const out = {} as DimSigma;
  for (const d of DIMS) {
    const lo = params.tolerance[d];
    const hi = lo * params.asymmetry[d];
    out[d] = {
      lo: Math.sqrt(lo ** 2 + variance[d]),
      hi: Math.sqrt(hi ** 2 + variance[d]),
    };
  }
  return out;
}

export function uncertaintyForGrip(
  params: FitV2Params,
  grip: GripStyle,
): GripUncertainty {
  const cov = targetCovariance(params.sigmaInput, grip);
  const variance = {
    length: cov[0][0],
    gripWidth: cov[1][1],
    height: cov[2][2],
  };
  const tolerance = { ...params.tolerance };
  const toleranceHi = {
    length: tolerance.length * params.asymmetry.length,
    gripWidth: tolerance.gripWidth * params.asymmetry.gripWidth,
    height: tolerance.height * params.asymmetry.height,
  };
  return {
    tolerance,
    toleranceHi,
    targetCovariance: cov,
    measurementSd: {
      length: Math.sqrt(variance.length),
      gripWidth: Math.sqrt(variance.gripWidth),
      height: Math.sqrt(variance.height),
    },
    sigmaEff: dimSigma(params, variance),
  };
}

/** Sigma with no measurement noise: used when the hand is a sampled "true" hand. */
export function toleranceOnlySigma(params: FitV2Params): DimSigma {
  return dimSigma(params, { length: 0, gripWidth: 0, height: 0 });
}

/** The per-hand grip state every mouse is scored against. */
export interface GripContextV2 {
  stated: GripStyle | null;
  /** True when the user gave no grip. */
  gripUnknown: boolean;
  weights: Record<GripStyle, number>;
  gripsInPlay: readonly GripStyle[];
  /**
   * The grip whose confidence and length delta rank ties: the stated grip, or
   * (v1_ratio mode only) the arg-max. Null when the grip is unknown and the
   * three grips are weighted equally.
   */
  used: GripStyle | null;
  targetsByGrip: Record<GripStyle, FitTargets>;
}

/**
 * Stated grip: weight 1, as v1. No grip: equal thirds, never inferred from
 * the palm/hand ratio (D3: no source links hand size to grip). The only way
 * to get v1's ratio weights is `gripUnknownMode: "v1_ratio"`.
 */
export function buildGripContextV2(
  measurements: HandMeasurements,
  prefs: FitPreferences,
  params: FitV2Params,
): GripContextV2 {
  const stated = prefs.gripStyle ?? null;
  let weights: Record<GripStyle, number>;
  let used: GripStyle | null;
  if (stated !== null) {
    weights = gripWeights(0, stated);
    used = stated;
  } else if (params.gripUnknownMode === "v1_ratio") {
    weights = gripWeights(
      measurements.palmLengthMm / measurements.handLengthMm,
    );
    used = argmaxGrip(weights);
  } else {
    weights = {
      palm: EQUAL_GRIP_WEIGHT,
      claw: EQUAL_GRIP_WEIGHT,
      fingertip: EQUAL_GRIP_WEIGHT,
    };
    used = null;
  }
  return {
    stated,
    gripUnknown: stated === null,
    weights,
    gripsInPlay: GRIP_STYLES.filter((g) => weights[g] > 0),
    used,
    targetsByGrip: computeTargetsByGrip(
      measurements.handLengthMm,
      measurements.palmWidthMm,
      prefs.palmThickness,
    ),
  };
}

function subscoresFor(
  mouse: CatalogueMouse,
  targets: FitTargets,
  grip: GripStyle,
  prefs: FitPreferences,
  sigma: DimSigma,
): Subscores {
  return {
    length: scoreLengthV2(mouse, targets.lengthMm, sigma.length),
    gripWidth: scoreGripWidthV2(mouse, targets.gripWidthMm, sigma.gripWidth),
    heightHump: scoreHeightHumpV2(mouse, targets.heightMm, grip, sigma.height),
    frontFlare: scoreFrontFlare(mouse, grip),
    thumb: scoreThumb(mouse, grip),
    weight: scoreWeightV1(mouse, prefs),
  };
}

/** v1's weighted mean over applicable sub-scores for one grip (null scores take the prior). */
function totalFor(subscores: Subscores, priors: Priors, grip: GripStyle) {
  let weightedScoreSum = 0;
  let applicableWeightSum = 0;
  let confidenceNumerator = 0;
  for (const key of SUBSCORES) {
    const s = subscores[key];
    if (s.reason.code === "no_preference") continue;
    applicableWeightSum += s.weight;
    weightedScoreSum += (s.score ?? priors[key][grip]) * s.weight;
    if (s.reason.code !== "descriptor_unknown") confidenceNumerator += s.weight;
  }
  return {
    total: applicableWeightSum > 0 ? weightedScoreSum / applicableWeightSum : 0,
    confidence:
      applicableWeightSum > 0 ? confidenceNumerator / applicableWeightSum : 0,
  };
}

export interface GripScoreV2 {
  total: number;
  confidence: number;
  subscores: Subscores;
}

export interface MouseScoreV2 {
  /** Unrounded blended total, sum over grips of weight x per-grip total. */
  totalRaw: number;
  total: number;
  /** Rank-tie confidence: the used grip's, or the weighted mean over grips. */
  confidence: number;
  /** Rank-tie |length delta|, mm: the used grip's, or the weighted mean. */
  lengthAbsDelta: number;
  byGrip: Partial<Record<GripStyle, GripScoreV2>>;
}

/** Scores one mouse against every grip in play with the given sigmas (pure). */
export function scoreMouseV2(
  mouse: CatalogueMouse,
  grips: GripContextV2,
  priors: Priors,
  prefs: FitPreferences,
  sigmaByGrip: Record<GripStyle, DimSigma>,
): MouseScoreV2 {
  let totalRaw = 0;
  let weightedConfidence = 0;
  let weightedLengthDelta = 0;
  const byGrip: Partial<Record<GripStyle, GripScoreV2>> = {};
  for (const g of grips.gripsInPlay) {
    const subs = subscoresFor(
      mouse,
      grips.targetsByGrip[g],
      g,
      prefs,
      sigmaByGrip[g],
    );
    const t = totalFor(subs, priors, g);
    byGrip[g] = { total: t.total, confidence: t.confidence, subscores: subs };
    const w = grips.weights[g];
    totalRaw += w * t.total;
    weightedConfidence += w * t.confidence;
    weightedLengthDelta += w * Math.abs(subs.length.reason.params.deltaMm ?? 0);
  }
  const usedScore = grips.used !== null ? byGrip[grips.used] : undefined;
  return {
    totalRaw,
    total: Math.round(totalRaw),
    confidence: usedScore ? usedScore.confidence : weightedConfidence,
    lengthAbsDelta: usedScore
      ? Math.abs(usedScore.subscores.length.reason.params.deltaMm ?? 0)
      : weightedLengthDelta,
    byGrip,
  };
}

/** [lo, hi] in mm. */
export interface DimRange {
  lo: number;
  hi: number;
}
/** Acceptable range per dimension; gripWidth is in the effective-width domain. */
export type GripRanges = Record<Dim, DimRange>;

/**
 * The interval in which a mouse dimension keeps a sub-score of at least
 * `thresholdScore`: target - c sigma_lo ... target + c sigma_hi, with
 * c = sqrt(-2 ln(threshold / 100)). Symmetric unless `asymmetry` is not 1.
 */
export function acceptableRange(
  targets: FitTargets,
  sigma: DimSigma,
  thresholdScore: number,
): GripRanges {
  if (!(thresholdScore > 0 && thresholdScore <= 100)) {
    throw new Error("rangeThresholdScore must be in (0, 100]");
  }
  const c = Math.sqrt(-2 * Math.log(thresholdScore / 100));
  const centre: Record<Dim, number> = {
    length: targets.lengthMm,
    gripWidth: targets.gripWidthMm,
    height: targets.heightMm,
  };
  const out = {} as GripRanges;
  for (const d of DIMS) {
    out[d] = {
      lo: centre[d] - c * sigma[d].lo,
      hi: centre[d] + c * sigma[d].hi,
    };
  }
  return out;
}

export interface InRange {
  length: boolean;
  gripWidth: boolean;
  height: boolean;
  all: boolean;
}

export function mouseInRange(
  mouse: CatalogueMouse,
  ranges: GripRanges,
): InRange {
  const within = (v: number, r: DimRange) => v >= r.lo && v <= r.hi;
  const length = within(mouse.lengthMm, ranges.length);
  const gripWidth = within(effectiveWidthMm(mouse), ranges.gripWidth);
  const height = within(mouse.heightMm, ranges.height);
  return { length, gripWidth, height, all: length && gripWidth && height };
}

/**
 * Peak-normalised joint match of one mouse for one grip (diagnostic, not in
 * the total): 100 exp(-1/2 d^T (T + Sigma_t)^-1 d), T = diag(tolerance^2) with
 * each tolerance taken on the side d points to. See the derivation above.
 */
export function jointMatch(
  deltas: Vector3,
  uncertainty: GripUncertainty,
): number {
  const tol = DIMS.map((d, i) =>
    deltas[i] < 0 ? uncertainty.tolerance[d] : uncertainty.toleranceHi[d],
  );
  const cov = uncertainty.targetCovariance;
  const m: Matrix3 = [
    [tol[0] ** 2 + cov[0][0], cov[0][1], cov[0][2]],
    [cov[1][0], tol[1] ** 2 + cov[1][1], cov[1][2]],
    [cov[2][0], cov[2][1], tol[2] ** 2 + cov[2][2]],
  ];
  return 100 * Math.exp(-0.5 * quadForm(inverse3(m), deltas));
}

export interface FitV2Entry {
  rank: number;
  mouse: {
    slug: string;
    brand: string;
    model: string;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    weightG: number | null;
    size: Size;
  };
  total: number;
  totalRaw: number;
  confidence: number;
  /** Unrounded sub-scores for each grip in play. */
  subscoresByGrip: Partial<
    Record<
      GripStyle,
      Record<Subscore, { score: number | null; weight: number }>
    >
  >;
  inRange: Partial<Record<GripStyle, InRange>>;
  /** In range on all three dimensions for at least one grip in play. */
  inRangeAnyGrip: boolean;
  /** Weight-blended joint match, 0-100; a diagnostic that is not part of the total. */
  jointMatch: number;
}

export interface FitV2Response {
  engineVersion: typeof ENGINE_VERSION_V2;
  isProvisional: typeof ENGINE_IS_PROVISIONAL;
  hand: "left" | "right";
  /** True when no grip was stated; the grips then share the weight. */
  gripUnknown: boolean;
  gripStyle: {
    stated: GripStyle | null;
    used: GripStyle | null;
    weights: Record<GripStyle, number>;
    mode: "stated" | FitV2Params["gripUnknownMode"];
  };
  params: FitV2Params;
  targetsByGrip: Record<GripStyle, FitTargets>;
  /** Tolerance and measurement noise reported separately, per grip in play. */
  uncertainty: Partial<Record<GripStyle, GripUncertainty>>;
  ranges: Partial<Record<GripStyle, GripRanges>>;
  excluded: {
    slug: string;
    brand: string;
    model: string;
    reason: ExclusionReason;
  }[];
  results: FitV2Entry[];
}

export interface FitV2Options {
  params?: Partial<FitV2Params>;
  exclusion?: ExclusionOptions;
}

export function sigmaByGripFor(
  params: FitV2Params,
  grips: readonly GripStyle[],
): {
  uncertainty: Partial<Record<GripStyle, GripUncertainty>>;
  sigma: Record<GripStyle, DimSigma>;
} {
  const uncertainty: Partial<Record<GripStyle, GripUncertainty>> = {};
  const sigma = {} as Record<GripStyle, DimSigma>;
  for (const g of GRIP_STYLES) {
    const u = uncertaintyForGrip(params, g);
    sigma[g] = u.sigmaEff;
    if (grips.includes(g)) uncertainty[g] = u;
  }
  return { uncertainty, sigma };
}

/**
 * The fit-v2 structure prototype, a pure function of its arguments. Same
 * signature shape as `scoreFitV1`; the response is its own type, so the
 * contract is untouched.
 */
export function scoreFitV2(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
  priors: Priors,
  options: FitV2Options = {},
): FitV2Response {
  const params = resolveParams(options.params);
  const grips = buildGripContextV2(measurements, prefs, params);
  const { uncertainty, sigma } = sigmaByGripFor(params, grips.gripsInPlay);

  const ranges: Partial<Record<GripStyle, GripRanges>> = {};
  for (const g of grips.gripsInPlay) {
    ranges[g] = acceptableRange(
      grips.targetsByGrip[g],
      sigma[g],
      params.rangeThresholdScore,
    );
  }

  const excluded: FitV2Response["excluded"] = [];
  const scored: {
    entry: Omit<FitV2Entry, "rank">;
    key: {
      totalRaw: number;
      confidence: number;
      lengthAbsDelta: number;
      model: string;
    };
  }[] = [];

  for (const mouse of catalogue) {
    const reason = excludeReasonV1(mouse, hand, prefs, options.exclusion);
    if (reason) {
      excluded.push({
        slug: mouse.slug,
        brand: mouse.brand,
        model: mouse.model,
        reason,
      });
      continue;
    }
    const m = scoreMouseV2(mouse, grips, priors, prefs, sigma);
    const inRange: Partial<Record<GripStyle, InRange>> = {};
    const subscoresByGrip: FitV2Entry["subscoresByGrip"] = {};
    let joint = 0;
    for (const g of grips.gripsInPlay) {
      const gripRanges = ranges[g] as GripRanges;
      inRange[g] = mouseInRange(mouse, gripRanges);
      const subs = (m.byGrip[g] as GripScoreV2).subscores;
      subscoresByGrip[g] = Object.fromEntries(
        SUBSCORES.map((k) => [
          k,
          { score: subs[k].score, weight: subs[k].weight },
        ]),
      ) as Record<Subscore, { score: number | null; weight: number }>;
      joint +=
        grips.weights[g] *
        jointMatch(
          [
            subs.length.reason.params.deltaMm ?? 0,
            subs.gripWidth.reason.params.deltaMm ?? 0,
            subs.heightHump.reason.params.deltaMm ?? 0,
          ],
          uncertainty[g] as GripUncertainty,
        );
    }
    scored.push({
      entry: {
        mouse: {
          slug: mouse.slug,
          brand: mouse.brand,
          model: mouse.model,
          lengthMm: mouse.lengthMm,
          widthMm: mouse.widthMm,
          heightMm: mouse.heightMm,
          weightG: mouse.weightG,
          size: mouse.size,
        },
        total: m.total,
        totalRaw: m.totalRaw,
        confidence: m.confidence,
        subscoresByGrip,
        inRange,
        inRangeAnyGrip: Object.values(inRange).some((r) => r.all),
        jointMatch: joint,
      },
      key: {
        totalRaw: m.totalRaw,
        confidence: m.confidence,
        lengthAbsDelta: m.lengthAbsDelta,
        model: mouse.model,
      },
    });
  }

  scored.sort((a, b) => compareRankKeys(a.key, b.key));

  return {
    engineVersion: ENGINE_VERSION_V2,
    isProvisional: ENGINE_IS_PROVISIONAL,
    hand,
    gripUnknown: grips.gripUnknown,
    gripStyle: {
      stated: grips.stated,
      used: grips.used,
      weights: grips.weights,
      mode: grips.stated !== null ? "stated" : params.gripUnknownMode,
    },
    params,
    targetsByGrip: grips.targetsByGrip,
    uncertainty,
    ranges,
    excluded,
    results: scored.map(({ entry }, i) => ({ ...entry, rank: i + 1 })),
  };
}
