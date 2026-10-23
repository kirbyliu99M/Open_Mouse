/**
 * V3.2 F16 (candidate, 未拍板): the parallax correction's safety check.
 *
 * MediaPipe's landmarks are joint centres a few mm ABOVE the sheet, so seen
 * through the sheet's homography they sit a little further from the point
 * under the camera than they really are, and a correction pulls them in. For
 * a camera close to overhead that makes the corrected hand length, palm
 * length and palm width each a little SHORTER than the uncorrected ones (the
 * ratio uncorrected / corrected a little above 1: Kirby's eight measured
 * scans, 實測, read 1.018-1.056).
 *
 * That is NOT true of every right correction. With the camera tilted far
 * towards the wrist the wrist (about 19 mm up) moves further than the
 * fingertip (about 6 mm up), the uncorrected hand is itself too short, and a
 * correction with the camera's true focal length reads below 1 (模擬, 1080x1920,
 * 450 mm: 0.988 at 30 degrees, 0.980 at 35, 0.971 at 40); tilted far towards
 * the fingertips it reads above 1.10 (1.105 at 40 degrees). So the ratios
 * alone cannot tell a right correction from a wrong one.
 *
 * Kirby's preview-6 scan (實測, 2026-10-23, a hand-placed frame, "後傾") came
 * out 185.7 mm uncorrected, 205.4 mm corrected. The F16 simulation
 * (tests/unit/parallax-guard.test.ts, 模擬) reproduces that pattern whenever
 * the focal length the correction uses is far from the one the sheet's own
 * homography implies (the nominal 1442 px against the estimate's 894 px
 * there): decomposed with the wrong focal length, a homography with a strong
 * perspective gives a wrong camera pose (in the simulation a camera about
 * 175 mm further off to the wrist's side and 115 mm higher than the true one),
 * and the wrist is then pushed away from the fingertip instead of both being
 * pulled in. Whether Kirby's 894 px came from the lens or from the
 * hand-placed corners is not known (不確定). (V3.2 F17 moved the prior to
 * 998 px, from Kirby's measured estimates; the guard is unchanged and still
 * catches any focal length the homography disagrees with.)
 *
 * So a correction is refused only when BOTH hold: a ratio is outside the
 * limits (`judgeParallaxCorrection`), and the focal length it used is not
 * backed by the photo (`focalCorroborated`): not from EXIF, and not within
 * `PARALLAX_GUARD.focalAgreement` of the homography's own estimate (or there
 * is no estimate at all, as for corners placed tens of px off the sheet's).
 *
 * This module does not try to fix that pose. It only recognises a correction
 * that cannot be right (`PARALLAX_GUARD`, constants.ts) so the caller can
 * measure without it, exactly as a scan with no focal length is measured.
 * Pure; it changes no measurement formula.
 */
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { PARALLAX_GUARD } from "../camera/constants";

/** The three lengths the guard reads, mm. */
export type GuardedLengths = Pick<
  HandMeasurements,
  "handLengthMm" | "palmLengthMm" | "palmWidthMm"
>;

/** Uncorrected over corrected, for each of the three lengths. */
export interface ParallaxGuardRatios {
  readonly handLength: number;
  readonly palmLength: number;
  readonly palmWidth: number;
}

/**
 * Why a correction was not used: it made a length LONGER (or a width wider)
 * than the uncorrected one beyond the noise allowance, it shortened one by
 * more than any real parallax does, or a ratio could not be worked out.
 */
export type ParallaxGuardReason =
  "lengthened" | "over_shortened" | "not_finite";

export type ParallaxGuardField = keyof ParallaxGuardRatios;

export type ParallaxGuardVerdict =
  | { readonly accept: true; readonly ratios: ParallaxGuardRatios }
  | {
      readonly accept: false;
      readonly reason: ParallaxGuardReason;
      /** The first length (hand length, palm length, palm width) that failed. */
      readonly field: ParallaxGuardField;
      readonly ratios: ParallaxGuardRatios;
    };

