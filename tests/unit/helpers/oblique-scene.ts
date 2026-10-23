/**
 * A pinhole scene for the F16 parallax-guard tests (V3.2, candidate): an A4
 * sheet and a hand whose landmarks stand at the product's own heights above
 * it, seen by a camera that looks at the sheet's centre from `tiltDeg` off the
 * vertical, in the direction `azimuthDeg` (0: towards the sheet's right edge,
 * 90: towards its bottom edge, -90: towards its top edge, where the wrist is).
 * NOT a test file.
 *
 * Written out here, not taken from src/, so the tests' ground truth does not
 * move if production's geometry does. Sheet mm: x right, y down the page
 * (corner 0 is the top-left, as the detector's TL, TR, BR, BL). Inside, the
 * scene works in a right-handed frame (x right, y UP the page, z up towards
 * the camera) so that the picture is a real photo, not a mirror image.
 * All numbers it makes are SIMULATED (模擬).
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import { landmarkHeightsMm } from "../../../src/client/geometry/parallax";

/** The hand of tests/unit/measurements.test.ts, sheet mm, 190 mm long; wrist at the top. */
const HAND_MM: readonly (readonly [number, number])[] = [
  [100, 0],
  [85, 20],
  [70, 45],
  [55, 65],
  [45, 85],
  [80, 100],
  [75, 135],
  [65, 150],
  [55, 145],
  [100, 105],
  [100, 140],
  [100, 165],
  [100, 190],
  [130, 99],
  [131, 133],
  [131, 157],
  [131, 177],
  [160, 98],
  [162, 122],
  [163, 140],
  [163, 155],
];

export const OBLIQUE_PAPER_MM = { width: 210, height: 297 } as const;

export interface ObliqueSceneOptions {
  readonly width: number;
  readonly height: number;
  /** The camera's TRUE focal length, px. */
  readonly fPx: number;
  readonly tiltDeg: number;
  readonly azimuthDeg: number;
  /** Distance from the camera to the sheet's centre, mm. */
  readonly distanceMm: number;
  /** The hand's size against the 190 mm hand above (default 1). */
  readonly handScale?: number;
}

export interface ObliqueScene {
  readonly width: number;
  readonly height: number;
  /** TL, TR, BR, BL in image px. */
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  readonly landmarksPx: Point2[];
  /** The hand's true length (landmark 0 to 12), mm. */
  readonly trueHandLengthMm: number;
}

type V3 = readonly [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

export function buildObliqueScene(o: ObliqueSceneOptions): ObliqueScene {
  const scale = o.handScale ?? 1;
  const { width: pw, height: ph } = OBLIQUE_PAPER_MM;
  // Right-handed: (x, -y, z) of sheet mm.
  const target: V3 = [pw / 2, -ph / 2, 0];
  const a = (o.tiltDeg * Math.PI) / 180;
  const b = (o.azimuthDeg * Math.PI) / 180;
  const camera: V3 = [
    target[0] + o.distanceMm * Math.sin(a) * Math.cos(b),
    target[1] - o.distanceMm * Math.sin(a) * Math.sin(b),
    o.distanceMm * Math.cos(a),
  ];
  const forward = unit(sub(target, camera));
  // Image x along the page's x, image y down the page.
  let right = unit(cross([0, -1, 0], forward));
  if (right[0] < 0) right = [-right[0], -right[1], -right[2]];
  const down = cross(forward, right);
  const project = (x: number, y: number, z: number): Point2 => {
    const d = sub([x, -y, z], camera);
    const zc = dot(d, forward);
    return {
      x: (o.fPx * dot(d, right)) / zc + o.width / 2,
      y: (o.fPx * dot(d, down)) / zc + o.height / 2,
    };
  };
  const corners = [
    project(0, 0, 0),
    project(pw, 0, 0),
    project(pw, ph, 0),
    project(0, ph, 0),
  ] as const;
  const trueHandLengthMm =
    Math.hypot(HAND_MM[12][0] - HAND_MM[0][0], HAND_MM[12][1] - HAND_MM[0][1]) *
    scale;
  const heights = landmarkHeightsMm(trueHandLengthMm);
  const landmarksPx = HAND_MM.map(([x, y], i) =>
    project(20 + x * scale, 60 + y * scale, heights[i]),
  );
  return {
    width: o.width,
    height: o.height,
    corners: corners as unknown as ObliqueScene["corners"],
    landmarksPx,
    trueHandLengthMm,
  };
}
