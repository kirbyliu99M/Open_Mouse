/**
 * SHADOW MODE (2026-10-16, candidate, 未拍板): what the hand length WOULD have
 * been had the parallax correction used a nominal focal length, worked out next
 * to the real measurement and never used by it.
 *
 * Why: a photo with no EXIF (a frame of the live video) gets its focal length
 * from the sheet's homography, which is judged unreliable in real conditions,
 * and the pipeline then skips the parallax correction; the audit's simulation
 * (scan-pipeline-audit-2026-10-16, section 3) puts the resulting hand length
 * about 6 mm long. The candidate fix is a nominal focal prior. Nothing changes
 * for the person until that is decided: this module only answers "how far would
 * the number have moved", for the coarse `priorEffect` bucket
 * (src/client/analytics/scanQuality.ts).
 *
 * What it must never do: change a number the person sees or the server gets,
 * or throw into the pipeline. `computeNominalFocalShadow` catches everything
 * and answers `null`; its caller treats `null` as "no shadow value".
 *
 * Not the detector's assumed focal length: that one (`assumedDetectionFocalPx`,
 * a 70 degree horizontal field of view) reads about 42 % low on the video
 * frame path and would bias the hand length about 4 mm short (audit, 3.4). It
 * must not be used here.
 */
import { centrePrincipalPoint } from "./camera-pose";
import type { Homography, Point2 } from "./homography";
import {
  correctLandmarksByHandLength,
  handLengthFromSheetMm,
} from "./measurements";

/**
 * The prior's lens, as a 35 mm equivalent focal length in mm. A phone's main
 * camera is commonly 24 to 28 mm; 26 is the audit's pick. Candidate, not
 * measured on any device.
 */
export const NOMINAL_FOCAL_EQUIV_MM = 26;

/** The diagonal of a 35 mm full frame (36 x 24 mm), the reference of a 35 mm equivalent. Candidate constant of the same prior. */
export const FULL_FRAME_DIAGONAL_MM = 43.27;

/**
 * The prior's focal length in px for a photo of this size: the 35 mm equivalent
 * scaled to the photo's diagonal. `null` for a size that is not positive and
 * finite. `frame` is the whole picture the lens made, as for the EXIF focal
 * length (`analysisFrames().focalFrame`): a crop narrows the picture, not the
 * lens.
 */
export function nominalFocalPx(frame: {
  readonly width: number;
  readonly height: number;
}): number | null {
  const { width, height } = frame;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !(width > 0) ||
    !(height > 0)
  ) {
    return null;
  }
  const fPx =
    (NOMINAL_FOCAL_EQUIV_MM / FULL_FRAME_DIAGONAL_MM) *
    Math.hypot(width, height);
  return Number.isFinite(fPx) && fPx > 0 ? fPx : null;
}

export interface NominalFocalShadowInput {
  /** The 21 landmarks, in the analysed image's pixels. */
  readonly landmarksPx: readonly Point2[];
  /** The sheet's homography (image px to sheet mm) of the same image. */
  readonly homography: Homography;
  /** The whole picture the lens made: sets the prior's focal length. */
  readonly focalFrame: { readonly width: number; readonly height: number };
  /** The analysed image: its centre is the principal point. */
  readonly principalFrame: { readonly width: number; readonly height: number };
  /** The hand length the scan reported, in mm (what the shadow is compared to). */
  readonly reportedHandLengthMm: number;
}

export interface NominalFocalShadow {
  /** The hand length with the prior's focal length, in mm. */
  readonly shadowHandLengthMm: number;
  /** `shadowHandLengthMm` minus the reported hand length: negative when the prior would have read shorter. */
  readonly handLengthDeltaMm: number;
}

/**
 * The shadow hand length and how it differs from the reported one, or `null`
 * when it cannot be worked out (any input that is not a number, a correction
 * that did not settle, any exception). Pure; never throws.
 */
export function computeNominalFocalShadow(
  input: NominalFocalShadowInput,
): NominalFocalShadow | null {
  try {
    const fPx = nominalFocalPx(input.focalFrame);
    if (fPx === null) return null;
    if (!Number.isFinite(input.reportedHandLengthMm)) return null;
    const correction = correctLandmarksByHandLength(
      input.landmarksPx,
      input.homography,
      {
        fPx,
        ...centrePrincipalPoint(
          input.principalFrame.width,
          input.principalFrame.height,
        ),
      },
    );
    if (!correction.converged) return null;
    // The length the contract defines, measured from the corrected points (it
    // is within HAND_LENGTH_SETTLED_MM of `correction.handLengthMm`).
    const shadowHandLengthMm = handLengthFromSheetMm(correction.points);
    const handLengthDeltaMm = shadowHandLengthMm - input.reportedHandLengthMm;
    if (!Number.isFinite(shadowHandLengthMm)) return null;
    if (!Number.isFinite(handLengthDeltaMm)) return null;
    return { shadowHandLengthMm, handLengthDeltaMm };
  } catch {
    return null;
  }
}
