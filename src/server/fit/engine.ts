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
import { scoreFitV3 } from "./score-v3-candidate";
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
 * Runs the named engine. `scoreFitDefault` passes `resolveFitEngine()`; tests pass
 * "v1" or "v2" to exercise a candidate path without flipping the switch.
 *
 * "v3" is the fit-v3.0 candidate (score-v3-candidate.ts), on the same terms.
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
    case "v3":
      return scoreFitV3(
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
 * for the grip the response used: v0 stores `UNKNOWN_PRIOR_SCORE`; v1, v2 and v3
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
    case "v2":
    case "v3": {
      const priors = computePriors(catalogue);
      return (subscore, grip) => priors[subscore][grip];
    }
    default:
      return unknownEngine(engine);
  }
}

/** The values `FIT_ENGINE` may take. "v0" is deliberately not one of them. */
const FIT_ENGINE_VALUES = [
  "v1",
  "v2",
  "v3",
] as const satisfies readonly EngineId[];

/**
 * The one place that decides which engine the routes run. Server-side only
 * (never `NEXT_PUBLIC_*`: that is baked in at build time, and a rollback has
 * to be a runtime change). `FIT_ENGINE` is read at request time; unset, empty
 * or any value other than "v1", "v2" or "v3" falls back to `DEFAULT_ENGINE`,
 * which is "v1". Every consumer asks this function, so the fit, the stored
 * null scores, the similar-hands exclusion rule and the feedback snapshot
 * cannot disagree. 未拍板 (candidate): flipping it in production is Kirby's
 * call.
 */
export function resolveFitEngine(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EngineId {
  const raw = env.FIT_ENGINE?.trim();
  const named = FIT_ENGINE_VALUES.find((v) => v === raw);
  return named ?? DEFAULT_ENGINE;
}

/**
 * The engine the fit route runs: `resolveFitEngine()` picks it (the
 * `FIT_ENGINE` environment variable, "v1" when unset or invalid). `scoreFit`
 * is v0, unchanged.
 */
export function scoreFitDefault(
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
): Omit<FitResponse, "scanId"> {
  return scoreWithEngine(
    resolveFitEngine(),
    measurements,
    catalogue,
    prefs,
    hand,
  );
}
