/**
 * Camera pose recovery: decompose a sheet homography plus known intrinsics
 * into an extrinsic rotation R and translation t, so `parallax.ts` can
 * back-project image pixels as 3D rays and intersect them with a plane
 * above the sheet (not just the sheet plane itself).
 *
 * ── Coordinate conventions — read this before touching anything below ──
 *
 * Image pixels: origin top-left, u right, v DOWN (standard raster/image
 * convention).
 *
 * Sheet mm (src/client/sheet/layout.ts, src/client/geometry/homography.ts):
 * origin at the top-left of the printed content, x right, y DOWN the page —
 * i.e. the sheet-mm frame has the SAME y-down handedness as image pixels.
 * `estimateHomography` (homography.ts) builds H mapping image px → sheet mm
 * directly in that y-down frame; that is the `homographyPxToMm` this module
 * takes as input.
 *
 * World frame — used ONLY inside this module and parallax.ts:
 *   Xw = sheet-mm x (right)
 *   Yw = −(sheet-mm y)   (flipped, so it points UP the page)
 *   Zw = height above the sheet plane, in mm, positive TOWARD the camera
 * The Y flip is required for (Xw, Yw, Zw) to be right-handed: sheet mm's
 * (x-right, y-down) pair is the *left-handed* half of a frame whose third
 * axis points up at the camera (x-right, y-down, z-out-of-the-page is a
 * mirrored — det = −1 — basis). A proper rotation matrix (det = +1, which
 * is what SVD/polar re-orthonormalisation produces and what r3 = r1 × r2
 * assumes) only relates two right-handed frames, so one of sheet-x/sheet-y
 * has to flip somewhere. Flipping Y is the cheapest choice: it makes
 * Zw = +heightMm exactly, matching issue #16's "intersect with the plane
 * z = heightsMm[i]" literally. `sheetMmToWorld` / `worldToSheetMm` below are
 * the ONLY places that flip should happen — never inline it elsewhere.
 *
 * Camera frame: standard OpenCV/pinhole convention — X right, Y down, Z
 * FORWARD (away from the lens, into the scene). A point with camera-frame
 * Z > 0 is in front of the camera. Intrinsics K map a camera-frame ray
 * (Xc, Yc, Zc) to homogeneous pixels: [u, v, 1] ~ K·[Xc, Yc, Zc]ᵀ. Square
 * pixels, zero skew, principal point (cx, cy): K = [[f,0,cx],[0,f,cy],[0,0,1]].
 *
 * Extrinsics: camera-frame point = R · world-frame point + t (world →
 * camera). R's columns are where the world's X/Y/Z basis vectors land in
 * the camera frame: R = [r1 | r2 | r3]. For a point ON the sheet
 * (Zw = 0), camera-frame coordinates are R·(Xw, Yw, 0) + t = Xw·r1 + Yw·r2 + t,
 * so the plane-restricted projection is exactly K·[r1 r2 t], which is (up to
 * one arbitrary overall scalar, same ambiguity a homography always carries)
 * the sheet-mm → image-px homography in the WORLD frame above.
 *
 * The camera centre in world coordinates is C = −Rᵀt. "Camera is above the
 * sheet" means C.z > 0 in this module's Zw-toward-camera convention.
 */
import {
  invert3x3,
  multiply3x3,
  type Homography,
  type Point2,
} from "./homography";

/** Pinhole intrinsics: square pixels, zero skew (issue #16's stated model). */
export interface Intrinsics {
  readonly fPx: number;
  readonly cx: number;
  readonly cy: number;
}

/** Principal point at the image centre, per issue #16. */
export function centrePrincipalPoint(
  widthPx: number,
  heightPx: number,
): { readonly cx: number; readonly cy: number } {
  return { cx: widthPx / 2, cy: heightPx / 2 };
}

/** Row-major 3×3 matrix — reuses homography.ts's shape, no projective meaning implied. */
export type Mat3 = Homography;
export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  /** World → camera rotation. Orthonormal (re-orthonormalised via polar decomposition), det = +1. */
  readonly R: Mat3;
  /** World → camera translation: camera-frame point = R·worldPoint + t. */
  readonly t: Vec3;
  /** Camera centre in WORLD coordinates: C = −Rᵀt. */
  readonly cameraCentreWorld: Vec3;
  /** cameraCentreWorld.z — height of the camera above the sheet, in mm. Always > 0. */
  readonly cameraHeightMm: number;
}

const ORTHONORMALIZE_ITERATIONS = 8;

/** diag(1, −1, 1) — the world→sheet-mm Y flip, as a 3×3 homogeneous matrix. */
const FLIP_Y: Mat3 = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, 1],
];

/**
 * Convert the image-px → sheet-mm homography (this codebase's standard
 * direction, homography.ts) into the WORLD-frame sheet → image-px
 * homography used by the K[r1 r2 t] decomposition: invert it (sheet mm →
 * image px), then fold in this module's Y flip (sheet-mm y-down →
 * world-frame Yw pointing up the page). Pure linear algebra, independent of
 * any intrinsics — shared by `recoverCameraPose` here and by
 * focal-from-homography.ts, which needs the same matrix before a focal
 * length (and hence K) is known.
 */
export function homographyToWorldFrame(homographyPxToMm: Homography): Mat3 {
  const homographyMmToPx = invert3x3(homographyPxToMm);
  return multiply3x3(homographyMmToPx, FLIP_Y);
}

function invertIntrinsics(k: Intrinsics): Mat3 {
  const { fPx, cx, cy } = k;
  if (!(fPx > 0)) {
    throw new RangeError(`invertIntrinsics: fPx must be positive, got ${fPx}.`);
  }
  return [
    [1 / fPx, 0, -cx / fPx],
    [0, 1 / fPx, -cy / fPx],
    [0, 0, 1],
  ];
}

