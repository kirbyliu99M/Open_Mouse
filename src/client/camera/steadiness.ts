/**
 * Live-loop steadiness check (docs/design/camera-capture-2026-09-25/
 * README.md): "marker corners moved > 1.5% of frame diagonal between
 * samples". Pure — takes the previous and current tracked quads (or
 * `null` when there's no previous sample yet) and the frame diagonal.
 */
import { bestCyclicShift, shiftFour } from "./labelShift";
import type { Quad, Point } from "./quad";
import { CAMERA_CONSTANTS } from "./constants";

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function corners(quad: Quad) {
  return [
    quad.topLeft,
    quad.topRight,
    quad.bottomRight,
    quad.bottomLeft,
  ] as const;
}

/**
 * Largest single-corner movement between two consecutive quads, in the
 * same units as the quads' own coordinates. Corners are matched by where they
 * are, not by label: the paper detector relabels its corners (a cyclic shift)
 * when the paper is held sideways, and read label by label that would count as
 * every corner jumping to the opposite one, an unsteady sample that resets the
 * auto-capture ring when hand shake flips the labels back and forth.
 */
export function computeMaxCornerMovement(
  previous: Quad,
  current: Quad,
): number {
  const before = corners(previous);
  const after = shiftFour(
    corners(current),
    bestCyclicShift(before, corners(current)),
  );
  return Math.max(
    dist(before[0], after[0]),
    dist(before[1], after[1]),
    dist(before[2], after[2]),
    dist(before[3], after[3]),
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
