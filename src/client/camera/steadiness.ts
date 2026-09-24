/**
 * Live-loop steadiness check (docs/design/camera-capture-2026-09-25/
 * README.md): "marker corners moved > 1.5% of frame diagonal between
 * samples". Pure — takes the previous and current tracked quads (or
 * `null` when there's no previous sample yet) and the frame diagonal.
 */
import type { Quad, Point } from "./quad";
import { CAMERA_CONSTANTS } from "./constants";

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Largest single-corner movement between two consecutive quads, in the
 * same units as the quads' own coordinates.
 */
export function computeMaxCornerMovement(previous: Quad, current: Quad): number {
  return Math.max(
    dist(previous.topLeft, current.topLeft),
    dist(previous.topRight, current.topRight),
    dist(previous.bottomRight, current.bottomRight),
    dist(previous.bottomLeft, current.bottomLeft),
  );
}

/**
 * True when the sheet is being held steady: either there is no previous
 * sample to compare against (first frame — nothing to call unsteady yet),
 * or every tracked corner moved no more than
 * `maxCornerMovementFraction * frameDiagonal` since the last sample.
 */
export function isSteady(
  previous: Quad | null,
  current: Quad,
  frameDiagonal: number,
  maxCornerMovementFraction: number = CAMERA_CONSTANTS.steadiness
    .maxCornerMovementFraction,
): boolean {
  if (previous === null) return true;
  if (frameDiagonal <= 0) {
    throw new RangeError(
      `isSteady needs a positive frameDiagonal, got ${frameDiagonal}.`,
    );
  }
  const movement = computeMaxCornerMovement(previous, current);
  return movement <= maxCornerMovementFraction * frameDiagonal;
}
