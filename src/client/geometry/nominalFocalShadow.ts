/**
 * landmark-raw-v3 (V3.2 candidate, 未拍板; Kirby 2026-10-22, design R7): the
 * nominal focal prior below (`nominalFocalPxFromLongEdge`) is now the
 * correction a photo gets when it has no EXIF and no trustworthy homography
 * estimate (parallax.ts `resolveFocalPx`). The shadow therefore turns round:
 * `computeUncorrectedShadow` works out the UNCORRECTED numbers beside the
 * reported ones, for the local attempt log (Kirby's S25 check, design §5.3)
 * and the coarse `priorEffect` bucket. `computeNominalFocalShadow` stays as
 * the pre-v3 shadow, a pure function the tests use to show that the v3 report
 * is the hand length it predicted (design §5.2).
 *
 * The pre-v3 note follows.
 *
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
import { estimateFocalFromHomography } from "./focal-from-homography";
import type { Homography, Point2 } from "./homography";
import {
  computeHandMeasurements,
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
 * The sensor shape the equivalent is taken on: 4 : 3, whose diagonal is 5/4 of
 * its long edge. A candidate assumption of the same prior.
 */
export const SENSOR_DIAGONAL_OVER_LONG_EDGE = 5 / 4;

/**
 * The prior's focal length in px for a camera frame whose LONG edge is
 * `longEdgePx` (landmark-raw-v3, candidate 未拍板; design R7 §1.2): the 35 mm
 * equivalent over the 35 mm diagonal, scaled to the diagonal of a 4 : 3
 * sensor with that long edge, `26 / 43.27 x 1.25 x longEdgePx`, about
 * 0.751 x the long edge (1442 px for 1920). The long edge is the WHOLE camera
 * frame's: a frame of the video cut to the part on screen keeps the stream's
 * long edge (`frameFocalReferenceLongEdgePx`, visibleView.ts), because a cut
 * narrows the picture, not the lens. `null` for a length that is not finite
 * and above zero.
 */
export function nominalFocalPxFromLongEdge(longEdgePx: number): number | null {
  if (!Number.isFinite(longEdgePx) || !(longEdgePx > 0)) return null;
  const fPx =
    (NOMINAL_FOCAL_EQUIV_MM / FULL_FRAME_DIAGONAL_MM) *
    SENSOR_DIAGONAL_OVER_LONG_EDGE *
    longEdgePx;
  return Number.isFinite(fPx) && fPx > 0 ? fPx : null;
}

/**
 * The prior's focal length in px for a photo of this size: the 35 mm equivalent
 * over the 35 mm diagonal, scaled to the diagonal of a 4 : 3 sensor whose long
 * edge is the photo's long edge (`nominalFocalPxFromLongEdge` of
 * `max(width, height)`). For a 4 : 3 photo that is the photo's own
 * diagonal (the same as the EXIF rule). It is taken on the LONG edge, not on
 * the diagonal of the picture, because the live video frame is the sensor cut
 * on its short side: a 1080 x 1920 stream, and the 887 x 1920 part of it that
 * is on screen, share one long edge and one lens, and a diagonal would read
 * 8 to 12 % low on them (independent review, 2026-10-16). A frame cut on its
 * LONG side must not use this: its own long edge is short of the stream's
 * (design R7 §1.3); the pipeline passes the stream's instead. `null` for a
 * size that is not positive and finite.
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
  return nominalFocalPxFromLongEdge(Math.max(width, height));
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

/** The three lengths the engine scale (`FIT_SCALE_FROM_CORRECTED`) is about, mm. */
export interface ShadowLengths {
  readonly handLengthMm: number;
  readonly palmLengthMm: number;
  readonly palmWidthMm: number;
}

export interface UncorrectedShadowInput {
  /** The 21 landmarks, in the analysed image's pixels. */
  readonly landmarksPx: readonly Point2[];
  /** The sheet's homography (image px to sheet mm) of the same image. */
  readonly homography: Homography;
  /** The analysed image: its centre is the principal point of the homography estimate. */
  readonly principalFrame: { readonly width: number; readonly height: number };
  /** What the scan reported (corrected, or not when nothing could correct it), mm. */
  readonly reported: ShadowLengths;
}

export interface UncorrectedShadow {
  /** The same landmarks projected straight onto the sheet (no parallax correction), mm. */
  readonly uncorrected: ShadowLengths;
  /** Uncorrected minus reported hand length, mm: about +4.7 for a corrected 190 mm hand (simulated). */
  readonly handLengthDeltaMm: number;
  /**
   * The homography's own focal estimate and whether it was judged reliable,
   * whether or not the correction used it; `null` where none could be made.
   */
  readonly homographyFocal: {
    readonly px: number;
    readonly reliable: boolean;
  } | null;
}

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/**
 * The v3 shadow (candidate): the uncorrected lengths of the same landmarks,
 * how far the hand length is from the reported one, and the homography's own
 * focal estimate. Local evidence only (the attempt log; analytics gets the
 * coarse `priorEffect` bucket of the delta and never a length). `null` when
 * the uncorrected lengths cannot be worked out; the homography estimate is
 * `null` on its own when only it fails. Pure; never throws.
 */
export function computeUncorrectedShadow(
  input: UncorrectedShadowInput,
): UncorrectedShadow | null {
  try {
    const m = computeHandMeasurements(input.landmarksPx, input.homography);
    const uncorrected: ShadowLengths = {
      handLengthMm: m.handLengthMm,
      palmLengthMm: m.palmLengthMm,
      palmWidthMm: m.palmWidthMm,
    };
    if (
      !finite(uncorrected.handLengthMm) ||
      !finite(uncorrected.palmLengthMm) ||
      !finite(uncorrected.palmWidthMm) ||
      !finite(input.reported.handLengthMm)
    ) {
      return null;
    }
    const handLengthDeltaMm =
      uncorrected.handLengthMm - input.reported.handLengthMm;
    if (!finite(handLengthDeltaMm)) return null;
    let homographyFocal: UncorrectedShadow["homographyFocal"] = null;
    try {
      const estimate = estimateFocalFromHomography(
        input.homography,
        centrePrincipalPoint(
          input.principalFrame.width,
          input.principalFrame.height,
        ),
      );
      homographyFocal =
        estimate && finite(estimate.fPx)
          ? { px: estimate.fPx, reliable: estimate.reliable }
          : null;
    } catch {
      homographyFocal = null;
    }
    return { uncorrected, handLengthDeltaMm, homographyFocal };
  } catch {
    return null;
  }
}