export interface ParallaxGuardLimits {
  readonly minLengthRatio: number;
  readonly minWidthRatio: number;
  readonly maxRatio: number;
}

/** Where the focal length of a correction that ran came from. */
export type CorrectionFocalSource = "exif" | "homography" | "nominal";

export interface FocalAgreementLimits {
  /** The homography's estimate over the focal length used, both ends included. */
  readonly focalAgreement: { readonly min: number; readonly max: number };
}

/**
 * Whether the focal length a correction used is backed by the photo itself,
 * so that a ratio outside the limits is the real geometry of a tilted camera
 * rather than a wrong pose. Pure.
 *
 * - From EXIF: always (the lens's own; the EXIF path is left as it was).
 * - Otherwise: the sheet homography's own focal estimate (`estimatePx`,
 *   focal-from-homography.ts, whether or not it was flagged `reliable`: a
 *   camera tilted straight back or sideways gives only one of its two
 *   formulas and is flagged unreliable, yet its value is right in the
 *   simulation) must exist and be within `focalAgreement` of the one used.
 *   `null` (no estimate could be worked out) is not backed.
 *
 * Consequence (review 2026-10-23, candidate 未拍板): a correction whose focal
 * length came from the same frame's own homography (not reused) is always
 * backed, since `guardCorrection` re-estimates from that same homography
 * (ratio 1); only a reused focal length (a hand-placed frame) or the nominal
 * prior can be refused. Pinned in tests/unit/parallax-guard.test.ts.
 */
export function focalCorroborated(
  source: CorrectionFocalSource,
  usedPx: number,
  estimatePx: number | null,
  limits: FocalAgreementLimits = PARALLAX_GUARD,
): boolean {
  if (source === "exif") return true;
  if (
    estimatePx === null ||
    !Number.isFinite(estimatePx) ||
    !(estimatePx > 0) ||
    !Number.isFinite(usedPx) ||
    !(usedPx > 0)
  )
    return false;
  const ratio = estimatePx / usedPx;
  return (
    ratio >= limits.focalAgreement.min && ratio <= limits.focalAgreement.max
  );
}

/**
 * Whether a parallax correction may be used: every ratio (uncorrected over
 * corrected) finite and above zero, the hand length's and the palm length's
 * at least `minLengthRatio`, the palm width's at least `minWidthRatio`, and
 * none above `maxRatio` (both ends included). The first failure, in the order
 * hand length, palm length, palm width, is the one reported. Pure.
 *
 * Only half of the check: a right correction of a camera tilted 30 degrees or
 * more can fail it (see the top of this file), so the caller refuses a
 * correction only when `focalCorroborated` is false as well
 * (`guardCorrection`, paperEdgeFinish.ts).
 */
export function judgeParallaxCorrection(
  uncorrected: GuardedLengths,
  corrected: GuardedLengths,
  limits: ParallaxGuardLimits = PARALLAX_GUARD,
): ParallaxGuardVerdict {
  const ratios: ParallaxGuardRatios = {
    handLength: uncorrected.handLengthMm / corrected.handLengthMm,
    palmLength: uncorrected.palmLengthMm / corrected.palmLengthMm,
    palmWidth: uncorrected.palmWidthMm / corrected.palmWidthMm,
  };
  const checks: readonly (readonly [ParallaxGuardField, number])[] = [
    ["handLength", limits.minLengthRatio],
    ["palmLength", limits.minLengthRatio],
    ["palmWidth", limits.minWidthRatio],
  ];
  for (const [field, floor] of checks) {
    const ratio = ratios[field];
    if (!Number.isFinite(ratio) || !(ratio > 0))
      return { accept: false, reason: "not_finite", field, ratios };
    if (ratio < floor)
      return { accept: false, reason: "lengthened", field, ratios };
    if (ratio > limits.maxRatio)
      return { accept: false, reason: "over_shortened", field, ratios };
  }
  return { accept: true, ratios };
}
