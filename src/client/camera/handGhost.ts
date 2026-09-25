/**
 * The hand-ghost silhouette (docs/design/camera-capture-2026-09-25/
 * README.md: "a faint hand ghost... at their sheet positions, drawn
 * relative to the tracked sheet quad. The ghost is a placement hint only;
 * it never feeds measurement."). Pure geometry — an open hand (fingers
 * together, thumb angled out, wrist exiting the bottom edge) authored as
 * anchor points in a normalized unit box, smoothed into one closed cubic-
 * Bézier outline (Catmull-Rom → Bézier — passes exactly through every
 * anchor, no hand-picked control points), then perspective-hinted onto
 * whatever quad the live loop is currently tracking via
 * `bilinearPointInQuad`. The component turns the returned path data into
 * one SVG `<path>` plus three faint interior lines; nothing here touches
 * the DOM.
 *
 * Proportions (Kirby, 2026-09-25 revision): palm ≈ 55% of hand length,
 * fingers ≈ 45%; palm width ≈ 45% of hand length; middle finger longest,
 * ring ≈ index, pinky clearly shorter; thumb angled ~35° out from the
 * palm's long axis.
 */
import { bilinearPointInQuad, type Point, type Quad } from "./quad";

type Hand = "left" | "right";

interface UnitPoint {
  readonly u: number;
  readonly v: number;
}

/**
 * Anchor points for a RIGHT hand's outline, clockwise from the wrist's
 * left corner, in a local unit box: `u` 0↔1 spans the four-finger mass's
 * own width (the thumb extends to negative `u`, since it sticks out
 * beyond that mass — realistic for a spread hand); `v` 0 = fingertip line
 * (middle finger, the longest), 1 = wrist line. Finger region is v ∈
 * [0, 0.45] (≈45% of hand length), palm region v ∈ [0.45, 1] (≈55%).
 */
const RIGHT_HAND_ANCHORS: readonly UnitPoint[] = [
  { u: 0.28, v: 1.0 }, // wrist, left
  { u: 0.1, v: 0.83 }, // thumb base, lower (palm heel, thumb side)
  { u: -0.16, v: 0.63 }, // thumb tip (~35° out from the palm's long axis)
  { u: 0.02, v: 0.48 }, // thumb base, upper (rejoins the palm)
  { u: 0.06, v: 0.44 }, // index outer base (knuckle line)
  { u: 0.19, v: 0.09 }, // index fingertip
  { u: 0.3, v: 0.37 }, // valley: index / middle
  { u: 0.42, v: 0.0 }, // middle fingertip (longest)
  { u: 0.54, v: 0.37 }, // valley: middle / ring
  { u: 0.65, v: 0.1 }, // ring fingertip (≈ index)
  { u: 0.76, v: 0.37 }, // valley: ring / pinky
  { u: 0.87, v: 0.24 }, // pinky fingertip (clearly shorter)
  { u: 0.96, v: 0.44 }, // pinky outer base (knuckle line)
  { u: 0.99, v: 0.62 }, // palm outer-right (heel bulge)
  { u: 0.74, v: 1.0 }, // wrist, right
];

/** Valley → finger-gap hint line endpoints (u fixed, v shortened toward the tips), local unit space. */
const FINGER_GAP_HINTS: readonly [UnitPoint, UnitPoint][] = [
  [
    { u: 0.3, v: 0.35 },
    { u: 0.3, v: 0.15 },
  ],
  [
    { u: 0.54, v: 0.35 },
    { u: 0.54, v: 0.09 },
  ],
  [
    { u: 0.76, v: 0.35 },
    { u: 0.76, v: 0.18 },
  ],
];

