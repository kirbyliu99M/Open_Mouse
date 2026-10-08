import type { FitPreferences, FitResponse } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { DEFAULT_ENGINE } from "./coefficients";
import { computePriors } from "./priors";
import { scoreFit } from "./score";
import { scoreFitV1 } from "./score-v1";
import type { CatalogueMouse } from "./types";

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
  if (DEFAULT_ENGINE === "v1") {
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
