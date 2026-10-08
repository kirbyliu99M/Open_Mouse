import {
  classifyHandType,
  handTypeStatsFromCatalogue,
} from "../../lib/fit/handType";
import {
  GRIP_STYLES,
  SUBSCORES,
  type FitEntry,
  type FitPreferences,
  type FitResponse,
  type GripStyle,
  type Subscore,
} from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { ENGINE_VERSION_V1 } from "./coefficients";
import { excludeReasonV1, type ExclusionOptions } from "./exclusions-v1";
import { argmaxGrip, gripWeights } from "./grip-weights";
import type { Priors } from "./priors";
import {
  scoreFrontFlare,
  scoreGripWidthV1,
  scoreHeightHumpV1,
  scoreLengthV1,
  scoreThumb,
  scoreWeightV1,
} from "./subscores-v1";
import { computeTargets, type FitTargets } from "./targets";
import type { CatalogueMouse, SubscoreResult } from "./types";

export { ENGINE_VERSION_V1 } from "./coefficients";

/** Two unrounded totals closer than this are a tie (float noise, not a difference). */
const TIE_EPSILON = 1e-9;

type Subscores = Record<Subscore, SubscoreResult>;

/** What the v1 ranking order reads from one scored mouse. */
export interface RankKey {
  /** The unrounded blended total. */
  totalRaw: number;
  confidence: number;
  /** |mouse length - target length| for the grip used, in mm. */
  lengthAbsDelta: number;
  model: string;
}

/**
 * v1 section 6 order: unrounded total desc, confidence desc, |length delta|
 * asc, model asc. Totals within float noise of each other are a tie.
 */
export function compareRankKeys(a: RankKey, b: RankKey): number {
  if (Math.abs(b.totalRaw - a.totalRaw) > TIE_EPSILON) {
    return b.totalRaw - a.totalRaw;
  }
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (a.lengthAbsDelta !== b.lengthAbsDelta) {
    return a.lengthAbsDelta - b.lengthAbsDelta;
  }
  return a.model.localeCompare(b.model);
}

function subscoresFor(
  mouse: CatalogueMouse,
  targets: FitTargets,
  grip: GripStyle,
  prefs: FitPreferences,
): Subscores {
  return {
    length: scoreLengthV1(mouse, targets.lengthMm, grip),
    gripWidth: scoreGripWidthV1(mouse, targets.gripWidthMm),
    heightHump: scoreHeightHumpV1(mouse, targets.heightMm, grip),
    frontFlare: scoreFrontFlare(mouse, grip),
    thumb: scoreThumb(mouse, grip),
    weight: scoreWeightV1(mouse, prefs),
  };
}

/** Weighted mean over applicable sub-scores for one grip, null scores taking the prior. */
function totalFor(subscores: Subscores, priors: Priors, grip: GripStyle) {
  let weightedScoreSum = 0;
  let applicableWeightSum = 0;
  let confidenceNumerator = 0;
  for (const key of SUBSCORES) {
    const s = subscores[key];
    // "No preference" is not a data gap: the sub-score leaves the total and
    // the confidence denominator, exactly as in v0.
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

/** The contract wants whole-number sub-scores; the engine keeps them unrounded inside. */
function displayed(subscores: Subscores): FitEntry["subscores"] {
  const out = {} as FitEntry["subscores"];
  for (const key of SUBSCORES) {
    const s = subscores[key];
    out[key] = {
      score: s.score === null ? null : Math.round(s.score),
      weight: s.weight,
      reason: s.reason,
    };
  }
  return out;
}

/**
 * The fit-v1 candidate engine (docs/fit-algorithm.md). Same inputs as
 * `scoreFit` plus the precomputed `priors` (`computePriors(catalogue)`), so it
 * stays a pure function of its arguments. `scoreFit` (v0) is untouched and
 * stays the default engine.
 *
 * Differences from v0, in short: the grip is a soft blend when none is stated,
 * so a mouse's total is Σ_g w_g · total_g and is continuous in palm length;
 * scores are unrounded inside and widened by measurement noise (σ_eff); a
 * missing descriptor contributes the catalogue-mean prior; trackballs are
 * excluded; ties break on confidence, then |length Δ|, then model.
 *
 * Displayed sub-scores and reasons are those of the grip used (stated, else
 * the arg-max of the weights); only `total` is blended.
 */
export function scoreFitV1(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
  priors: Priors,
  options: ExclusionOptions = {},
): Omit<FitResponse, "scanId"> {
  const r = measurements.palmLengthMm / measurements.handLengthMm;
  const predicted = argmaxGrip(gripWeights(r));
  const stated = prefs.gripStyle ?? null;
  const used = stated ?? predicted;
  const weights = gripWeights(r, stated);
  const gripsInPlay = GRIP_STYLES.filter((g) => weights[g] > 0);

  const targetsByGrip = Object.fromEntries(
    GRIP_STYLES.map((g) => [
      g,
      computeTargets(measurements.handLengthMm, measurements.palmWidthMm, g),
    ]),
  ) as Record<GripStyle, FitTargets>;
  const targets = targetsByGrip[used];

  const excluded: FitResponse["excluded"] = [];
  const scored: {
    entry: Omit<FitEntry, "rank">;
    totalRaw: number;
    lengthAbsDelta: number;
  }[] = [];

  for (const mouse of catalogue) {
    const reason = excludeReasonV1(mouse, hand, prefs, options);
    if (reason) {
      excluded.push({
        slug: mouse.slug,
        brand: mouse.brand,
        model: mouse.model,
        reason,
      });
      continue;
    }

    let totalRaw = 0;
    let usedSubscores: Subscores | null = null;
    let usedConfidence = 0;
    for (const g of gripsInPlay) {
      const subs = subscoresFor(mouse, targetsByGrip[g], g, prefs);
      const t = totalFor(subs, priors, g);
      totalRaw += weights[g] * t.total;
      if (g === used) {
        usedSubscores = subs;
        usedConfidence = t.confidence;
      }
    }
    // `used` always has weight > 0: stated has weight 1, and the arg-max of
    // the soft weights is the largest of three weights summing to 1.
    const shown = usedSubscores as Subscores;

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
        total: Math.round(totalRaw),
        confidence: usedConfidence,
        subscores: displayed(shown),
      },
      totalRaw,
      lengthAbsDelta: Math.abs(shown.length.reason.params.deltaMm ?? 0),
    });
  }

  // v1 §6: unrounded total desc, then confidence desc, then |length Δ| asc,
  // then model name asc.
  scored.sort((a, b) =>
    compareRankKeys(
      { ...a, confidence: a.entry.confidence, model: a.entry.mouse.model },
      { ...b, confidence: b.entry.confidence, model: b.entry.mouse.model },
    ),
  );

  const results: FitEntry[] = scored.map(({ entry }, i) => ({
    ...entry,
    rank: i + 1,
  }));

  const handTypeStats = handTypeStatsFromCatalogue(catalogue);

  return {
    engineVersion: ENGINE_VERSION_V1,
    hand,
    gripStyle: {
      stated,
      predicted,
      used,
      // The contract documents `weights` as the blend used when no grip was stated.
      ...(stated === null ? { weights } : {}),
    },
    ...(handTypeStats
      ? { handType: classifyHandType(targets, used, handTypeStats) }
      : {}),
    targets,
    excluded,
    results,
  };
}
