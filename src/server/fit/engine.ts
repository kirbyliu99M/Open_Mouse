import type {
  FitPreferences,
  FitResponse,
  GripStyle,
  Subscore,
} from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import {
  DEFAULT_ENGINE,
  UNKNOWN_PRIOR_SCORE,
  type EngineId,
} from "./coefficients";
import { computePriors } from "./priors";
import { scoreFit } from "./score";
import { scoreFitV1 } from "./score-v1";
import type { CatalogueMouse } from "./types";

/**
 * Runs the named engine. `scoreFitDefault` passes `DEFAULT_ENGINE`; tests pass
 * "v1" to exercise the candidate path without flipping the switch.
 */
export function scoreWithEngine(
  engine: EngineId,
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
): Omit<FitResponse, "scanId"> {
  if (engine === "v1") {
    return scoreFitV1(
      measurements,
      catalogue,
      prefs,
      hand,
      computePriors(catalogue),
    );
  }
  return scoreFit(measurements, catalogue, prefs, hand);
}

/**
 * What a null sub-score is stored as in `fit_results` under the named engine,
 * for the grip the response used: v0 stores `UNKNOWN_PRIOR_SCORE`; v1 stores
 * the catalogue-mean prior its total used.
 */
export function storedNullScore(
  engine: EngineId,
  catalogue: readonly CatalogueMouse[],
): (subscore: Subscore, grip: GripStyle) => number {
  if (engine === "v1") {
    const priors = computePriors(catalogue);
    return (subscore, grip) => priors[subscore][grip];
  }
  return () => UNKNOWN_PRIOR_SCORE;
}

/**
 * The engine the fit route runs: `DEFAULT_ENGINE` in coefficients.ts picks it,
 * and that constant is the single switch. It stays "v0" until Kirby approves
 * the v1 candidate's before/after, so this is v0, byte for byte, today.
 */
export function scoreFitDefault(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
): Omit<FitResponse, "scanId"> {
  return scoreWithEngine(DEFAULT_ENGINE, measurements, catalogue, prefs, hand);
}
