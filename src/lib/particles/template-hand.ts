import { type Vec, distance } from "./geometry";
import { mulberry32 } from "./random";
import type { TargetPoint } from "./sampling";

/**
 * The template hand of the home page's particle story: a fixed, stylised set of
 * the 21 MediaPipe landmark positions, filled as capsules along the fingers
 * plus a palm polygon, lying on an A4 sheet.
 *
 * It is an illustration. It is NOT a user's hand and NOT a measurement, so the
 * two measurement lines carry no numbers anywhere (docs/design/
 * home-v3-2026-10-03/README.md, "The particle stage").
 *
 * Positions are millimetres on the A4 sheet (origin top-left, x right, y down,
 * 210 × 297), a right hand seen from above, fingers up. They are hand-set from
 * the design screens (screens/04-desktop-en.png), not derived from any dataset
 * or photo.
 */

export const A4_MM = { width: 210, height: 297 } as const;

/** Stage px per millimetre: the A4 sheet is 340 px wide in the target space. */
export const STAGE_SCALE = 340 / A4_MM.width;

/** MediaPipe hand landmark order: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; pinky 17-20. */
export const LANDMARKS_MM: readonly Vec[] = [
  [115.3, 242.5], // 0 wrist
  [83.2, 221.5], // 1 thumb CMC
  [57.8, 199.0], // 2 thumb MCP
  [40.0, 176.1], // 3 thumb IP
  [23.9, 156.0], // 4 thumb tip
  [88.0, 151.2], // 5 index MCP
  [80.9, 112.4], // 6 index PIP
  [77.5, 90.0], // 7 index DIP
  [74.2, 69.4], // 8 index tip
  [115.3, 146.9], // 9 middle MCP
  [115.3, 103.3], // 10 middle PIP
  [115.3, 78.5], // 11 middle DIP
  [115.3, 53.1], // 12 middle tip
  [140.2, 151.2], // 13 ring MCP
  [146.9, 112.4], // 14 ring PIP
  [150.7, 90.0], // 15 ring DIP
  [154.1, 71.3], // 16 ring tip
  [163.6, 162.7], // 17 pinky MCP
  [174.6, 135.4], // 18 pinky PIP
  [181.3, 117.1], // 19 pinky DIP
  [186.1, 100.9], // 20 pinky tip
];

/** MediaPipe's HAND_CONNECTIONS: the skeleton the measured step draws. */
export const SKELETON: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

/** Finger chains (landmark indices) with the half-width in mm at the base and at the tip. */
const FINGERS: readonly {
  readonly chain: readonly number[];
  readonly base: number;
  readonly tip: number;
}[] = [
  { chain: [1, 2, 3, 4], base: 9, tip: 6.8 },
  { chain: [5, 6, 7, 8], base: 8, tip: 6 },
  { chain: [9, 10, 11, 12], base: 8.2, tip: 6 },
  { chain: [13, 14, 15, 16], base: 7.6, tip: 5.6 },
  { chain: [17, 18, 19, 20], base: 6.6, tip: 5 },
];

/** The palm: wrist crease, the thumb's web, across the knuckles, down the little finger's side. */
export const PALM_POLYGON_MM: readonly Vec[] = [
  [96, 246],
  [136, 246],
  [170, 170],
  [166, 150],
  [84, 148],
  [72, 196],
  [80, 225],
];

/** One capsule: a segment with a half-width at each end. */
interface Capsule {
  readonly a: Vec;
  readonly b: Vec;
  readonly ra: number;
  readonly rb: number;
}

export const CAPSULES_MM: readonly Capsule[] = FINGERS.flatMap(
  ({ chain, base, tip }) =>
    chain.slice(1).map((to, i): Capsule => {
      const from = chain[i]!;
      const span = chain.length - 1;
      return {
        a: LANDMARKS_MM[from]!,
        b: LANDMARKS_MM[to]!,
        ra: base + ((tip - base) * i) / span,
        rb: base + ((tip - base) * (i + 1)) / span,
      };
    }),
);

/** Hand length: a ruler beside the hand, from the middle fingertip to the wrist crease. */
export const LENGTH_LINE_MM = {
  x: 222,
  top: 47,
  bottom: 246,
  /** Where the two extension lines start, so they reach in towards the hand. */
  topFrom: 122,
  bottomFrom: 140,
} as const;

/** Palm width: across the palm at the knuckle line. */
export const WIDTH_LINE_MM = { y: 170, left: 70, right: 170 } as const;

/** Half the length of an end tick, in mm. */
export const TICK_MM = 3;

function insideCapsule([x, y]: Vec, { a, b, ra, rb }: Capsule): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared),
        );
  const nearest: Vec = [a[0] + dx * t, a[1] + dy * t];
  return distance([x, y], nearest) <= ra + (rb - ra) * t;
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

/** True when a point (mm) is on the template hand: in a finger capsule or the palm. */
export function insideTemplateHand(point: Vec): boolean {
  return (
    insidePolygon(point, PALM_POLYGON_MM) ||
    CAPSULES_MM.some((capsule) => insideCapsule(point, capsule))
  );
}

const BOUNDS_MM = (() => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of PALM_POLYGON_MM) {
    xs.push(x);
    ys.push(y);
  }
  for (const { a, b, ra, rb } of CAPSULES_MM) {
    xs.push(a[0] - ra, a[0] + ra, b[0] - rb, b[0] + rb);
    ys.push(a[1] - ra, a[1] + ra, b[1] - rb, b[1] + rb);
  }
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
})();

/** The share of fill points that are drawn bright. */
const BRIGHT_SHARE = 0.3;

/**
 * `count` points filling the template hand, in stage px (A4 340 px wide),
 * by seeded rejection sampling. Every point is inside a capsule or the palm.
 */
export function fillTemplateHand(count: number, seed: number): TargetPoint[] {
  const random = mulberry32(seed);
  const out: TargetPoint[] = [];
  const { x0, x1, y0, y1 } = BOUNDS_MM;
  while (out.length < count) {
    const x = x0 + random() * (x1 - x0);
    const y = y0 + random() * (y1 - y0);
    if (!insideTemplateHand([x, y])) continue;
    out.push({
      x: x * STAGE_SCALE,
      y: y * STAGE_SCALE,
      tone: random() < BRIGHT_SHARE ? 1 : 0,
    });
  }
  return out;
}
