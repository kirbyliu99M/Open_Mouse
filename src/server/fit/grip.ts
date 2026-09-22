import type { GripStyle } from "../../lib/contracts/fit";
import { GRIP_PREDICTION } from "./coefficients";

/**
 * §1: r = palmLength / handLength. r ≥ 0.58 → palm, 0.54–0.58 → claw,
 * < 0.54 → fingertip. Callers apply "stated grip always overrides
 * predicted" themselves — this function only ever predicts.
 */
export function predictGrip(
  handLengthMm: number,
  palmLengthMm: number,
): GripStyle {
  const r = palmLengthMm / handLengthMm;
  if (r >= GRIP_PREDICTION.palmAtOrAbove) return "palm";
  if (r >= GRIP_PREDICTION.clawAtOrAbove) return "claw";
  return "fingertip";
}
