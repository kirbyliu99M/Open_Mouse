/**
 * The hand-ghost silhouette (docs/design/camera-capture-2026-09-25/
 * README.md: "a faint hand ghost... at their sheet positions, drawn
 * relative to the tracked sheet quad. The ghost is a placement hint only;
 * it never feeds measurement."). Pure geometry — an open hand (fingers
 * together, thumb slightly out, wrist at the bottom) authored as a closed
 * polygon in a normalized 0-1 unit square, then perspective-hinted onto
 * whatever quad the live loop is currently tracking via
 * `bilinearPointInQuad`. The component turns the returned points into one
 * SVG `<path>`; nothing here touches the DOM.
 */
import { bilinearPointInQuad, type Point, type Quad } from "./quad";

type Hand = "left" | "right";

/**
 * A right hand's outline, u (0=left, 1=right) / v (0=fingertips, 1=wrist),
 * clockwise from the wrist's left corner. Not anatomically exact — a
 * placement hint, not a measurement — but reads as an open hand: four
 * fingers held together (three shallow notches), a thumb bulging out to
 * one side, tapering to the wrist.
 */
const RIGHT_HAND_OUTLINE_UNIT: readonly {
  readonly u: number;
  readonly v: number;
}[] = [
  { u: 0.36, v: 1.0 }, // wrist, left
  { u: 0.3, v: 0.88 }, // palm outer-left
  { u: 0.3, v: 0.72 }, // palm-left, above the thumb split
  { u: 0.18, v: 0.78 }, // thumb outer base
  { u: 0.08, v: 0.68 }, // thumb tip
  { u: 0.14, v: 0.55 }, // thumb inner edge
  { u: 0.26, v: 0.5 }, // thumb rejoins the palm
  { u: 0.3, v: 0.42 }, // index outer base (knuckle line)
  { u: 0.32, v: 0.16 }, // index fingertip
  { u: 0.375, v: 0.28 }, // valley: index/middle
  { u: 0.44, v: 0.06 }, // middle fingertip (longest)
  { u: 0.5, v: 0.26 }, // valley: middle/ring
  { u: 0.565, v: 0.1 }, // ring fingertip
  { u: 0.625, v: 0.28 }, // valley: ring/pinky
  { u: 0.685, v: 0.18 }, // pinky fingertip
  { u: 0.72, v: 0.4 }, // pinky outer base
  { u: 0.74, v: 0.55 }, // palm outer-right
  { u: 0.68, v: 0.9 }, // palm-right down to wrist
  { u: 0.64, v: 1.0 }, // wrist, right
];

/** Insets the raw outline into the paper quad: wrist near (not touching) the bottom edge, centred horizontally. */
const INSET = { uMin: 0.2, uMax: 0.8, vMin: 0.05, vMax: 0.97 };

function insetUnit(
  u: number,
  v: number,
  mirror: boolean,
): { u: number; v: number } {
  const localU = mirror ? 1 - u : u;
  return {
    u: INSET.uMin + localU * (INSET.uMax - INSET.uMin),
    v: INSET.vMin + v * (INSET.vMax - INSET.vMin),
  };
}

/**
 * The hand-ghost outline's points, perspective-hinted onto `quad` (the
 * tracked paper quad, in whatever coordinate space the caller wants the
 * result in — pass a container-pixel-space quad to draw directly).
 * Mirrored for `hand: "left"` so the thumb switches sides.
 */
export function computeHandGhostPoints(
  quad: Quad,
  hand: Hand,
): readonly Point[] {
  const mirror = hand === "left";
  return RIGHT_HAND_OUTLINE_UNIT.map(({ u, v }) => {
    const inset = insetUnit(u, v, mirror);
    return bilinearPointInQuad(inset.u, inset.v, quad);
  });
}

/** `points` joined into a closed SVG path `d` attribute (straight edges — a faceted, not smoothed, silhouette). */
export function handGhostPathD(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const line = rest.map((p) => `L ${p.x} ${p.y}`).join(" ");
  return `M ${first.x} ${first.y} ${line} Z`;
}
