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
import {
  estimateFocalFromHomography,
  type PrincipalPoint,
} from "./focal-from-homography";
import type { Homography, Point2 } from "./homography";

// ── Landmark heights above the sheet (v2) ────────────────────────────────
//
// Each landmark's height is a fixed fraction of the hand's length:
//
//     height_i = LANDMARK_HEIGHT_RATIOS[i] × L        (L = this photo's hand length)
//
// STATUS: candidate (未拍板). This is a best estimate from published
// anthropometry, not a fit to any measured hand. No ground truth exists for it
// (docs/PLAN.md: no ruler truth since the prereg v2 decision). Full write-up,
// table and limits: docs/research/landmark-heights-v2.md.
//
// Where the ratios come from. Garrett measured the depth (thickness, dorsal
// to palmar surface) of the right hand's joints with a sliding caliper, on
// 148 men and 211 women of the US Air Force. Both reports are US Government
// works, "approved for public release and sale; its distribution is
// unlimited" (PDF p.1 of each). For one joint,
//
//     ratio = ( (depth / 2) / mean hand length ), averaged over the two sexes
//     (male and female ratios weighted equally, not by sample size)
//
// i.e. the joint centre is assumed to sit at HALF the joint's depth above the
// surface it rests on.
//
// What this does NOT correct, on purpose:
//  - Garrett measured a hand held in the air. A hand lying on paper compresses
//    its palm-side soft tissue, so the real heights are probably a little
//    lower than these. The size of that offset is unknown; no correction is
//    applied.
//  - Garrett's hand length runs from the wrist crease to the longest
//    fingertip, skin to skin. The app's own hand length (see
//    `MEASUREMENT_DEFINITIONS.handLengthMm`, landmark 0 to landmark 12) is a
//    distance between joint-centre landmarks, so it is somewhat shorter, and
//    the heights come out slightly low for that reason too.
//
// Landmarks Garrett did not measure (proxies, all uncertain):
//  - wrist, thumb CMC and every fingertip keep the old v1 value, written as a
//    fraction of 190 mm: 20/190, 18/190 and 6/190;
//  - thumb MCP borrows the thumb IP depth;
//  - index, ring and little MCP borrow the middle finger's MCP thickness
//    (hand thickness at metacarpale III).

/**
 * Which set of heights produced a measurement. Bump the suffix whenever the
 * data, the mapping or the formula below changes. A learning-kit run log
 * records this string and the 21 heights it used (src/lib/learning/plane.ts),
 * and an old log is recomputed from the heights it recorded, never from this
 * version's.
 */
export const LANDMARK_HEIGHTS_MM_VERSION = "landmark-heights-v2";

/**
 * The hand length at which the v1 heights (a fixed 20, 18, 15 ... 6 mm,
 * guessed for a hand about this long) were written down. Also the length used
 * for the first of the two correction passes in measurements.ts, before this
 * photo's own hand length is known.
 */
export const REFERENCE_HAND_LENGTH_MM = 190;

/** One published source report. */
export interface GarrettSource {
  readonly report: string;
  /** DTIC accession number. */
  readonly dtic: string;
  /** Sample size (right hands). */
  readonly n: number;
  /** Mean hand length, cm (wrist crease baseline to the tip of the longest finger). */
  readonly meanHandLengthCm: number;
  /** PDF page (counted from the cover) of the hand-length statistics. */
  readonly handLengthPdfPage: number;
}

export const GARRETT_SOURCES = {
  male: {
    report:
      "Garrett, J. W. (1970). Anthropometry of the Hands of Male Air Force Flight Personnel. AMRL-TR-69-42",
    dtic: "AD0709883",
    n: 148,
    meanHandLengthCm: 19.72,
    handLengthPdfPage: 11,
  },
  female: {
    report: "Garrett, J. W. Anthropometry of the Air Force Female Hand",
    dtic: "AD0710202",
    n: 211,
    meanHandLengthCm: 17.93,
    handLengthPdfPage: 15,
  },
} as const satisfies Record<"male" | "female", GarrettSource>;

/** One of Garrett's depth measurements, mean over the sample, cm. */
export interface GarrettDepth {
  /** The variable number printed in both reports. */
  readonly variable: number;
  readonly name: string;
  readonly maleCm: number;
  readonly femaleCm: number;
  /** PDF pages (counted from the cover) of the male and female statistics. */
  readonly malePdfPage: number;
  readonly femalePdfPage: number;
}

