/**
 * Live camera capture thresholds (docs/design/camera-capture-2026-09-25/
 * README.md, revised 2026-09-25 for Kirby's plain-paper direction change —
 * see src/client/camera/quad-source.ts's header). Every number here is a
 * **candidate** picked from the spec's own wording, not measured on a real
 * phone yet — the M2 gate-replay approach (scripts/m2-gate-replay.ts) is
 * the right way to tune these once Kirby has real-phone footage, the same
 * way GATE_THRESHOLDS in src/client/photo/gates.ts already says of its own
 * values. Keep every live-loop/cue threshold in this one file so a future
 * tuning pass has a single place to look.
 */

/** Mirrors (not yet merged) src/lib/contracts/measurement.ts's PaperSize from
 * PR #58 (branch contracts-paper-edge) — swap this alias for that import
 * once the contract lands. Only used here for display copy and the
 * primer's aspect-ratio preview, never for measurement math. */
export type PaperSize = "a4" | "letter";

/** Mirrors PAPER_SIZES_MM from the same not-yet-merged contract. */
export const PAPER_SIZES_MM: Record<
  PaperSize,
  { width: number; height: number }
> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

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
    /** Ring-fill duration once every check passes continuously (spec: 800 ms, not a candidate). */
    durationMs: 800,
    /** navigator.vibrate() duration on auto-capture (spec: 30 ms). */
    vibrateMs: 30,
  },
  cueThrottleMs: 1500,
} as const;
