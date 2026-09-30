/**
 * The green outline that joins the four corner dots once all are found
 * (EasyCorners.tsx). Each edge is one 1 px wide element stretched and turned
 * by a transform, so it glides with the dots instead of stepping with each
 * sample. Pure, so the one thing that can go wrong with it, the angle, is
 * tested on its own.
 */
import type { Point } from "./quad";

/**
 * The four edges as [from, to] indices into (TL, TR, BR, BL), every one
 * pointing right or down for an upright sheet: top TL to TR, right TR to BR,
 * bottom BL to BR, left TL to BL. `Math.atan2` flips between +π and -π for a
 * direction that points left and is nearly level, so an edge drawn BR to BL
 * would spin a full turn through its 140 ms transition whenever the paper's
 * bottom edge crossed level. No edge here points left.
 */
export const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [3, 2],
  [0, 3],
];

/** The direction of the edge from `a` to `b`, in radians. */
export function edgeAngle(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** The transform that puts a 1 px wide element on the edge from `a` to `b`. */
export function edgeTransform(a: Point, b: Point): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return `translate3d(${a.x}px, ${a.y}px, 0) rotate(${edgeAngle(a, b)}rad) scaleX(${length})`;
}
