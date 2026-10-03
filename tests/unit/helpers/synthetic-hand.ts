/**
 * Synthetic hand landmarks in image space (21 points, MediaPipe's order), for
 * the pose check and the sorter's tests. NOT a test file; no photo is involved.
 *
 * The hand is built from a palm 100 units long (wrist to the middle finger's
 * MCP) with four fingers, each of three segments 40, 23 and 18 units long (a
 * little finger shorter), seen from above. `curl` bends them as a claw does:
 * the knuckle rises 55 degrees, the middle joint folds 90 degrees back and the
 * fingertip 45 degrees further, so that from above the finger is foreshortened
 * (0 = flat, 1 = claw).
 */
import type { Point2 } from "../../../src/client/geometry/homography";

export interface SyntheticHandOptions {
  /** 0 = flat, 1 = claw. Default 0. */
  readonly curl?: number;
  /** Fingers fanned out (true) or together (false). Default true. */
  readonly spread?: boolean;
}

export interface HandTransform {
  readonly scale?: number;
  readonly rotationDeg?: number;
  readonly offset?: Point2;
  /** Mirror left to right (a left hand). */
  readonly mirror?: boolean;
}

const DEG = Math.PI / 180;

/** Per finger: its MCP, a length factor, and its direction from straight up (degrees) when spread and when together. */
const FINGERS = [
  { mcp: { x: -28, y: -96 }, k: 0.95, spread: -12, together: -3 },
  { mcp: { x: 0, y: -100 }, k: 1, spread: 0, together: 0 },
  { mcp: { x: 26, y: -95 }, k: 0.95, spread: 10, together: 3 },
  { mcp: { x: 50, y: -84 }, k: 0.78, spread: 22, together: 7 },
] as const;

const SEGMENTS = [40, 23, 18] as const;

export function syntheticHand(
  options: SyntheticHandOptions = {},
  transform: HandTransform = {},
): Point2[] {
  const t = options.curl ?? 0;
  const spread = options.spread ?? true;
  const a1 = 55 * t * DEG;
  const a2 = a1 - 90 * t * DEG;
  const a3 = a2 - 45 * t * DEG;
  const angles = [a1, a2, a3];

  const points: Point2[] = new Array<Point2>(21);
  points[0] = { x: 0, y: 0 };
  // Thumb: not used by the pose check, but a hand has one.
  const thumb = spread
    ? [
        { x: -30, y: -22 },
        { x: -55, y: -44 },
        { x: -72, y: -62 },
        { x: -84, y: -78 },
      ]
    : [
        { x: -24, y: -20 },
        { x: -40, y: -42 },
        { x: -46, y: -62 },
        { x: -48, y: -78 },
      ];
  thumb.forEach((p, i) => (points[1 + i] = p));

  FINGERS.forEach((f, fi) => {
    const theta = (spread ? f.spread : f.together) * DEG;
    const dir = { x: Math.sin(theta), y: -Math.cos(theta) };
    let at: Point2 = { ...f.mcp };
    points[5 + fi * 4] = at;
    SEGMENTS.forEach((length, si) => {
      const forward = length * f.k * Math.cos(angles[si]!);
      at = { x: at.x + dir.x * forward, y: at.y + dir.y * forward };
      points[6 + fi * 4 + si] = at;
    });
  });

  const s = transform.scale ?? 1;
  const r = (transform.rotationDeg ?? 0) * DEG;
  const o = transform.offset ?? { x: 0, y: 0 };
  return points.map((p) => {
    const x0 = (transform.mirror ? -p.x : p.x) * s;
    const y0 = p.y * s;
    return {
      x: x0 * Math.cos(r) - y0 * Math.sin(r) + o.x,
      y: x0 * Math.sin(r) + y0 * Math.cos(r) + o.y,
    };
  });
}
