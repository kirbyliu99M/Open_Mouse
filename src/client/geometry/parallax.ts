/**
 * Parallax correction for MediaPipe's joint-centre landmarks.
 *
 * MediaPipe hand landmarks are joint CENTRES, sitting ~6-20 mm above the
 * sheet plane (skin + joint radius). Mapping them through the sheet
 * homography — which assumes every point lies ON the sheet (world Zw = 0,
 * see camera-pose.ts's header) — pushes them radially outward from the
 * camera's optical axis, inflating every measured distance by roughly
 * height / cameraDistance (~3% at a ~450 mm shot with ~15 mm of relief:
 * issue #16). `correctLandmarks` fixes this by back-projecting each pixel
 * as a full 3D ray through the recovered camera pose and intersecting it
 * with the plane at that landmark's own height above the sheet
 * (world Zw = heightMm), instead of Zw = 0.
 */
import {
  invertIntrinsics,
  recoverCameraPose,
  worldToSheetMm,
  type CameraPose,
  type Intrinsics,
  type Vec3,
} from "./camera-pose";
import type { Homography, Point2 } from "./homography";

/**
 * Provisional per-landmark heights above the sheet plane, in millimetres,
 * indexed exactly like MediaPipe's 21 joint-centre landmarks (LANDMARK in
 * src/lib/contracts/measurement.ts): 0 wrist, thumb 1-4 (CMC/MCP/IP/TIP),
 * then index/middle/ring/pinky 5-20 in groups of 4
 * (MCP/PIP/DIP/TIP). Anatomical estimates — wrist thickest, tapering to the
 * fingertips — pending the M2 gate's fit against Kirby's ground truth (see
 * issue #16). Versioned so a stored measurement can record which heights
 * produced it; bump the suffix whenever these numbers change.
 */
export const LANDMARK_HEIGHTS_MM_VERSION = "landmark-heights-v1";

export const LANDMARK_HEIGHTS_MM: readonly number[] = [
  20, // 0 wrist
  18,
  15,
  11,
  6, // 1-4 thumb CMC, MCP, IP, TIP
  13,
  10,
  8,
  6, // 5-8 index MCP, PIP, DIP, TIP
  13,
  10,
  8,
  6, // 9-12 middle MCP, PIP, DIP, TIP
  13,
  10,
  8,
  6, // 13-16 ring MCP, PIP, DIP, TIP
  13,
  10,
  8,
  6, // 17-20 pinky MCP, PIP, DIP, TIP
];

/**
 * Back-project one image-px landmark as a ray through the camera pose and
 * intersect it with the world-frame plane Zw = heightMm (see
 * camera-pose.ts's header: Zw is height above the sheet, positive toward
 * the camera). Returns the intersection in sheet mm.
 */
export function backProjectToHeight(
  pixel: Point2,
  pose: CameraPose,
  intrinsics: Intrinsics,
  heightMm: number,
): Point2 {
  const kInv = invertIntrinsics(intrinsics);
  // Camera-frame ray direction for this pixel (up to scale; the pixel's
  // homogeneous coordinate already has a 1 in the third slot, so this is
  // exactly K⁻¹·[u, v, 1]ᵀ).
  const dirCamera: Vec3 = [
    kInv[0][0] * pixel.x + kInv[0][1] * pixel.y + kInv[0][2],
    kInv[1][0] * pixel.x + kInv[1][1] * pixel.y + kInv[1][2],
    kInv[2][0] * pixel.x + kInv[2][1] * pixel.y + kInv[2][2],
  ];

  // Camera frame → world frame is just the rotation for a direction vector
  // (no translation): worldDirection = Rᵀ · cameraDirection.
  const r = pose.R;
  const dirWorld: Vec3 = [
    r[0][0] * dirCamera[0] + r[1][0] * dirCamera[1] + r[2][0] * dirCamera[2],
    r[0][1] * dirCamera[0] + r[1][1] * dirCamera[1] + r[2][1] * dirCamera[2],
    r[0][2] * dirCamera[0] + r[1][2] * dirCamera[1] + r[2][2] * dirCamera[2],
  ];

  if (Math.abs(dirWorld[2]) < 1e-12) {
    throw new RangeError(
      "backProjectToHeight: ray is parallel to the sheet plane (dirWorld.z ≈ 0) — cannot intersect.",
    );
  }

  const c = pose.cameraCentreWorld;
  // C.z + lambda * dirWorld.z = heightMm
  const lambda = (heightMm - c[2]) / dirWorld[2];

  const xw = c[0] + lambda * dirWorld[0];
  const yw = c[1] + lambda * dirWorld[1];
  return worldToSheetMm(xw, yw);
}

/**
 * Correct all 21 MediaPipe landmarks (image px) into parallax-corrected
 * sheet-mm points, back-projecting each onto the plane at its own height
 * above the sheet (`heightsMm`, defaulting to `LANDMARK_HEIGHTS_MM`)
 * instead of straight onto the sheet plane the way the uncorrected
 * homography path does.
 */
export function correctLandmarks(
  landmarksPx: readonly Point2[],
  homography: Homography,
  intrinsics: Intrinsics,
  heightsMm: readonly number[] = LANDMARK_HEIGHTS_MM,
): Point2[] {
  if (landmarksPx.length !== heightsMm.length) {
    throw new RangeError(
      `correctLandmarks: ${landmarksPx.length} landmarks but ${heightsMm.length} heights — they must be the same length.`,
    );
  }
  const pose = recoverCameraPose(homography, intrinsics);
  return landmarksPx.map((pixel, i) =>
    backProjectToHeight(pixel, pose, intrinsics, heightsMm[i]),
  );
}