function column(m: Mat3, j: number): Vec3 {
  return [m[0][j], m[1][j], m[2][j]];
}

function norm3(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function scale3(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function transpose3(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function matSub(a: Mat3, b: Mat3): Mat3 {
  return [
    [a[0][0] - b[0][0], a[0][1] - b[0][1], a[0][2] - b[0][2]],
    [a[1][0] - b[1][0], a[1][1] - b[1][1], a[1][2] - b[1][2]],
    [a[2][0] - b[2][0], a[2][1] - b[2][1], a[2][2] - b[2][2]],
  ];
}

function matScale(m: Mat3, s: number): Mat3 {
  return [
    [m[0][0] * s, m[0][1] * s, m[0][2] * s],
    [m[1][0] * s, m[1][1] * s, m[1][2] * s],
    [m[2][0] * s, m[2][1] * s, m[2][2] * s],
  ];
}

const IDENTITY_3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Re-orthonormalise a near-orthogonal 3×3 matrix to the nearest proper
 * rotation, via Newton's iteration for the orthogonal factor of a polar
 * decomposition (Higham 1986): X_{k+1} = X_k·(3I − X_kᵀX_k) / 2. This
 * converges cubically to the same U·Vᵀ an SVD-based polar decomposition
 * would give, without needing a general SVD implementation, provided the
 * input's singular values are within (0, √3) of 1 — true here because R's
 * columns are unit-ish vectors coming from a good homography fit, not an
 * arbitrary matrix.
 */
function orthonormalize(m: Mat3): Mat3 {
  let x = m;
  for (let i = 0; i < ORTHONORMALIZE_ITERATIONS; i++) {
    const xtx = multiply3x3(transpose3(x), x);
    x = matScale(multiply3x3(x, matSub(matScale(IDENTITY_3, 3), xtx)), 0.5);
  }
  return x;
}

function mulMatVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Sheet mm (y-down) → this module's world frame (Yw flipped, see header). */
export function sheetMmToWorld(p: Point2): readonly [number, number] {
  return [p.x, -p.y];
}

/** This module's world frame (Yw flipped) → sheet mm (y-down). */
export function worldToSheetMm(xw: number, yw: number): Point2 {
  return { x: xw, y: -yw };
}

/**
 * Decompose `homographyPxToMm` (image px → sheet mm, homography.ts's
 * standard direction) into a camera pose given known intrinsics, following
 * the standard single-view planar extrinsics recovery (Zhang 2000 §3.1):
 * normalise K⁻¹·H's first two columns to unit length (their common scale
 * factor λ is otherwise unknown, since H is only defined up to scale),
 * take those as r1, r2, resolve the ±λ sign ambiguity by requiring the
 * sheet to be in front of the camera, set r3 = r1 × r2, then
 * re-orthonormalise [r1 r2 r3] (`orthonormalize`) since real (even
 * noiseless-but-finite-precision) input never makes r1 ⊥ r2 exactly.
 *
 * Throws a RangeError if the recovered camera doesn't end up above the
 * sheet (cameraHeightMm ≤ 0) — the physical configuration this whole
 * pipeline assumes (a top-down photo), and a sign of a bad H or K upstream.
 */
export function recoverCameraPose(
  homographyPxToMm: Homography,
  intrinsics: Intrinsics,
): CameraPose {
  const hWorld = homographyToWorldFrame(homographyPxToMm);
  const kInv = invertIntrinsics(intrinsics);
  const m = multiply3x3(kInv, hWorld);

  const m0 = column(m, 0);
  const m1 = column(m, 1);
  const m2 = column(m, 2);

  const n0 = norm3(m0);
  const n1 = norm3(m1);
  if (n0 < 1e-12 || n1 < 1e-12) {
    throw new RangeError(
      "recoverCameraPose: degenerate homography or intrinsics (a zero-length K⁻¹H column).",
    );
  }
  // The common scale factor λ should be the same for both columns; average
  // for a little robustness against the homography and K not being exact.
  const lambda = 2 / (n0 + n1);

  let r1 = scale3(m0, lambda);
  let r2 = scale3(m1, lambda);
  let t = scale3(m2, lambda);

  // t is exactly the camera-frame coordinate of the world origin
  // (Xw = Yw = 0, a point on the sheet). It must be in front of the
  // camera: t.z > 0. If not, flip the sign of λ — but recompute r3 fresh
  // as r1 × r2 with the newly-flipped r1, r2 rather than just negating the
  // old r3, which would flip det(R) from +1 to −1 (an improper rotation).
  if (t[2] < 0) {
    r1 = scale3(r1, -1);
    r2 = scale3(r2, -1);
    t = scale3(t, -1);
  }
  const r3 = cross3(r1, r2);

  const rRaw: Mat3 = [
    [r1[0], r2[0], r3[0]],
    [r1[1], r2[1], r3[1]],
    [r1[2], r2[2], r3[2]],
  ];
  const R = orthonormalize(rRaw);

  const cameraCentreWorld = scale3(mulMatVec(transpose3(R), t), -1);

  if (!(cameraCentreWorld[2] > 0)) {
    throw new RangeError(
      `recoverCameraPose: recovered camera is not above the sheet (height ${cameraCentreWorld[2].toFixed(2)} mm) — check the homography and intrinsics.`,
    );
  }

  return {
    R,
    t,
    cameraCentreWorld,
    cameraHeightMm: cameraCentreWorld[2],
  };
}

export { invertIntrinsics };
