import type { GripStyle } from "../../lib/contracts/fit";
import {
  GRIP_WIDTH_FACTOR,
  HEIGHT_FACTOR,
  LENGTH_FACTOR,
} from "./coefficients";

export interface FitTargets {
  lengthMm: number;
  gripWidthMm: number;
  heightMm: number;
}

/**
 * §2: the "ideal mouse" in numbers, for the hand + the grip actually used to
 * score (stated grip when given, else predicted).
 */
export function computeTargets(
  handLengthMm: number,
  palmWidthMm: number,
  usedGrip: GripStyle,
): FitTargets {
  return {
    lengthMm: handLengthMm * LENGTH_FACTOR[usedGrip],
    gripWidthMm: palmWidthMm * GRIP_WIDTH_FACTOR,
    heightMm: handLengthMm * HEIGHT_FACTOR[usedGrip],
  };
}
