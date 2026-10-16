/**
 * A small pinhole scene for the shadow-mode tests: an A4 sheet and a hand whose
 * landmarks stand at the product's own heights above it, seen from a camera
 * that is tilted by `tiltDeg` about the sheet's x axis. NOT a test file.
 *
 * The camera is written out here (not taken from src/) so that the tests'
 * ground truth does not move if production's geometry does. Sheet x runs right
 * and sheet y runs down (corner 0 is the sheet's top-left, as the detector's
 * TL, TR, BR, BL); a point at height z mm above the sheet is z mm nearer the
 * camera.
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import { landmarkHeightsMm } from "../../../src/client/geometry/parallax";

/** The hand of tests/unit/measurements.test.ts, in mm on the sheet (190 mm long). */
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

export const SHADOW_SCENE_PAPER_MM = { width: 210, height: 297 } as const;

export interface ShadowSceneOptions {
  readonly width: number;
  readonly height: number;
  /** The true focal length in px. */
  readonly fPx: number;
  readonly tiltDeg: number;
  /** Camera height above the sheet, mm. */
  readonly cameraHeightMm: number;
  /** The camera's offset from the point over the sheet's centre, mm. */
  readonly offsetMm?: { readonly x: number; readonly y: number };
}

export interface ShadowScene {
  readonly width: number;
  readonly height: number;
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  readonly landmarksPx: Point2[];
  /** The hand's true length (landmark 0 to 12), mm. */
  readonly trueHandLengthMm: number;
}

export function buildShadowScene(o: ShadowSceneOptions): ShadowScene {
  const tilt = (o.tiltDeg * Math.PI) / 180;
  const offset = o.offsetMm ?? { x: 0, y: 0 };
  const cam = {
    x: SHADOW_SCENE_PAPER_MM.width / 2 + offset.x,
    y: SHADOW_SCENE_PAPER_MM.height / 2 + offset.y,
  };
  const project = (x: number, y: number, z: number): Point2 => {
    const dx = x - cam.x;
    const dy = y - cam.y;
    const dz = o.cameraHeightMm - z;
    const yc = dy * Math.cos(tilt) - dz * Math.sin(tilt);
    const zc = dy * Math.sin(tilt) + dz * Math.cos(tilt);
    return {
      x: (o.fPx * dx) / zc + o.width / 2,
      y: (o.fPx * yc) / zc + o.height / 2,
    };
  };
  const { width: pw, height: ph } = SHADOW_SCENE_PAPER_MM;
  const corners = [
    project(0, 0, 0),
    project(pw, 0, 0),
    project(pw, ph, 0),
    project(0, ph, 0),
  ] as const;
  const trueHandLengthMm = Math.hypot(
    HAND_MM[12][0] - HAND_MM[0][0],
    HAND_MM[12][1] - HAND_MM[0][1],
  );
  const heights = landmarkHeightsMm(trueHandLengthMm);
  const landmarksPx = HAND_MM.map(([x, y], i) =>
    project(x + 20, y + 40, heights[i]),
  );
  return {
    width: o.width,
    height: o.height,
    corners: corners as unknown as ShadowScene["corners"],
    landmarksPx,
    trueHandLengthMm,
  };
}
