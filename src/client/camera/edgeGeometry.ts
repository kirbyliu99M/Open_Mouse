/**
 * The green outline that joins the four corner dots once all are found
 * (EasyCorners.tsx). Each edge is one 1 px element laid on the segment by a
 * transform, so it glides with the dots instead of stepping with each sample.
 * Pure, so the one thing that can go wrong with it, the angle, is tested on
 * its own and through the real paper detector.
 *
 * Nothing here depends on which way a corner is labelled. `detectPaperQuad`
 * relabels its corners (a cyclic shift) when the paper is held sideways, so
 * the order that reaches the screen is not always top-left, top-right,
 * bottom-right, bottom-left. An edge is therefore drawn as a CENTRED
 * segment: a line has no direction, so its angle is only meaningful modulo π,
 * and each new angle is taken as the equivalent θ + kπ nearest to the one
 * before it. A rotation transition then never sweeps more than π/2, however
 * the corners are labelled or wherever the angle crosses ±π.
 */
import type { Four } from "./labelShift";
import type { Point } from "./quad";

/**
 * The four sides as [from, to] indices into the corners, in label order
 * (each corner to the next). Which end is "from" does not matter.
 */
export const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

/**
 * The angle equivalent to `angle` modulo π that lies nearest to `previous`
 * (within π/2 of it). With no previous angle, the one in (-π/2, π/2].
 * A previous angle that is not a finite number (`null`, or a NaN or Infinity
 * that came from a bad sample) counts as none: carried on, it would make every
 * angle after it NaN as well and the outline would never come back.
 */
export function unwrapAngle(angle: number, previous: number | null): number {
  const reference =
    typeof previous === "number" && Number.isFinite(previous) ? previous : 0;
  // Half a turn either way is a tie; going round the lower way keeps the
  // result in (-pi/2, pi/2] when there is no previous angle.
  return angle - Math.PI * Math.ceil((angle - reference) / Math.PI - 0.5);
}

export interface EdgePlacement {
  /** The middle of the segment. */
  readonly centre: Point;
  readonly length: number;
  /** Radians, unwrapped against the previous sample's angle for this edge. */
  readonly angle: number;
}

/** The segment from `a` to `b`, with its angle unwrapped against `previousAngle`. */
export function placeEdge(
  a: Point,
  b: Point,
  previousAngle: number | null,
): EdgePlacement {
  const raw = Math.atan2(b.y - a.y, b.x - a.x);
  return {
    centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    length: Math.hypot(b.x - a.x, b.y - a.y),
    angle: unwrapAngle(raw, previousAngle),
  };
}

/**
 * All four sides of the quad drawn through `points`: exactly four (a quad), in
 * label order. `previousAngles` is the state (one angle per edge, `null` before
 * the first sample); `angles` is the state to pass in next time.
 */
export function placeEdges(
  points: Four<Point>,
  previousAngles: readonly (number | null)[],
): { placements: EdgePlacement[]; angles: number[] } {
  // The type says four; a caller that got round it (a cast, an untyped
  // array) would otherwise get an edge drawn to `undefined`.
  if (points.length !== 4)
    throw new RangeError(
      `placeEdges needs exactly four points, got ${points.length}`,
    );
  const placements = EDGES.map(([from, to], i) =>
    placeEdge(points[from], points[to], previousAngles[i] ?? null),
  );
  return { placements, angles: placements.map((p) => p.angle) };
}

/**
 * The transform that lays a 1 px wide, centred element on the edge: its middle
 * goes to the segment's middle, it turns to the edge's angle and stretches to
 * its length (`transform-origin` is the element's centre; see `.easyEdge`).
 */
export function edgeTransform(edge: EdgePlacement): string {
  return `translate3d(${edge.centre.x}px, ${edge.centre.y}px, 0) rotate(${edge.angle}rad) scaleX(${edge.length})`;
}
