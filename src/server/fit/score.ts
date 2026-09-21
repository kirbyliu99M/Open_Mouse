import type { HandMeasurements } from "../../lib/contracts/measurement";
import {
  SUBSCORES,
  type FitEntry,
  type FitPreferences,
  type FitResponse,
  type Subscore,
} from "../../lib/contracts/fit";
import { ENGINE_VERSION } from "./coefficients";
import { excludeReason } from "./exclusions";
import { predictGrip } from "./grip";
import {
  scoreFrontFlare,
  scoreGripWidth,
  scoreHeightHump,
  scoreLength,
  scoreThumb,
  scoreWeight,
} from "./subscores";
import { computeTargets } from "./targets";
import type { CatalogueMouse, SubscoreResult } from "./types";

export type { CatalogueMouse } from "./types";
export { ENGINE_VERSION } from "./coefficients";

/**
 * Pure scoring engine: measurements + catalogue + preferences + hand →
 * everything `fitResponseSchema` needs except `scanId` (the route adds that,
 * once #11 lands). Never touches the network, the DB, or Gemini.
 */
export function scoreFit(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
): Omit<FitResponse, "scanId"> {
  const predicted = predictGrip(measurements.handLengthMm, measurements.palmLengthMm);
  // §1: "Stated grip always overrides predicted." Stated grip travels as a
  // user preference (fitPreferencesSchema.gripStyle) — there is no separate
  // gripStyleStated parameter on scoreFit itself.
  const stated = prefs.gripStyle ?? null;
  const used = stated ?? predicted;
  const targets = computeTargets(measurements.handLengthMm, measurements.palmWidthMm, used);

  const excluded: FitResponse["excluded"] = [];
  const entries: Omit<FitEntry, "rank">[] = [];

  for (const mouse of catalogue) {
    const reason = excludeReason(mouse, hand, prefs);
    if (reason) {
      excluded.push({ slug: mouse.slug, reason });
      continue;
    }

    const subscores: Record<Subscore, SubscoreResult> = {
      length: scoreLength(mouse, targets.lengthMm),
      gripWidth: scoreGripWidth(mouse, targets.gripWidthMm),
      heightHump: scoreHeightHump(mouse, targets.heightMm, used),
      frontFlare: scoreFrontFlare(mouse, used),
      thumb: scoreThumb(mouse, used),
      weight: scoreWeight(mouse, prefs),
    };

    let weightedScoreSum = 0;
    let scoreWeightSum = 0;
    let confidenceNumerator = 0;
    let confidenceDenominator = 0;

    for (const key of SUBSCORES) {
      const s = subscores[key];
      // §4: weight's "no_preference" case is structurally inapplicable to
      // this scan (the user gave no preference), not a data gap — it is
      // excluded from confidence's denominator entirely rather than
      // counted as missing.
      const applicable = s.reason.code !== "no_preference";
      if (applicable) {
        confidenceDenominator += s.weight;
        if (s.reason.code !== "descriptor_unknown") {
          confidenceNumerator += s.weight;
        }
      }
      if (s.score !== null) {
        weightedScoreSum += s.score * s.weight;
        scoreWeightSum += s.weight;
      }
    }

    const total = scoreWeightSum > 0 ? Math.round(weightedScoreSum / scoreWeightSum) : 0;
    const confidence = confidenceDenominator > 0 ? confidenceNumerator / confidenceDenominator : 0;

    entries.push({
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
      total,
      confidence,
      subscores,
    });
  }

  // §6: total desc, tie-break confidence (desc) then model name (asc).
  entries.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.mouse.model.localeCompare(b.mouse.model);
  });

  const results: FitEntry[] = entries.map((entry, i) => ({ ...entry, rank: i + 1 }));

  return {
    engineVersion: ENGINE_VERSION,
    gripStyle: { stated, predicted, used },
    targets,
    excluded,
    results,
  };
}