/** Palm width ÷ hand length, per Kirby's 2026-09-25 proportions. */
const PALM_WIDTH_TO_LENGTH_RATIO = 0.45;
/** Vertical inset (of the quad) the hand's own length spans — leaves margin top/bottom. */
const V_MIN = 0.04;
const V_MAX = 0.97;
const MIN_WIDTH_FRACTION = 0.15;
const MAX_WIDTH_FRACTION = 0.9;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The quad's own average width/height, in whatever units its corners are already in. */
function quadSize(quad: Quad): { width: number; height: number } {
  const topLen = dist(quad.topLeft, quad.topRight);
  const bottomLen = dist(quad.bottomLeft, quad.bottomRight);
  const leftLen = dist(quad.topLeft, quad.bottomLeft);
  const rightLen = dist(quad.topRight, quad.bottomRight);
  return { width: (topLen + bottomLen) / 2, height: (leftLen + rightLen) / 2 };
}

/**
 * The horizontal inset range (as a fraction of the quad's own width) that
 * gives the mapped hand its real ~45%-of-length width, regardless of the
 * quad's own (paper) aspect ratio — computed from the quad's actual pixel
 * dimensions, not a fixed constant.
 */
function horizontalInsetRange(quad: Quad): { uMin: number; uMax: number } {
  const { width, height } = quadSize(quad);
  const handLengthPx = (V_MAX - V_MIN) * height;
  const handWidthPx = PALM_WIDTH_TO_LENGTH_RATIO * handLengthPx;
  const widthFraction =
    width > 0
      ? Math.min(
          MAX_WIDTH_FRACTION,
          Math.max(MIN_WIDTH_FRACTION, handWidthPx / width),
        )
      : MIN_WIDTH_FRACTION;
  return { uMin: 0.5 - widthFraction / 2, uMax: 0.5 + widthFraction / 2 };
}

function placeInQuad(
  point: UnitPoint,
  quad: Quad,
  range: { uMin: number; uMax: number },
  mirror: boolean,
): Point {
  const localU = mirror ? 1 - point.u : point.u;
  const u = range.uMin + localU * (range.uMax - range.uMin);
  const v = V_MIN + point.v * (V_MAX - V_MIN);
  return bilinearPointInQuad(u, v, quad);
}

/**
 * Catmull-Rom → cubic-Bézier: a smooth closed curve passing exactly
 * through every point in order, with automatically-computed control
 * points (no hand-picked tangents needed — the standard 1/6-tangent
 * construction). Mapping only the ANCHOR points through
 * `bilinearPointInQuad` (rather than pre-computing control points and
 * mapping those) is deliberate: control points don't transform correctly
 * under a non-affine map, so generating them AFTER mapping, directly in
 * the final container-pixel space, is the more correct order.
 */
function catmullRomClosedPathD(points: readonly Point[]): string {
  const n = points.length;
  if (n < 3) return "";
  const at = (i: number) => points[((i % n) + n) % n];
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${p2.x} ${p2.y}`;
  }
  return d + " Z";
}

export interface HandGhostGeometry {
  /** The smooth closed outline, ready for an SVG `<path d>`. */
  readonly outlineD: string;
  /** Three faint straight hints at the finger gaps, ready for SVG `<line>` endpoints. */
  readonly fingerGapLines: readonly (readonly [Point, Point])[];
}

/**
 * The hand-ghost's full geometry, perspective-hinted onto `quad` (the
 * tracked paper quad, in whatever coordinate space the caller wants the
 * result in — pass a container-pixel-space quad to draw directly).
 * Mirrored for `hand: "left"` so the thumb switches sides.
 */
export function computeHandGhostGeometry(
  quad: Quad,
  hand: Hand,
): HandGhostGeometry {
  const mirror = hand === "left";
  const range = horizontalInsetRange(quad);
  const outlinePoints = RIGHT_HAND_ANCHORS.map((p) =>
    placeInQuad(p, quad, range, mirror),
  );
  const fingerGapLines = FINGER_GAP_HINTS.map(
    ([a, b]) =>
      [
        placeInQuad(a, quad, range, mirror),
        placeInQuad(b, quad, range, mirror),
      ] as const,
  );
  return {
    outlineD: catmullRomClosedPathD(outlinePoints),
    fingerGapLines,
  };
}
