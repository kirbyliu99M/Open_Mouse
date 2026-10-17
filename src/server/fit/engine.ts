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
import { scoreFitV2 } from "./score-v2-candidate";
import type { CatalogueMouse } from "./types";

/**
 * Exhaustiveness guard: an `EngineId` without a case is a type error here, and
 * an id that is not an `EngineId` at all (a bad cast) throws instead of
 * silently running another engine.
 */
function unknownEngine(engine: never): never {
  throw new Error(`Unknown fit engine: ${String(engine)}`);
}

/**
 * Runs the named engine. `scoreFitDefault` passes `DEFAULT_ENGINE`; tests pass
 * "v1" or "v2" to exercise a candidate path without flipping the switch.
 *
 * "v2" is the fit-v2.0 candidate (score-v2-candidate.ts) with its default
 * options, for tests and explicit opt-in only. It does not attach rank
 * stability (`attachRankStability` is a separate step).
 */
export function scoreWithEngine(
  engine: EngineId,
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
): Omit<FitResponse, "scanId"> {
  switch (engine) {
    case "v0":
      return scoreFit(measurements, catalogue, prefs, hand);
    case "v1":
      return scoreFitV1(
        measurements,
        catalogue,
        prefs,
        hand,
        computePriors(catalogue),
      );
    case "v2":
      return scoreFitV2(
        measurements,
        catalogue,
        prefs,
        hand,
        computePriors(catalogue),
      );
    default:
      return unknownEngine(engine);
  }
}

/**
 * What a null sub-score is stored as in `fit_results` under the named engine,
 * for the grip the response used: v0 stores `UNKNOWN_PRIOR_SCORE`; v1 and v2
 * store the catalogue-mean prior their total used.
 */
export function storedNullScore(
  engine: EngineId,
  catalogue: readonly CatalogueMouse[],
): (subscore: Subscore, grip: GripStyle) => number {
  switch (engine) {
    case "v0":
      return () => UNKNOWN_PRIOR_SCORE;
    case "v1":
    case "v2": {
      const priors = computePriors(catalogue);
      return (subscore, grip) => priors[subscore][grip];
    }
    default:
      return unknownEngine(engine);
  }
}

/**
 * The engine the fit route runs: `DEFAULT_ENGINE` in coefficients.ts picks it,
 * and that constant is the single switch. It is "v1" since Kirby's decision of
 * 2026-10-10 (v1 is still a candidate); `scoreFit` is v0, unchanged.
 */
export function scoreFitDefault(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
): Omit<FitResponse, "scanId"> {
  return scoreWithEngine(DEFAULT_ENGINE, measurements, catalogue, prefs, hand);
}