/**
 * The depth means (cm) read from the scanned report pages. The female index
 * DIP depth (variable 14) is 1.28 cm (0.51 in); a first reading of 1.23 was
 * wrong, and the last digit is uncertain (1.28 or 1.29, since 0.51 in is
 * 1.295 cm).
 */
export const GARRETT_DEPTHS_CM = [
  {
    variable: 8,
    name: "hand thickness at metacarpale III (middle MCP)",
    maleCm: 3.29,
    femaleCm: 2.76,
    malePdfPage: 18,
    femalePdfPage: 22,
  },
  {
    variable: 11,
    name: "interphalangeal joint, digit 1 (thumb IP)",
    maleCm: 2.02,
    femaleCm: 1.66,
    malePdfPage: 20,
    femalePdfPage: 24,
  },
  {
    variable: 14,
    name: "distal interphalangeal joint, digit 2 (index DIP)",
    maleCm: 1.55,
    femaleCm: 1.28,
    malePdfPage: 21,
    femalePdfPage: 25,
  },
  {
    variable: 17,
    name: "proximal interphalangeal joint, digit 2 (index PIP)",
    maleCm: 1.94,
    femaleCm: 1.62,
    malePdfPage: 22,
    femalePdfPage: 26,
  },
  {
    variable: 20,
    name: "distal interphalangeal joint, digit 3 (middle DIP)",
    maleCm: 1.6,
    femaleCm: 1.31,
    malePdfPage: 23,
    femalePdfPage: 27,
  },
  {
    variable: 23,
    name: "proximal interphalangeal joint, digit 3 (middle PIP)",
    maleCm: 2.01,
    femaleCm: 1.67,
    malePdfPage: 24,
    femalePdfPage: 28,
  },
  {
    variable: 26,
    name: "distal interphalangeal joint, digit 4 (ring DIP)",
    maleCm: 1.51,
    femaleCm: 1.25,
    malePdfPage: 25,
    femalePdfPage: 29,
  },
  {
    variable: 29,
    name: "proximal interphalangeal joint, digit 4 (ring PIP)",
    maleCm: 1.89,
    femaleCm: 1.57,
    malePdfPage: 26,
    femalePdfPage: 30,
  },
  {
    variable: 32,
    name: "distal interphalangeal joint, digit 5 (little DIP)",
    maleCm: 1.37,
    femaleCm: 1.13,
    malePdfPage: 27,
    femalePdfPage: 31,
  },
  {
    variable: 35,
    name: "proximal interphalangeal joint, digit 5 (little PIP)",
    maleCm: 1.67,
    femaleCm: 1.39,
    malePdfPage: 28,
    femalePdfPage: 32,
  },
] as const satisfies readonly GarrettDepth[];

/** Where one landmark's ratio comes from. */
export type LandmarkHeightBasis =
  | {
      /** Kept from v1: `mm` at `REFERENCE_HAND_LENGTH_MM`, made a ratio. */
      readonly kind: "kept";
      readonly mm: number;
    }
  | {
      readonly kind: "garrett";
      /** Garrett's variable number, a key of `GARRETT_DEPTHS_CM`. */
      readonly variable: number;
      /** True when Garrett did not measure this landmark's own joint. */
      readonly proxy: boolean;
    };

const kept = (mm: number): LandmarkHeightBasis => ({ kind: "kept", mm });
const garrett = (variable: number, proxy = false): LandmarkHeightBasis => ({
  kind: "garrett",
  variable,
  proxy,
});

/**
 * Basis of each of MediaPipe's 21 landmarks, indexed like LANDMARK in
 * src/lib/contracts/measurement.ts: 0 wrist, thumb 1-4 (CMC/MCP/IP/TIP), then
 * index/middle/ring/pinky 5-20 in groups of 4 (MCP/PIP/DIP/TIP).
 */
export const LANDMARK_HEIGHT_BASIS: readonly LandmarkHeightBasis[] = [
  kept(20), // 0 wrist
  kept(18), // 1 thumb CMC
  garrett(11, true), // 2 thumb MCP: borrows the thumb IP depth
  garrett(11), // 3 thumb IP
  kept(6), // 4 thumb TIP
  garrett(8, true), // 5 index MCP: borrows the middle MCP thickness
  garrett(17), // 6 index PIP
  garrett(14), // 7 index DIP
  kept(6), // 8 index TIP
  garrett(8), // 9 middle MCP
  garrett(23), // 10 middle PIP
  garrett(20), // 11 middle DIP
  kept(6), // 12 middle TIP
  garrett(8, true), // 13 ring MCP: borrows the middle MCP thickness
  garrett(29), // 14 ring PIP
  garrett(26), // 15 ring DIP
  kept(6), // 16 ring TIP
  garrett(8, true), // 17 little MCP: borrows the middle MCP thickness
  garrett(35), // 18 little PIP
  garrett(32), // 19 little DIP
  kept(6), // 20 little TIP
];

