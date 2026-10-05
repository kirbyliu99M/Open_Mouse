import { type Vec, distance } from "./geometry";
import { FINGER_CHAINS, LANDMARKS_MM, STAGE_SCALE } from "./template-hand";

/**
 * The outline around the template hand (Home v3.1; the Pencil demo of
 * 2026-10-05, frames "Outline finger", "Outline palm" and their "Inner"
 * twins). It is the union of five finger shapes, each a round-capped stroke
 * along a finger's landmark chain, and the palm: a polygon filled and stroked
 * with round joins down to a flat wrist base, so the wrist is a rounded flat
 * base and not a sharp point. The drawing keeps only the union's edge, about
 * 1 px thick.
 *
 * Pure geometry: no canvas here. stage-render.ts draws it once per size, on an
 * offscreen layer, from `OUTLINE_FINGERS` and `OUTLINE_PALM`, and the tests
 * hold the same shapes to "every particle of the hand is inside".
 *
 * Every size comes from the demo, measured in its pixels (an A4 sheet 303 px
 * wide, the 390 px storyboard) and turned into millimetres on the template
 * hand's A4 sheet, so the outline scales with the hand. It is an illustration,
 * like the hand itself: it is NOT a user's hand and NOT a measurement.
 */

/** The demo's A4 sheet is 303 px wide: this many of its pixels to a millimetre of the template. */
export const DEMO_PX_PER_MM = 303 / 210;
/** The demo's stage scale: the A4 sheet is 340 stage px wide in the target space, 303 px in the demo. */
export const DEMO_STAGE_SCALE = 303 / 340;
/** Where the demo's A4 sheet's top-left corner is, in its own pixels. */
const DEMO_ORIGIN: Vec = [39, 9];

const demoMm = (px: number) => px / DEMO_PX_PER_MM;
const fromDemo = ([x, y]: Vec): Vec => [
  demoMm(x - DEMO_ORIGIN[0]),
  demoMm(y - DEMO_ORIGIN[1]),
];

/** The edge's colour and its opacity: the skeleton's alpha, so the two fade together. Quieter than the landmarks. */
export const OUTLINE_COLOUR = "#5F86C9";
export const OUTLINE_ALPHA = 0.9;
/** The edge line's thickness, in CSS px at any size. */
export const OUTLINE_EDGE_PX = 1;

/** The demo's inner shapes (the dark ones that leave only the edge): thumb 30, three fingers 28, pinky 24, palm 30 wide, in demo px. */
const INNER_FINGER_PX = [30, 28, 28, 28, 24] as const;
const INNER_PALM_PX = 30;
/** The outline is the inner shape grown by 1.2 px on each side, as in the demo. */
const GROW_PX = 2.4;

export interface OutlineFinger {
  /** The finger's landmark chain, in mm on the A4 sheet. */
  readonly chain: readonly Vec[];
  /** The width of the round-capped stroke along it, in mm. */
  readonly width: number;
}

/** Thumb, index, middle, ring, pinky: about 30, 28, 28, 28 and 24 demo px wide (plus the edge). */
export const OUTLINE_FINGERS: readonly OutlineFinger[] = FINGER_CHAINS.map(
  (chain, i): OutlineFinger => ({
    chain: chain.map((landmark) => LANDMARKS_MM[landmark]!),
    width: demoMm(INNER_FINGER_PX[i]! + GROW_PX),
  }),
);

export interface OutlinePalm {
  /** Through the knuckle bases, down both sides, to a flat wrist base, in mm on the A4 sheet. */
  readonly polygon: readonly Vec[];
  /** The width of the round-joined stroke around the polygon, in mm. */
  readonly width: number;
}

/**
 * The palm polygon, read off the demo in its own pixels: along the knuckle
 * bases (landmarks 5 to 17), down the little finger's side, a flat wrist base
 * 40 mm wide (about 58 demo px), and up the thumb's side. The stroke's round
 * joins round the base's corners.
 *
 * One deviation from the demo: its vertex at the little finger's knuckle is
 * (274, 248) there, and here (274, 239), 6 mm higher. The demo drew its own
 * particles; the page's particle hand (template-hand.ts) is a little fuller
 * between the ring finger and the little finger, and with the demo's vertex a
 * sliver of it (about 0.2 % of the particles, up to 3 mm) stuck out of the
 * outline. At 239 none does (tests/unit/hand-outline.test.ts).
 */
export const OUTLINE_PALM: OutlinePalm = {
  polygon: (
    [
      [165, 232],
      [274, 239],
      [260, 322],
      [234, 364],
      [176, 364],
      [150, 322],
    ] as const satisfies readonly Vec[]
  ).map(fromDemo),
  width: demoMm(INNER_PALM_PX + GROW_PX),
};

/** The same shapes in stage px (the A4 sheet 340 px wide), for the canvas. */
export function outlineInStagePx(): {
  readonly fingers: readonly OutlineFinger[];
  readonly palm: OutlinePalm;
} {
  const px = ([x, y]: Vec): Vec => [x * STAGE_SCALE, y * STAGE_SCALE];
  return {
    fingers: OUTLINE_FINGERS.map(({ chain, width }) => ({
      chain: chain.map(px),
      width: width * STAGE_SCALE,
    })),
    palm: {
      polygon: OUTLINE_PALM.polygon.map(px),
      width: OUTLINE_PALM.width * STAGE_SCALE,
    },
  };
}

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared,
          ),
        );
  return distance(p, [a[0] + dx * t, a[1] + dy * t]);
}

function insidePolygon([x, y]: Vec, polygon: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** The distance from a point to a polyline (a closed one when `closed`), in the points' own unit. */
export function distanceToPolyline(
  point: Vec,
  points: readonly Vec[],
  closed = false,
): number {
  let best = Infinity;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i += 1) {
    best = Math.min(
      best,
      distanceToSegment(point, points[i]!, points[(i + 1) % points.length]!),
    );
  }
  return best;
}

/**
 * True when a point (mm on the A4 sheet) is inside the outline's union: within
 * half a finger stroke of a finger's chain (round caps and joins), or in the
 * palm polygon, or within half the palm stroke of its edges (round joins).
 */
export function insideHandOutline(point: Vec): boolean {
  for (const { chain, width } of OUTLINE_FINGERS) {
    if (distanceToPolyline(point, chain) <= width / 2) return true;
  }
  const { polygon, width } = OUTLINE_PALM;
  return (
    insidePolygon(point, polygon) ||
    distanceToPolyline(point, polygon, true) <= width / 2
  );
}
