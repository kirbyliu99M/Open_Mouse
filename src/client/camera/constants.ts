/**
 * Live camera capture thresholds (docs/design/camera-capture-2026-09-25/
 * README.md, revised 2026-09-25 for Kirby's plain-paper direction change —
 * see src/client/camera/quad-source.ts's header). Every number here is a
 * **candidate** picked from the spec's own wording, not measured on a real
 * phone yet — the M2 evaluator (scripts/m2-evaluate.ts, run on the learning
 * kit's run logs) is the right way to tune these once Kirby has real-phone
 * footage, the same way GATE_THRESHOLDS in src/client/photo/gates.ts already
 * says of its own values. Keep every live-loop/cue threshold in this one file
 * so a future tuning pass has a single place to look.
 */

import {
  PAPER_SIZES_MM,
  type PaperSize,
} from "../../lib/contracts/measurement";

// Re-exported for existing call sites in this directory; the contract
// (PR #58, merged) is now the single source of truth for both.
export { PAPER_SIZES_MM };
export type { PaperSize };

export const PAPER_SIZE_LABELS: Record<PaperSize, string> = {
  a4: "A4",
  letter: "Letter",
};

export const CAMERA_CONSTANTS = {
  liveLoop: {
    /** Long edge of the downscaled frame the live loop analyses (candidate — spec says "~640 px"). */
    downscaleLongEdgePx: 640,
    /** Live-loop sampling rate cap (candidate — spec says "≤ 8 samples/s"). */
    maxSamplesPerSecond: 8,
  },
  skew: {
    /** Opposite-edge-length ratio must fall in this range (candidate, spec's own numbers). */
    minOppositeEdgeRatio: 0.85,
    maxOppositeEdgeRatio: 1.15,
    /** Corner angle must be within this many degrees of 90° (candidate). */
    maxAngleDeviationDeg: 12,
  },
  size: {
    /**
     * Paper quad width as a fraction of frame width (candidates). V3.3 WP4
     * (Kirby 2026-10-26, candidate 未拍板; F20 design §3.2): the auto-capture
     * range is 0.55-0.85 (was 0.55-0.95), for everyone. The top came down so
     * the paper corners and the fingers stay clear of the picture's edge;
     * the scale itself hardly depends on the distance (模擬). WP2's real
     * scans may narrow it further.
     */
    minWidthFraction: 0.55,
    maxWidthFraction: 0.85,
    /**
     * V3.3 WP4 (candidate, §3.2): a distance cue that is up goes only once
     * the fill is this far back inside the range (too far: shown below 0.55,
     * gone above 0.57; too close: shown above 0.85, gone below 0.83). From
     * inside the range the cue still starts at the bounds themselves.
     * `computeQuadSizeStatusWithHysteresis` (quad.ts).
     */
    hysteresis: 0.02,
  },
  light: {
    /** Mean luma (0-255) floor before "More light, please" (candidate). */
    minMeanLuma: 70,
    /** Per-pixel luma at/above this counts as clipped/blown-out (candidate). */
    clipLumaThreshold: 250,
    /** Fraction of paper-quad pixels clipped before "Too bright" fires (candidate). */
    maxClippedFraction: 0.05,
  },
  noDetection: {
    /**
     * Milliseconds with zero paper corners found before the cue escalates
     * from "Point the camera at the paper" to the more specific
     * "Place a blank sheet on a darker surface" (candidate).
     */
    placePaperTimeoutMs: 2000,
  },
  steadiness: {
    /**
     * Max fraction of the frame diagonal a tracked paper corner may move
     * between consecutive live-loop samples and still count as steady
     * (candidate, spec's own number: "moved > 1.5% of frame diagonal").
     */
    maxCornerMovementFraction: 0.015,
    /**
     * Laplacian-variance floor for the *downscaled* live-loop frame.
     * Deliberately a separate constant from
     * `GATE_THRESHOLDS.minLaplacianVariance` in src/client/photo/gates.ts —
     * that one is tuned for the full-resolution captured photo; this frame
     * is ~640px and heavily JPEG/video-compressed, so its variance is
     * naturally lower for an equally sharp scene (candidate).
     */
    minLiveLaplacianVariance: 15,
  },
  autoCapture: {
    /**
     * Ring-fill duration of passing samples. 800 ms until 2026-10-26; Kirby's
     * S25 test: too quick to react to a hint (a hint needs two readings,
     * ~1 s), and every photo came out under the sharpness floor (28-34
     * against 50). 2.5 s (his 2-4 s), and the sharpest frame of the fill is
     * the one kept (bestFrame.ts). 候選, 未拍板.
     */
    durationMs: 2500,
    /**
     * The photo is the sharpest frame of the ring's last this many ms
     * (bestFrame.ts): after a hint the person may just have moved. 候選.
     */
    bestFrameWindowMs: 1000,
    /** navigator.vibrate() duration on auto-capture (spec: 30 ms). */
    vibrateMs: 30,
    /**
     * Consecutive failed samples that empty the ring (scan v2, candidate). At
     * 8 samples per second one noisy sample used to restart the 800 ms fill,
     * so the ring rarely completed; one or two failures now only pause it.
     */
    maxConsecutiveFailures: 3,
  },
  /**
   * V3.2 F14 (Kirby's phone test of preview 5, 2026-10-22; every number a
   * candidate, 未拍板): the photo is taken without the sheet when the
   * detector cannot find it (a light table) but a hand is held still
   * (`noSheetCapture.ts`). Its analysis then opens the frame adjustment.
   */
  noSheetCapture: {
    /** How long a steady hand with no sheet found is waited for before the photo is taken. */
    waitMs: 4000,
    /**
     * Live samples in a row without a steady hand that empty the wait. The
     * hand is read only every `handSampleIntervalMs` (4 live samples at
     * 8 Hz). One reading that missed the hand costs 4 samples (the next one
     * is compared with the last that found it, `recordHandReading`); one that
     * saw the hand jump and come back costs 8 (it spoils the comparison on
     * both sides). Either only pauses the wait; two readings in a row that
     * missed the hand (12 samples) empty it.
     */
    maxConsecutiveMisses: 9,
    /** The live loop reads the hand at most this often, and only while no sheet is found. */
    handSampleIntervalMs: 500,
    /** A hand reading older than this counts as no hand. */
    handStaleMs: 1200,
    /**
     * A landmark that moved more than this share of the live picture's
     * diagonal between two readings (`handSampleIntervalMs` apart) is not
     * held still (the paper ring allows 0.015 per 125 ms sample).
     */
    maxHandMovementFraction: 0.03,
  },
  /** Still used by the printed-sheet flow (CameraCapture). The easy scan uses `cueDebounce`. */
  cueThrottleMs: 1500,
  /** The easy scan's cue line (scan v2, candidates). */
  cueDebounce: {
    /** Consecutive non-perfect samples before "perfect" is replaced. */
    leavePerfectSamples: 2,
    /** The cue text changes no more often than this, except into "perfect". */
    minTextChangeMs: 500,
    /**
     * Consecutive samples with the SAME paper-gate cue (same reason, same
     * side name) before that cue is put on screen (candidate, 未拍板).
     */
    confirmSamples: 2,
    /**
     * V3.2 F16 (candidate, 未拍板): consecutive samples with the SAME ordinary
     * cue (not a paper-gate one, not "perfect") before it replaces another
     * ordinary cue on screen. Two cues that alternate sample by sample (two
     * conflicting side lines: "tilted" one sample, "too far" the next) used
     * to swap the text every 500 ms; now the text stays. Leaving "perfect"
     * keeps its own rule (`leavePerfectSamples`, any non-perfect codes).
     */
    switchConfirmSamples: 2,
  },
  /** The easy scan's corner dots (scan v2, candidates). */
  corners: {
    /** Exponential low-pass weight of a new sample, per sample. */
    filterAlpha: 0.35,
    /** A corner lost this long eases back to the guide. */
    returnToGuideAfterMs: 1000,
    /** A corner found again within this long of being lost does not pop in again. */
    repopAfterLostMs: 500,
  },
  /**
   * The live outline's hysteresis (V3.2 F16, candidates 未拍板;
   * `outlineHysteresis.ts`). Display only: no gate, cue code or ring reads it.
   */
  outlineHysteresis: {
    /**
     * A sample whose furthest corner is more than this share of the picture's
     * diagonal from the outline on screen is a jump (twice the 0.015 a corner
     * may move between samples and still count as held still).
     */
    jumpFraction: 0.03,
    /** Jumps in a row before the outline follows one (at 8 samples a second, one sample late). */
    switchSamples: 2,
    /** Samples in a row a corner on screen must be missing before its dot goes hollow. */
    lostSamples: 3,
  },
  /**
   * The preview stream's shape (scan v2 field-of-view fix, candidates). The
   * preview used to ask for 1920x1080, which a phone answers with its 16:9
   * video mode; that mode crops the sensor's left and right (in portrait), so
   * the photo from takePhoto() (the whole 4:3 sensor) shows about a third
   * more across than the preview did, and a sheet that filled the preview
   * filled only three quarters of the photo. The preview is now asked for in
   * the shape of the photo (previewConstraints.ts).
   */
  preview: {
    /** Long edge over short edge of the photo when the camera will not say (a 4:3 sensor: nearly every phone). */
    defaultStillAspect: 4 / 3,
    /** The preview's short edge, asked for as an ideal... */
    shortEdgePx: 1080,
    /** ...and never asked for below this. */
    minShortEdgePx: 720,
    /** The preview and the photo differ in field of view once their aspect ratios differ by more than this fraction of the photo's. */
    fovMismatchTolerance: 0.02,
    /**
     * What the preview is asked for while the capture is a frame of the video
     * (`capture.source` "frame"): the camera's own landscape terms, 1920x1080
     * ideal. Chrome on Android reads width and height that way and turns the
     * answer upright (1080x1920 on the S25), which is what it did before the
     * photo-shaped request of #132; that request came back as a 1088x1088 square.
     */
    frameIdealWidth: 1920,
    frameIdealHeight: 1080,
    /**
     * How long the auto-shutter waits for the preview to be asked for the
     * photo's shape (the photo-size question and the size requests together)
     * before it opens anyway and the attempt log notes `settleTimedOut`
     * (candidate). A camera that never answers must not leave the shutter shut.
     */
    settleTimeoutMs: 3000,
  },
  /**
   * What the shutter takes (scan v2 frame capture, candidates). The easy scan
   * analyses a FRAME OF THE VIDEO cut to the part that is on screen (the same
   * rectangle the live detector samples), at the stream's own resolution:
   * those are the pixels the person saw and the detector approved. `takePhoto()`
   * is a different image source with a field of view that can only be guessed
   * from the preview's, and the S25 showed the guess wrong (#132: a square
   * 1088x1088 preview against a 3000x4000 photo; the live view found all four
   * corners, the photo none). `takePhoto` stays in the code, with its crop and
   * its tests, and is off: set `source` to "takePhoto" to bring it back.
   */
  capture: {
    source: "frame",
    /** JPEG quality of the frame handed to the pipeline. */
    jpegQuality: 0.92,
  },
  /**
   * V3.3 WP3 (Kirby 2026-10-26, every number a candidate, 未拍板; F20 design
   * §1.1, §4, appendix B): SOFT HINTS about where the hand lies on the sheet,
   * live while framing (placementHysteresis.ts, `pickCue`) and after the shot
   * (softHintBanner.ts). Hints only: no auto-capture gate, never blocks
   * Continue or a retake, never changes a number. WP2's real scans set the
   * thresholds.
   */
  placement: {
    /**
     * Who sees the hints: "debug-only" = only with `?debug=1` (until WP2 has
     * set the thresholds); "off" = nobody; "on" = everyone. With the hints
     * off the camera is exactly what it was before WP3.
     */
    enabled: "debug-only",
    /** Each live hint on its own (WP1a ruling: straight and flat wait for WP2). */
    live: {
      handMissing: true,
      wristAlign: true,
      handInside: true,
      handStraight: false,
      handFlat: false,
      /**
       * The curl half of 請把手掌壓平 (Kirby's S25 test 2026-10-26: a full
       * curl read 25 mm short and was not caught). On; the palm/hand half
       * (`handFlat`) stays off.
       */
      fingerCurl: true,
    },
    /** Hand readings in a row that fail before a live hint shows (§4.4)... */
    showAfterReadings: 2,
    /** ...and that pass before it goes. */
    clearAfterReadings: 2,
    /**
     * Wrist to its short edge, sheet mm, positive inside. Kirby's S25 tests
     * of 2026-10-26 (實測): "right on the edge" read -3 to +3 mm, "slightly
     * above" +10 to +13 mm, and a wrist ON the edge hid the bottom edge
     * (PAPER_EDGE_HIDDEN, 32.5 % seen). So the target is the wrist just
     * inside the paper: below `showMinMm` 請把手腕移回紙內一點
     * (`wrist-onto-paper`), above `showMaxMm` 請把手腕移到紙的下緣
     * (`wrist-align`); each goes again only within `clearMinMm`-`clearMaxMm`
     * (3 mm bands). 候選.
     */
    wristToEdge: {
      showMinMm: 0,
      showMaxMm: 15,
      clearMinMm: 3,
      clearMaxMm: 12,
    },
    /** Smallest margin of the wrist and fingers to the sides and the far edge (§1.1): shows below 3 mm, goes at 5 mm. */
    sideMargin: { showBelowMm: 3, clearFromMm: 5 },
    /** |hand axis| against the sheet's long side (§1.1): shows above 20°, goes at 17°. */
    handAxis: { showAboveDeg: 20, clearAtDeg: 17 },
    /** Palm over hand length (§2.3): shows outside 0.44-0.56, goes within 0.46-0.54. */
    palmOverHand: {
      showMin: 0.44,
      showMax: 0.56,
      clearMin: 0.46,
      clearMax: 0.54,
    },
    /**
     * The fingers' mean distal/proximal ratio (實測 n = 1 each on the photo,
     * 2026-10-26: flat about 0.47, full curl about 0.18): shows below 0.35,
     * goes from 0.40. 候選; the live sample's own values are not measured yet
     * (the log now keeps them).
     */
    fingerRatio: { showBelow: 0.35, clearFrom: 0.4 },
    /**
     * §4.3: while the latest fresh hand reading has the wrist within this
     * many mm of the sheet's bottom edge (either side of it), "the bottom
     * edge is covered" is not said. The auto-capture is not changed by it.
     */
    bottomEdgeWristMm: 20,
    /**
     * The post-shot banner (softHintBanner.ts, softHint.ts's picker). One
     * switch per hint; the ones without banner words yet are off.
     */
    postShot: {
      wristAlign: true,
      handFlat: false,
      /** WP1a ruling 1: today's sharpness floor would fire on most frames (實測 30-50 against 50). */
      blurry: false,
      /** The 3D readings stay record-only until WP2 shows they separate. */
      palmTilt: false,
      fingerFlex: false,
      /** 手掌沒壓平，建議重拍 for curled fingers (softHint.ts `fingerRatioMin`, 2026-10-26). */
      fingerCurl: true,
      handStraight: false,
      handInside: false,
      paperSmall: false,
      /** Used only when `blurry` is on (the photo gate's own LOW_SHARPNESS floor). */
      blurryMinSharpness: 50,
      /** Used only when `palmTilt` is on (推估). */
      palmTiltMaxDeg: 10,
      /** Used only when `fingerFlex` is on (§2.2: arching from about 30°, 模擬). */
      fingerFlexMaxDeg: 30,
    },
  },
  /** Focus (scan v2). */
  focus: {
    /** After a tap's single-shot focus, continuous focus is asked for again. */
    tapRefocusMs: 1200,
  },
} as const;

