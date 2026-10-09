import { GRIP_STYLES, type GripStyle } from "../../lib/contracts/fit";
import { GRIP_SOFTNESS } from "./coefficients";

export type GripWeights = Record<GripStyle, number>;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * v1 §2: soft grip weights from r = palmLength / handLength.
 *
 *   w_palm      = σ((r − 0.58) / s)
 *   w_fingertip = σ((0.54 − r) / s)
 *   w_claw      = 1 − w_palm − w_fingertip   (clamped ≥ 0, then renormalised)
 *
 * A stated grip short-circuits to weight 1 on that grip: the user's word is
 * never blended with a prediction. The thresholds are v0's GRIP_PREDICTION
 * boundaries, so the arg-max agrees with v0's hard cut except within a hair of
 * a boundary.
 */
export function gripWeights(
  r: number,
  stated: GripStyle | null = null,
  softness: number = GRIP_SOFTNESS,
): GripWeights {
  if (stated !== null) {
    return {
      palm: stated === "palm" ? 1 : 0,
      claw: stated === "claw" ? 1 : 0,
      fingertip: stated === "fingertip" ? 1 : 0,
    };
  }
  const palm = logistic((r - 0.58) / softness);
  const fingertip = logistic((0.54 - r) / softness);
  const claw = Math.max(0, 1 - palm - fingertip);
  const sum = palm + claw + fingertip;
  return { palm: palm / sum, claw: claw / sum, fingertip: fingertip / sum };
}

/** The grip with the largest weight (ties go to palm, then claw, then fingertip). */
export function argmaxGrip(weights: GripWeights): GripStyle {
  let best: GripStyle = "palm";
  for (const g of GRIP_STYLES) {
    if (weights[g] > weights[best]) best = g;
  }
  return best;
}
