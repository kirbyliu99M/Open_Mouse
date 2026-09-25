/**
 * The hand-ghost silhouette (docs/design/camera-capture-2026-09-25/
 * README.md: "a faint hand ghost... at their sheet positions, drawn
 * relative to the tracked sheet quad. The ghost is a placement hint only;
 * it never feeds measurement."). Pure geometry — synthesises the 11 named
 * points `buildHandSilhouette` (src/client/geometry/handSilhouette.ts,
 * shared with the real measured-state overlay) needs, in a normalized unit
 * box, perspective-hinted onto whatever quad the live loop is currently
 * tracking via `bilinearPointInQuad`. The component draws the returned
 * capsules/palm path as SVG; nothing here touches the DOM.
 *
 * Kirby, 2026-09-25 (second revision): "fingers still read as thin
 * flames" — replaced the earlier hand-authored closed Bézier outline with
 * `buildHandSilhouette`'s capsule approach (near-constant-width, round-
 * capped finger strokes + a filled rounded palm), which is what actually
 * reads as a hand at thumbnail size and is exactly what the measured-state
 * overlay already draws from real landmarks — this file's only job is to
 * synthesise a plausible 11-point layout when there ARE no real landmarks
 * yet (the paper hasn't been photographed).
 */
import { bilinearPointInQuad, type Point, type Quad } from "./quad";
import {
  buildHandSilhouette,
  type HandSilhouetteGeometry,
  type HandSilhouetteLandmarks,
} from "../geometry/handSilhouette";

type Hand = "left" | "right";

interface UnitPoint {
  readonly u: number;
  readonly v: number;
}

/**
 * A right hand's 11 named points in a local unit box: `u` 0↔1 spans the
 * four-finger mass's own width (the thumb extends to negative `u`, since
 * it sticks out beyond that mass); `v` 0 = fingertip line (middle finger,
 * the longest), 1 = wrist line. Finger region is v ∈ [0, 0.45] (≈45% of
 * hand length), palm region v ∈ [0.45, 1] (≈55%) — Kirby's 2026-09-25
 * proportions.
 */
const RIGHT_HAND_UNIT_POINTS: Record<keyof HandSilhouetteLandmarks, UnitPoint> = {
  wrist: { u: 0.5, v: 1.0 },
  indexMcp: { u: 0.19, v: 0.44 },
  indexTip: { u: 0.19, v: 0.09 },
  middleMcp: { u: 0.42, v: 0.44 },
  middleTip: { u: 0.42, v: 0.0 },
  ringMcp: { u: 0.65, v: 0.44 },
  ringTip: { u: 0.65, v: 0.1 },
  pinkyMcp: { u: 0.87, v: 0.44 },
  pinkyTip: { u: 0.87, v: 0.24 },
  thumbBase: { u: 0.05, v: 0.7 },
  thumbTip: { u: -0.18, v: 0.5 },
};

/** Palm width ÷ hand length, per Kirby's 2026-09-25 proportions. */
const PALM_WIDTH_TO_LENGTH_RATIO = 0.45;
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
 * The hand-ghost's full silhouette geometry, perspective-hinted onto
 * `quad` (the tracked paper quad, in whatever coordinate space the caller
 * wants the result in — pass a container-pixel-space quad to draw
 * directly). Mirrored for `hand: "left"` so the thumb switches sides.
 */
export function computeHandGhostGeometry(
  quad: Quad,
  hand: Hand,
): HandSilhouetteGeometry {
  const mirror = hand === "left";
  const range = horizontalInsetRange(quad);
  const synthesised = Object.fromEntries(
    Object.entries(RIGHT_HAND_UNIT_POINTS).map(([key, unit]) => [
      key,
      placeInQuad(unit, quad, range, mirror),
    ]),
  ) as unknown as HandSilhouetteLandmarks;
  return buildHandSilhouette(synthesised);
}