function garrettRatio(variable: number): number {
  const depth = GARRETT_DEPTHS_CM.find((d) => d.variable === variable);
  if (!depth) {
    throw new Error(`No Garrett depth for variable ${variable}.`);
  }
  const male = depth.maleCm / 2 / GARRETT_SOURCES.male.meanHandLengthCm;
  const female = depth.femaleCm / 2 / GARRETT_SOURCES.female.meanHandLengthCm;
  return (male + female) / 2;
}

/**
 * The 21 height-to-hand-length ratios, worked out from the source data above
 * rather than typed in as decimals, so every one can be traced to a printed
 * number.
 */
export const LANDMARK_HEIGHT_RATIOS: readonly number[] =
  LANDMARK_HEIGHT_BASIS.map((basis) =>
    basis.kind === "kept"
      ? basis.mm / REFERENCE_HAND_LENGTH_MM
      : garrettRatio(basis.variable),
  );

/**
 * The 21 landmark heights above the sheet, in mm, for a hand of the given
 * length (mm): `LANDMARK_HEIGHT_RATIOS[i] × handLengthMm`. Linear in the
 * length. Throws a RangeError for a length that is not a finite number above
 * zero. A fresh array each call.
 */
export function landmarkHeightsMm(handLengthMm: number): number[] {
  if (!Number.isFinite(handLengthMm) || handLengthMm <= 0) {
    throw new RangeError(
      "landmarkHeightsMm: the hand length must be a finite number above 0.",
    );
  }
  return LANDMARK_HEIGHT_RATIOS.map((ratio) => ratio * handLengthMm);
}

/**
 * The heights for a hand of `REFERENCE_HAND_LENGTH_MM`: a REFERENCE value, not
 * a default to reach for. It is the starting heights for the first correction
 * pass, and what the v1 table is compared with. The right heights for a
 * photo scale with that photo's own hand length (`landmarkHeightsMm`).
 */
export const REFERENCE_LANDMARK_HEIGHTS_MM: readonly number[] =
  landmarkHeightsMm(REFERENCE_HAND_LENGTH_MM);

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
 * above the sheet (`heightsMm`) instead of straight onto the sheet plane the
 * way the uncorrected homography path does. The heights are a required
 * argument on purpose: they scale with the hand's length
 * (`landmarkHeightsMm`), so there is no one height table to default to. See
 * `correctLandmarksByHandLength` in measurements.ts for how the product picks
 * them.
 */
export function correctLandmarks(
  landmarksPx: readonly Point2[],
  homography: Homography,
  intrinsics: Intrinsics,
  heightsMm: readonly number[],
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

// ── Focal policy ─────────────────────────────────────────────────────────
//
// Issue #16: "EXIF when present; otherwise the homography estimate if it's
// well-conditioned; otherwise no correction and parallaxCorrected: false."
// One place decides this so measurements.ts's corrected path and any future
// caller can't disagree on the policy.

export type FocalSource = "exif" | "homography" | "none";

export interface ResolvedFocal {
  /** Null exactly when `source` is "none" — no usable focal length. */
  readonly fPx: number | null;
  readonly source: FocalSource;
}

export interface ResolveFocalOptions {
  /** Result of exif-focal.ts, or null if EXIF had no usable focal length. */
  readonly exifFocalPx: number | null;
  readonly homography: Homography;
  readonly principalPoint: PrincipalPoint;
}

/**
 * Pick which focal length (if any) to use for parallax correction: EXIF
 * first, then a well-conditioned homography-focal estimate
 * (focal-from-homography.ts flags an unreliable — e.g. near-fronto-parallel
 * — estimate itself, so this just refuses to use one), else null (no
 * correction).
 */
export function resolveFocalPx(options: ResolveFocalOptions): ResolvedFocal {
  if (options.exifFocalPx !== null) {
    return { fPx: options.exifFocalPx, source: "exif" };
  }
  const estimate = estimateFocalFromHomography(
    options.homography,
    options.principalPoint,
  );
  if (estimate !== null && estimate.reliable) {
    return { fPx: estimate.fPx, source: "homography" };
  }
  return { fPx: null, source: "none" };
}
