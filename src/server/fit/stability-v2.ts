import {
  GRIP_STYLES,
  type FitPreferences,
  type GripStyle,
} from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { STABILITY_SAMPLES, STABILITY_SEED } from "./coefficients-v2";
import {
  cholesky2,
  correctMeasurementsForBias,
  drawInputError,
  mulberry32,
  normalSampler,
} from "./covariance-v2";
import { excludeReasonV1 } from "./exclusions-v1";
import type { Priors } from "./priors";
import { compareRankKeys } from "./score-v1";
import {
  buildGripContextV2,
  resolveParams,
  scoreFitV2,
  scoreMouseV2,
  toleranceOnlySigma,
  type FitV2Options,
} from "./score-v2";
import type { CatalogueMouse } from "./types";

/**
 * Ranking stability under input uncertainty (fit-v2 prototype, 候選).
 *
 * Draw M "true hands" x_s = (x - b) + e_s with e_s ~ N(0, Sigma_input), where
 * b is `params.biasInput` (0 = no correction), jointly in
 * (handLength, palmWidth), so the length and height targets move together.
 * Each draw is scored with the tolerance only (no measurement widening: the
 * measurement noise is now in the draw), ranked with v1's order, and the
 * counts give each mouse's chance of top-1 and top-5. P10 to P90 is the spread
 * of its unrounded total over the draws.
 *
 * Scale note: these totals are the "tolerance only" scale. They are not the
 * sigma_eff totals of `scoreFitV2`: averaging the sampled scores would give
 * the exact expectation, which carries the factor sigma / sqrt(sigma^2 + v)
 * that the peak-normalised sigma_eff form leaves out. Compare ranks and
 * probabilities, not the two totals.
 *
 * palmLength is held fixed (it is only read by the "v1_ratio" grip mode).
 * Pure and deterministic: the PRNG is seeded.
 */

export interface MouseStability {
  slug: string;
  brand: string;
  model: string;
  /** Rank of the point estimate (the same order `scoreFitV2` gives). */
  baselineRank: number;
  top1Prob: number;
  top5Prob: number;
  totalP10: number;
  totalP50: number;
  totalP90: number;
}

export interface StabilityV2 {
  samples: number;
  seed: number;
  perMouse: MouseStability[];
}

/** Linear-interpolated percentile of an ascending-sorted array, p in [0, 1]. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export interface StabilityOptions extends FitV2Options {
  samples?: number;
  seed?: number;
}

export function rankingStabilityV2(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
  priors: Priors,
  options: StabilityOptions = {},
): StabilityV2 {
  const params = resolveParams(options.params);
  const samples = options.samples ?? STABILITY_SAMPLES;
  const seed = options.seed ?? STABILITY_SEED;
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error("samples must be a positive integer");
  }
  const ranked = catalogue.filter(
    (m) => excludeReasonV1(m, hand, prefs, options.exclusion) === null,
  );
  const tolSigma = toleranceOnlySigma(params);
  const sigmaByGrip = Object.fromEntries(
    GRIP_STYLES.map((g) => [g, tolSigma]),
  ) as Record<GripStyle, typeof tolSigma>;

  // The "true hand" is drawn around the bias-corrected input.
  const centre = correctMeasurementsForBias(measurements, params.biasInput);
  const chol = cholesky2(params.sigmaInput);
  const normal = normalSampler(mulberry32(seed));
  const top1 = new Array<number>(ranked.length).fill(0);
  const top5 = new Array<number>(ranked.length).fill(0);
  const totals: number[][] = ranked.map(() => []);

  for (let s = 0; s < samples; s++) {
    const [eL, eW] = drawInputError(chol, normal);
    const drawn: HandMeasurements = {
      ...centre,
      handLengthMm: centre.handLengthMm + eL,
      palmWidthMm: centre.palmWidthMm + eW,
    };
    const grips = buildGripContextV2(drawn, prefs, params);
    const rows = ranked.map((mouse, idx) => {
      const m = scoreMouseV2(mouse, grips, priors, prefs, sigmaByGrip);
      totals[idx].push(m.totalRaw);
      return {
        idx,
        key: {
          totalRaw: m.totalRaw,
          confidence: m.confidence,
          lengthAbsDelta: m.lengthAbsDelta,
          model: mouse.model,
        },
      };
    });
    rows.sort((a, b) => compareRankKeys(a.key, b.key));
    rows.forEach((r, pos) => {
      if (pos === 0) top1[r.idx] += 1;
      if (pos < 5) top5[r.idx] += 1;
    });
  }

  // The point estimate's rank is whatever scoreFitV2 reports for this input.
  const baseline = scoreFitV2(measurements, catalogue, prefs, hand, priors, {
    params: options.params,
    exclusion: options.exclusion,
  });
  const rankOf = new Map(
    baseline.results.map((e) => [e.mouse.slug, e.rank] as const),
  );
  const perMouse: MouseStability[] = ranked.map((mouse, idx) => {
    const sorted = [...totals[idx]].sort((a, b) => a - b);
    return {
      slug: mouse.slug,
      brand: mouse.brand,
      model: mouse.model,
      baselineRank: rankOf.get(mouse.slug) ?? 0,
      top1Prob: top1[idx] / samples,
      top5Prob: top5[idx] / samples,
      totalP10: percentile(sorted, 0.1),
      totalP50: percentile(sorted, 0.5),
      totalP90: percentile(sorted, 0.9),
    };
  });
  perMouse.sort((a, b) => a.baselineRank - b.baselineRank);
  return { samples, seed, perMouse };
}
