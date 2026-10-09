import { shareOut } from "./dense";
import { type Polyline, type Vec, distance } from "./geometry";
import { mulberry32 } from "./random";
import type { StrokeRun, TargetPoint } from "./sampling";
import { parsePathData } from "./svg-path";

/**
 * The Palmate mark of the home page hero (未拍板, candidate: Kirby looks at the
 * animation): a hand drawn as four lines, which replaces the placeholder
 * mouse-and-ruler of Home v3. The static image (public/images/hero-palmate-mark.svg)
 * draws `PALMATE_PATH` as it is; the particle target is the same path sampled
 * as a cloud of points a little wider than the line, plus a few stray ones
 * round it. Both are made from this file, so they agree.
 */

/** The hand, as the logo's own drawing wrote it (viewBox units). Four subpaths: the palm with the thumb, then three fingers. Do not edit it by eye: the SVG and the target both read it. */
export const PALMATE_PATH =
  "M38 48c0 4 4 6 7 4 3-2 3-8-1-11-6-4-16 1-18 11-2 12 10 20 22 20 12 0 22-8 24-22 1-12-4-24-8-28-2-2-5-1-5 2 0 8 4 20 3 30m-4-16c0-12-2-22-6-24-2-2-5-1-6 2-2 8 0 20 0 30m-2-14c-1-8-3-14-7-16-2-2-5-1-6 2-2 8 1 20 3 28m-4-10c-2-6-5-12-8-12-3 0-4 3-3 8 1 8 3 16 5 22";

/**
 * The static image's viewBox: the path's bounding box (x 18.6 to 72.1, y 13.0
 * to 72.0) with about 5 units of room all round, for the particles that sit a
 * little off the line and for the stroke's width.
 */
export const LOGO_VIEWBOX = { x: 13, y: 8, width: 65, height: 69 } as const;

/** Stage px per viewBox unit: the target's own coordinates are the viewBox's, from its corner, times this (so 0.1 px, the precision of the JSON, is 0.03 of a unit). */
export const LOGO_SCALE = 3;

/** The logo's box in stage px: the viewBox scaled. The target's points are inside it, and the stage fits the static image's rect to it. */
export const LOGO_BOX = { width: 195, height: 207 } as const;

/** The stroke of the static image, in viewBox units, and its colour. */
export const LOGO_STROKE = { color: "#7FA8FF", width: 2 } as const;

/** The seed of the logo's cloud. Fixed on its own: the logo does not change with the generator's seed (the hand's fill does). */
export const LOGO_SEED = 20261010;

/**
 * How the cloud is made. All lengths are viewBox units unless they say px.
 *
 * - `particles` points lie along the path, which is 349 units long. They sit at
 *   `particles / (1 + doubled)` places an even step apart (about 0.73 units),
 *   and `doubled` of those places carry two points instead of one. (Every
 *   0.55 units with one or two points each would be 634 places and well over
 *   600 points; this keeps the count at 600 and the one-or-two mix.)
 * - Each point is moved across the line by a bell-shaped amount, `spread` units
 *   wide (one standard deviation) and never past `maxSpread`, so the line has
 *   a width of about 4 to 5 units and no hard edge.
 * - `brightShare` of the points are the bright tone, the others the dim one.
 * - `ambient` more points are scattered round the mark, in a frame that reaches
 *   `ambientReach` of the box's width and height beyond it, no nearer than
 *   `ambientHole` px to the box and `ambientGap` px to each other.
 */
export const LOGO_SAMPLING = {
  particles: 600,
  doubled: 0.26,
  spread: 0.8,
  maxSpread: 2.4,
  brightShare: 0.5,
  ambient: 24,
  ambientReach: { x: 0.5, y: 0.25 },
  ambientHole: 12,
  ambientGap: 30,
} as const;

/**
 * Whether a logo point (in its own px, at any budget) belongs to the mark
 * rather than to the strays round it. The mark's points are inside `LOGO_BOX`,
 * at least 7.8 px from its edges (5 units of room less the cloud's 2.4), and a
 * stray is at least `ambientHole` px outside it. A budget moves a point by a
 * pixel at most (a sparse top-up nudges a copy by up to 1 px, a dense walk by
 * 0.75), so the box widened by half the hole tells the two apart at every
 * budget.
 */
export function inLogoMark(p: { readonly x: number; readonly y: number }) {
  const margin = LOGO_SAMPLING.ambientHole / 2;
  return (
    p.x > -margin &&
    p.x < LOGO_BOX.width + margin &&
    p.y > -margin &&
    p.y < LOGO_BOX.height + margin
  );
}

/** The mark's subpaths as polylines in viewBox units (the curves flattened to about 1 unit). */
export function logoPolylines(): Polyline[] {
  return parsePathData(PALMATE_PATH);
}

