/**
 * V3.2 F16 (candidate, 未拍板): the parallax correction's safety check.
 *
 * MediaPipe's landmarks are joint centres a few mm ABOVE the sheet, so seen
 * through the sheet's homography they sit a little further from the point
 * under the camera than they really are. A right correction (parallax.ts) can
 * therefore only pull them in: the corrected hand length, palm length and
 * palm width each come out a little SHORTER than the uncorrected ones (the
 * ratio uncorrected / corrected a little above 1).
 *
 * Kirby's preview-6 scan (實測, 2026-10-23, a hand-placed frame, "後傾") came
 * out the other way: 185.7 mm uncorrected, 205.4 mm corrected. The F16
 * simulation (tests/unit/parallax-guard.test.ts, 模擬) reproduces that pattern
 * whenever the focal length the correction uses is far from the one the
 * sheet's own homography implies (the nominal 1442 px against the estimate's
 * 894 px there): decomposed with the wrong focal length, a homography with a
 * strong perspective gives a wrong camera pose (in the simulation a camera
 * about 175 mm further off to the wrist's side and 115 mm higher than the
 * true one), and the wrist (about 19 mm up) is then pushed away from the
 * fingertip (about 6 mm up) instead of both being pulled in. Whether Kirby's
 * 894 px came from the lens or from the hand-placed corners is not known
 * (不確定); the check does not need to know.
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

/**
 * Whether a parallax correction may be used: every ratio (uncorrected over
 * corrected) finite and above zero, the hand length's and the palm length's
 * at least `minLengthRatio`, the palm width's at least `minWidthRatio`, and
 * none above `maxRatio` (both ends included). The first failure, in the order
 * hand length, palm length, palm width, is the one reported. Pure.
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
