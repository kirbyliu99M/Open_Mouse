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
    /** Paper quad width as a fraction of frame width (candidates). */
    minWidthFraction: 0.55,
    maxWidthFraction: 0.95,
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
    /** Ring-fill duration of passing samples (spec: 800 ms, not a candidate). */
    durationMs: 800,
    /** navigator.vibrate() duration on auto-capture (spec: 30 ms). */
    vibrateMs: 30,
    /**
     * Consecutive failed samples that empty the ring (scan v2, candidate). At
     * 8 samples per second one noisy sample used to restart the 800 ms fill,
     * so the ring rarely completed; one or two failures now only pause it.
     */
    maxConsecutiveFailures: 3,
  },
  /** Still used by the printed-sheet flow (CameraCapture). The easy scan uses `cueDebounce`. */
  cueThrottleMs: 1500,
  /** The easy scan's cue line (scan v2, candidates). */
  cueDebounce: {
    /** Consecutive non-perfect samples before "perfect" is replaced. */
    leavePerfectSamples: 2,
    /** The cue text changes no more often than this, except into "perfect". */
    minTextChangeMs: 500,
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
  /** Focus (scan v2). */
  focus: {
    /** Preview stream size the camera is asked for; the photo still comes from takePhoto. */
    previewIdealWidth: 1920,
    previewIdealHeight: 1080,
    /** After a tap's single-shot focus, continuous focus is asked for again. */
    tapRefocusMs: 1200,
  },
} as const;
