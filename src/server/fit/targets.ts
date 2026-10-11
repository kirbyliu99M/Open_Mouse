import type { GripStyle } from "../../lib/contracts/fit";
import type { PalmThicknessLevel } from "../../lib/contracts/measurement";
import {
  GRIP_WIDTH_FACTOR,
  HEIGHT_FACTOR,
  LENGTH_FACTOR,
  THICKNESS_HEIGHT_SHIFT_MM,
} from "./coefficients";

export interface FitTargets {
  lengthMm: number;
  gripWidthMm: number;
  heightMm: number;
}

/**
 * §2: the "ideal mouse" in numbers, for the hand + the grip actually used to
 * score (stated grip when given, else predicted).
 *
 * `palmThickness` (v1 only, candidate, uncalibrated) shifts the height target
 * by `THICKNESS_HEIGHT_SHIFT_MM[level]`; undefined adds nothing at all, so the
 * result is exactly what it was before the argument existed. v0 never passes it.
 */
export function computeTargets(
  handLengthMm: number,
  palmWidthMm: number,
  usedGrip: GripStyle,
  palmThickness?: PalmThicknessLevel,
): FitTargets {
  return {
    lengthMm: handLengthMm * LENGTH_FACTOR[usedGrip],
    gripWidthMm: palmWidthMm * GRIP_WIDTH_FACTOR,
    heightMm:
      handLengthMm * HEIGHT_FACTOR[usedGrip] +
      (palmThickness === undefined
        ? 0
        : THICKNESS_HEIGHT_SHIFT_MM[palmThickness]),
  };
}
