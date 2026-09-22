/**
 * Shared synthetic exact-camera builder for camera-pose.test.ts,
 * focal-from-homography.test.ts and parallax.test.ts. NOT itself a test
 * file — vitest.config.ts's `include` only matches filenames ending in
 * ".test.ts", so this helper is never collected as a test file itself.
 *
 * Builds a known pinhole camera at a given tilt/distance above the sheet,
 * projects known 3D points (sheet-mm XY plus an optional height above the
 * sheet) into image px through that exact model, and derives the same
 * kind of image-px -> sheet-mm homography production code produces (via
 * `estimateHomography` on 16 marker-corner correspondences) — so tests
 * exercise the real homography.ts/camera-pose.ts code paths rather than a
 * hand-rolled shortcut.
 *
 * Uses `camera-pose.ts`'s WORLD-frame convention throughout (see that
 * module's header): Xw = sheet-mm x, Yw = -(sheet-mm y), Zw = height above
 * the sheet in mm, positive toward the camera.
 */
import { SHEET } from "../../../src/lib/contracts/measurement";
import {
  estimateHomography,
  type Homography,
  type Point2,
  type PointCorrespondence,
} from "../../../src/client/geometry/homography";
import {
  centrePrincipalPoint,
  type Intrinsics,
} from "../../../src/client/geometry/camera-pose";

export interface SyntheticCamera {
  /** World -> camera rotation (this test helper's own ground truth, not recovered). */
  readonly R: Homography;
  readonly t: readonly [number, number, number];
  readonly intrinsics: Intrinsics;
  readonly widthPx: number;
  readonly heightPx: number;
  /** C = -Rᵀt, provided directly since it's this helper's construction input. */
  readonly cameraCentreWorld: readonly [number, number, number];
  readonly tiltDeg: number;
  readonly distanceMm: number;
}

export interface BuildCameraOptions {
  /** Tilt off straight-down, in degrees (see `buildRotation` for the exact axis). */
  readonly tiltDeg: number;
  /** Camera height above the sheet, in mm (world Zw of the camera centre). */
  readonly distanceMm: number;
  readonly fPx: number;
  readonly widthPx?: number;
  readonly heightPx?: number;
}

const DEFAULT_WIDTH_PX = 3024;
const DEFAULT_HEIGHT_PX = 4032;

function mulMatVec3(
  m: Homography,
  v: readonly [number, number, number],
): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function matMul3(a: Homography, b: Homography): Homography {
  const result: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[i][k] * b[k][j];
      result[i][j] = sum;
    }
  }
  return result as unknown as Homography;
}

/**
 * A fixed, deliberately non-axis-aligned mixing ratio between the
 * "pitch" (about world X) and "yaw" (about world Y) components of the
 * synthetic tilt below. Purely axis-aligned tilt (ratio 0) is a special
 * case where rotating about X leaves the world-X axis exactly fixed in the
 * camera frame for every tilt magnitude, which makes one of
 * focal-from-homography.ts's two orthogonality constraints permanently
 * degenerate (not just near fronto-parallel) — not representative of a
 * real handheld photo, where tilt is essentially never perfectly
 * axis-aligned. Mixing a smaller yaw in keeps a single `tiltDeg` knob
 * while avoiding that artefact.
 */
const YAW_MIX_RATIO = 0.4;

/**
 * World -> camera rotation for a camera looking straight down at zero tilt
 * (mapping world +Xw -> camera +X, +Yw -> camera -Y, +Zw(toward camera) ->
 * camera -Z(forward)), then tilted by `tiltDeg` — a combined pitch (about
 * the world X axis) and smaller yaw (about the world Y axis, see
 * `YAW_MIX_RATIO`) away from straight-overhead, the way a handheld
 * top-down shot actually deviates from fronto-parallel.
 */