/**
 * V3.2 F16 (candidate, 未拍板): the parallax correction's safety check
 * (`src/client/geometry/parallaxGuard.ts`). A ratio is the UNCORRECTED length
 * over the corrected one. A correction is refused only when a ratio is
 * outside the first three limits AND its focal length is not backed by the
 * photo (`focalAgreement`). The ratios alone are not enough: for a camera
 * close to overhead a right correction reads a little above 1, but tilted far
 * it does not (模擬, tests/unit/parallax-guard.test.ts, 1080x1920, the
 * camera's true focal length, 450 mm: towards the wrist 0.988 at 30 degrees,
 * 0.980 at 35, 0.971 at 40; towards the fingertips 1.105 at 40).
 *
 * - `minLengthRatio` 0.99 (hand length, palm length): Kirby's eight measured
 *   scans (實測, 2026-10-23) put the ratio at 1.018-1.056; R7's simulation
 *   (模擬, review/R7/c.out.txt) at 1.018-1.080. The 1 % is room for noise.
 * - `minWidthRatio` 0.985 (palm width): the lowest measured width ratio is
 *   0.990 (實測, given to three decimals), so the width floor sits half a
 *   percent below it rather than on it.
 * - `maxRatio` 1.10 (all three): the largest simulated ratio in R7 is 1.080
 *   (palm length, a 3000x4000 photo with the sheet filling 0.8 of it, a
 *   210 mm hand); the largest measured one 1.058. Corners placed 60 px inside
 *   the sheet's on one edge read 1.107-1.114 on the palm width in the F16
 *   simulation (模擬), and no focal estimate can be worked out from them.
 * - `focalAgreement` 0.85-1.4 (the sheet homography's own focal estimate over
 *   the focal length used; EXIF is always backed). In the F16 simulation
 *   (模擬, 1080x1920, 350 and 450 mm, tilted 0-40 degrees towards the wrist,
 *   the fingertips or the side, no EXIF so the nominal focal length is used,
 *   the true one 0.62-1.3 times it), over the scans the ratios alone refuse:
 *   an estimate 0.8 times the one used gave a corrected hand 5 to 13 mm too
 *   long against an uncorrected one within 5.4 mm (refusing is right); 0.9
 *   times, +3 to +6 mm against -1 to -5 mm (about the same either way);
 *   1.1-1.3 times, -6 to +7.4 mm against +7.6 to +20 mm (using it is right,
 *   or no worse). The 0.85 sits between 0.8 and 0.9 and is not tuned
 *   further (不確定 where exactly the crossover is); the 1.4 is the prior
 *   range's top (`FOCAL_PRIOR_RANGE`), not simulated beyond 1.3. Kirby's
 *   failing scan: 894 / 1442 = 0.62, not backed (under the 26 mm prior;
 *   with F17's 998 px prior the same estimate, 0.90 of it, is inside the
 *   prior range and is used itself, so the guard is not reached, 模擬 in
 *   tests/unit/parallax-guard.test.ts). The estimate is used
 *   whether or not focal-from-homography.ts flags it `reliable`: a camera
 *   tilted straight back gives it from one formula only and is flagged
 *   unreliable, yet in the simulation its value is right.
 *
 * Kirby's failing scan (實測) was 0.904 / 0.931 / 1.094: refused on the hand
 * length. None of these is a gate on the photo: a refused correction only
 * means the scan is measured as if uncorrected.
 */
export const PARALLAX_GUARD = {
  minLengthRatio: 0.99,
  minWidthRatio: 0.985,
  maxRatio: 1.1,
  focalAgreement: { min: 0.85, max: 1.4 },
} as const;

export type CaptureSource = "frame" | "takePhoto";

/** What the shutter takes (`CAMERA_CONSTANTS.capture.source`), typed as the choice it is. */
export function captureSource(): CaptureSource {
  return CAMERA_CONSTANTS.capture.source as CaptureSource;
}
