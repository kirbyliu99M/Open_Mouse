import { type Polyline, type Vec, distance, polylineLength } from "./geometry";
import { mulberry32 } from "./random";

/** A particle target point. `tone` 1 is a bright (primary stroke) point, 0 a dim one. */
export interface TargetPoint {
  readonly x: number;
  readonly y: number;
  readonly tone: 0 | 1;
}

/**
 * Points along a polyline, about `spacing` apart and exactly evenly spaced
 * (the spacing is rounded so a whole number of steps fits the length).
 *
 * An open polyline starts at its first point and ends at its last, so the end
 * points of a stroke land on the stroke. A closed one starts at its first point
 * and does not repeat it at the end.
 */
export function samplePolyline(
  points: readonly Vec[],
  spacing: number,
  closed = false,
): Vec[] {
  if (!(spacing > 0)) throw new RangeError("spacing must be positive");
  if (points.length === 0) return [];
  const first = points[0]!;
  const path: Vec[] =
    closed && points.length > 1 ? [...points, first] : [...points];
  const length = polylineLength(path);
  if (path.length === 1 || length === 0) return [first];

  const steps = Math.max(1, Math.round(length / spacing));
  const step = length / steps;
  const out: Vec[] = [first];
  let segment = 1;
  let walked = 0; // length up to path[segment - 1]
  for (let n = 1; n < steps; n += 1) {
    const target = n * step;
    while (
      segment < path.length - 1 &&
      walked + distance(path[segment - 1]!, path[segment]!) < target
    ) {
      walked += distance(path[segment - 1]!, path[segment]!);
      segment += 1;
    }
    const a = path[segment - 1]!;
    const b = path[segment]!;
    const along = distance(a, b);
    const t = along === 0 ? 0 : (target - walked) / along;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  if (!closed) out.push(path[path.length - 1]!);
  return out;
}

export interface SamplingStyle {
  /** Spacing, in the polylines' own units, between bright points. */
  readonly brightSpacing: number;
  /** Spacing between dim points. */
  readonly dimSpacing: number;
}

/** Sample every polyline of one tone and tag the points. */
export function sampleStrokes(
  strokes: readonly { readonly polyline: Polyline; readonly tone: 0 | 1 }[],
  style: SamplingStyle,
): TargetPoint[] {
  const out: TargetPoint[] = [];
  for (const { polyline, tone } of strokes) {
    const spacing = tone === 1 ? style.brightSpacing : style.dimSpacing;
    for (const [x, y] of samplePolyline(
      polyline.points,
      spacing,
      polyline.closed,
    )) {
      out.push({ x, y, tone });
    }
  }
  return out;
}

/**
 * Resample a target's points to exactly `count`, keeping their order.
 *
 * - Fewer points wanted: an even pick through the list. The first and the last
 *   point are always kept, so a stroke's end points stay on the shape.
 * - More points wanted: every point is kept and the extras are copies of evenly
 *   picked points, nudged by at most `jitter` units with the seeded generator.
 *   The first copy of each point stays exactly where it was, and the output
 *   still starts and ends on the input's first and last point.
 *
 * Same input, count and seed give the same output.
 */
export function resampleToCount<
  T extends { readonly x: number; readonly y: number },
>(points: readonly T[], count: number, seed: number, jitter = 1): T[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("count must be a non-negative integer");
  }
  if (count === 0) return [];
  if (points.length === 0) throw new RangeError("no points to resample");
  const last = points.length - 1;
  if (count === 1) return [points[0]!];

  const picked: T[] = [];
  if (count <= points.length) {
    for (let i = 0; i < count; i += 1) {
      picked.push(points[Math.round((i * last) / (count - 1))]!);
    }
    return picked;
  }

  const random = mulberry32(seed);
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * last) / (count - 1));
    const point = points[index]!;
    // The first output is the first input point and the last output is the
    // last input point, exactly (with one input point, both are that point);
    // other picks of those points are nudged copies like any other repeat.
    const exact =
      i === 0 || i === count - 1 || (index !== last && !seen.has(index));
    if (exact) {
      seen.add(index);
      picked.push(point);
    } else {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * jitter;
      picked.push({
        ...point,
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius,
      } as T);
    }
  }
  return picked;
}