function buildRotation(tiltDeg: number): Homography {
  const theta = (tiltDeg * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const rx: Homography = [
    [1, 0, 0],
    [0, -cosT, sinT],
    [0, -sinT, -cosT],
  ];
  const phi = theta * YAW_MIX_RATIO;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const ry: Homography = [
    [cosP, 0, sinP],
    [0, 1, 0],
    [-sinP, 0, cosP],
  ];
  return matMul3(ry, rx);
}

export function buildSyntheticCamera(
  options: BuildCameraOptions,
): SyntheticCamera {
  const { tiltDeg, distanceMm, fPx } = options;
  const widthPx = options.widthPx ?? DEFAULT_WIDTH_PX;
  const heightPx = options.heightPx ?? DEFAULT_HEIGHT_PX;
  const R = buildRotation(tiltDeg);
  const cameraCentreWorld: [number, number, number] = [0, 0, distanceMm];
  const rc = mulMatVec3(R, cameraCentreWorld);
  const t: [number, number, number] = [-rc[0], -rc[1], -rc[2]];
  return {
    R,
    t,
    intrinsics: { fPx, ...centrePrincipalPoint(widthPx, heightPx) },
    widthPx,
    heightPx,
    cameraCentreWorld,
    tiltDeg,
    distanceMm,
  };
}

/** Project a world-frame 3D point (Xw, Yw, Zw) through the exact synthetic camera into image px. */
export function projectWorldPoint(
  camera: SyntheticCamera,
  world: readonly [number, number, number],
): Point2 {
  const [xw, yw, zw] = world;
  const xc =
    camera.R[0][0] * xw +
    camera.R[0][1] * yw +
    camera.R[0][2] * zw +
    camera.t[0];
  const yc =
    camera.R[1][0] * xw +
    camera.R[1][1] * yw +
    camera.R[1][2] * zw +
    camera.t[1];
  const zc =
    camera.R[2][0] * xw +
    camera.R[2][1] * yw +
    camera.R[2][2] * zw +
    camera.t[2];
  if (!(zc > 0)) {
    throw new RangeError(
      "projectWorldPoint: point is behind the synthetic camera (zc <= 0).",
    );
  }
  const { fPx, cx, cy } = camera.intrinsics;
  return { x: (fPx * xc) / zc + cx, y: (fPx * yc) / zc + cy };
}

/**
 * Project a point given in sheet mm (x-right, y-down — this codebase's
 * standard sheet frame) at a given height above the sheet, into image px.
 * `heightMm` defaults to 0 (a point lying flat on the sheet).
 */
export function projectSheetMm(
  camera: SyntheticCamera,
  sheetMm: Point2,
  heightMm = 0,
): Point2 {
  return projectWorldPoint(camera, [sheetMm.x, -sheetMm.y, heightMm]);
}

/**
 * The flat flap's 16 marker-corner positions in sheet mm (x-right,
 * y-down), centred at (0, 0) — same marker geometry as
 * src/client/sheet/layout.ts (markerLayoutOuterMm / markerCentreSquareMm /
 * markerSizeMm from the contract), just re-centred here for a simpler
 * synthetic-camera-above-the-origin setup. Order: 4 corners per marker,
 * clockwise from each marker's top-left, markers ids 0-3 clockwise from
 * top-left.
 */
export const SHEET_MM_MARKER_CORNERS: readonly Point2[] = (() => {
  const half = SHEET.markerCentreSquareMm / 2;
  const s = SHEET.markerSizeMm / 2;
  const centres: Point2[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
  return centres.flatMap((c) => [
    { x: c.x - s, y: c.y - s },
    { x: c.x + s, y: c.y - s },
    { x: c.x + s, y: c.y + s },
    { x: c.x - s, y: c.y + s },
  ]);
})();

/**
 * The image-px -> sheet-mm homography an exact (noiseless) camera would
 * produce, computed the same way production code does: project the 16
 * marker corners through the camera, then run `estimateHomography` on the
 * resulting (image px, sheet mm) correspondences.
 */
export function buildExactHomography(camera: SyntheticCamera): Homography {
  const correspondences: PointCorrespondence[] = SHEET_MM_MARKER_CORNERS.map(
    (mm) => ({ src: projectSheetMm(camera, mm, 0), dst: mm }),
  );
  return estimateHomography(correspondences);
}