interface Walk {
  readonly points: readonly Vec[];
  /** Length up to each point. */
  readonly along: readonly number[];
  readonly length: number;
}

function walkOf({ points }: Polyline): Walk {
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(along[i - 1]! + distance(points[i - 1]!, points[i]!));
  }
  return { points, along, length: along[along.length - 1]! };
}

/** The point at length `u` along the walk, and the unit normal of the segment it is on. */
function placeAt(walk: Walk, u: number): { at: Vec; normal: Vec } {
  const { points, along } = walk;
  let low = 1;
  let high = points.length - 1;
  const target = Math.min(Math.max(u, 0), walk.length);
  while (low < high) {
    const mid = (low + high) >> 1;
    if (along[mid]! < target) low = mid + 1;
    else high = mid;
  }
  const a = points[low - 1]!;
  const b = points[low]!;
  const size = along[low]! - along[low - 1]!;
  const t = size === 0 ? 0 : (target - along[low - 1]!) / size;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return {
    at: [a[0] + dx * t, a[1] + dy * t],
    normal: [-dy / length, dx / length],
  };
}

/**
 * The logo's particle target in stage px, inside `LOGO_BOX`: `particles` points
 * along the four subpaths (one run each, in path order) and then `ambient`
 * single stray points (a run of one each). Pure and seeded by `LOGO_SEED`: the
 * same points every time, on every machine that rounds `Math.log` and `cos`
 * alike (the committed JSON is checked against a fresh run by a test).
 */
export function sampleLogoPoints(): {
  points: TargetPoint[];
  runs: StrokeRun[];
} {
  const s = LOGO_SAMPLING;
  const random = mulberry32(LOGO_SEED);
  const gaussian = () => {
    const radius = Math.sqrt(-2 * Math.log(1 - random()));
    const g = radius * Math.cos(2 * Math.PI * random());
    return Math.max(-s.maxSpread, Math.min(s.maxSpread, g * s.spread));
  };
  const toBox = ([x, y]: Vec): Vec => [
    (x - LOGO_VIEWBOX.x) * LOGO_SCALE,
    (y - LOGO_VIEWBOX.y) * LOGO_SCALE,
  ];

  const walks = logoPolylines().map(walkOf);
  // Each line gets its share of the points by its length (exactly `particles`
  // in all).
  const pointsOf = shareOut(
    walks.map((w) => w.length),
    s.particles,
  );

  const points: TargetPoint[] = [];
  const runs: StrokeRun[] = [];
  walks.forEach((walk, w) => {
    const start = points.length;
    // The line's places, an even step apart, and which of them carry two
    // points: exactly `pointsOf[w] - count` of them, picked by a seeded shuffle.
    const count = Math.round(pointsOf[w]! / (1 + s.doubled));
    const step = walk.length / count;
    const doubled = new Uint8Array(count);
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i -= 1) {
      const k = Math.floor(random() * (i + 1));
      const held = order[i]!;
      order[i] = order[k]!;
      order[k] = held;
    }
    for (let i = 0; i < pointsOf[w]! - count; i += 1) doubled[order[i]!] = 1;
    for (let k = 0; k < count; k += 1) {
      const pieces = doubled[k]! + 1;
      for (let j = 0; j < pieces; j += 1) {
        // A place with two points puts each a little either side of it along the line.
        const u = (k + 0.5 + (pieces === 1 ? 0 : random() - 0.5)) * step;
        const { at, normal } = placeAt(walk, u);
        const across = gaussian();
        const [x, y] = toBox([
          at[0] + normal[0] * across,
          at[1] + normal[1] * across,
        ]);
        points.push({ x, y, tone: random() < s.brightShare ? 1 : 0 });
      }
    }
    runs.push({ start, count: points.length - start, closed: false });
  });

  // The strays: outside the box (and a hole round it), no two close together.
  const reachX = s.ambientReach.x * LOGO_BOX.width;
  const reachY = s.ambientReach.y * LOGO_BOX.height;
  const strays: Vec[] = [];
  for (let tries = 0; strays.length < s.ambient; tries += 1) {
    if (tries > 20000) throw new Error("the logo's strays do not fit");
    const x = -reachX + random() * (LOGO_BOX.width + 2 * reachX);
    const y = -reachY + random() * (LOGO_BOX.height + 2 * reachY);
    const inHole =
      x > -s.ambientHole &&
      x < LOGO_BOX.width + s.ambientHole &&
      y > -s.ambientHole &&
      y < LOGO_BOX.height + s.ambientHole;
    if (inHole) continue;
    if (strays.some((o) => distance(o, [x, y]) < s.ambientGap)) continue;
    strays.push([x, y]);
  }
  for (const [x, y] of strays) {
    runs.push({ start: points.length, count: 1, closed: false });
    points.push({ x, y, tone: 0 });
  }
  return { points, runs };
}
