/**
 * The live preview's paper gate: the SAME gate the photo is judged by after
 * the shutter, run on the detection the live loop already has.
 *
 * Before this, the preview never read `minSideCoverage` or the edge residual,
 * so it could say "perfect" and fire the shutter on a frame the photo
 * analysis then rejects (`PAPER_EDGE_HIDDEN`, `PAPER_CURLED`). Here the live
 * loop calls `evaluatePaperEdgeCalibration` (src/client/paper/calibration.ts,
 * the very function `photo/pipeline.ts` calls) on the detection it already
 * has: no second detector run, no second set of thresholds (they live in
 * `PAPER_EDGE_LIMITS`, a contract), nothing about the measurement changes.
 *
 * Pure. `parallaxCorrected` is the one argument the paper gates never read,
 * so passing `false` here is not a different gate from the photo's.
 */
import {
  evaluatePaperEdgeCalibration,
  type PaperEdgeCalibrationResult,
} from "../paper/calibration";
import type { SheetQuadDetection } from "../paper/detect";
import type { PaperSize } from "../../lib/contracts/measurement";
import type { Point2 } from "../geometry/homography";

/** A side of the paper as the user sees it on the screen. */
export type PaperSide = "top" | "bottom" | "left" | "right";

export type LivePaperGate =
  /** Every paper gate the photo applies passed. */
  | { readonly kind: "pass" }
  /** Fewer than four corners: the corner cues speak first, there is nothing to judge yet. */
  | { readonly kind: "not-evaluated" }
  /** Too little of an edge is seen (`PAPER_EDGE_HIDDEN`). `side` is `null` when no name can be trusted. */
  | { readonly kind: "edge-covered"; readonly side: PaperSide | null }
  /** The edges do not fit a flat sheet (`PAPER_CURLED`). */
  | { readonly kind: "curled" }
  /** The calibration refused the paper for a reason this module has no words for (cannot happen with four corners today); never a pass. */
  | { readonly kind: "blocked" };

/**
 * How much larger one axis of a side's offset from the quad centre must be
 * than the other before the side gets a name. 1.5 is a paper turned up to
 * about 34 degrees in the frame; beyond that "top" or "left" would be a
 * guess, and the cue falls back to the plain "an edge" words.
 */
export const SIDE_NAME_MIN_DOMINANCE = 1.5;

/**
 * Which side of the screen the side `sideIndex` (the segment from
 * `corners[i]` to `corners[i + 1]`, the numbering `detectPaperQuad` and
 * `computePaperEdgeGeometry` use) lies on, or `null` when the quad is turned
 * too far for a plain name. Screen directions: the frame is the rear
 * camera's, shown unmirrored.
 */
export function screenSideOfPaperSide(
  corners: readonly [Point2, Point2, Point2, Point2],
  sideIndex: 0 | 1 | 2 | 3,
): PaperSide | null {
  const a = corners[sideIndex];
  const b = corners[(sideIndex + 1) % 4];
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const dx = (a.x + b.x) / 2 - cx;
  const dy = (a.y + b.y) / 2 - cy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= SIDE_NAME_MIN_DOMINANCE * ay && ax > 0) {
    return dx < 0 ? "left" : "right";
  }
  if (ay >= SIDE_NAME_MIN_DOMINANCE * ax && ay > 0) {
    return dy < 0 ? "top" : "bottom";
  }
  return null;
}

/**
 * The verdict for a live detection, from the photo's own calibration result.
 * `result` is injectable only so a test can prove both paths read one
 * verdict; the live loop passes nothing.
 */
export function evaluateLivePaperGate(
  detection: SheetQuadDetection,
  paperSize: PaperSize,
  result: PaperEdgeCalibrationResult = evaluatePaperEdgeCalibration(
    detection,
    paperSize,
    false,
  ),
): LivePaperGate {
  if (!detection.corners || detection.cornersSeen < 4) {
    return { kind: "not-evaluated" };
  }
  if (result.ok) return { kind: "pass" };
  // Covered edge first: it is the one the user can act on at once, and a
  // curl residual measured on a half-hidden edge says little.
  if (result.errors.some((error) => error.code === "PAPER_EDGE_HIDDEN")) {
    const index = detection.minCoverageSideIndex;
    const side =
      index === undefined || index === null
        ? null
        : screenSideOfPaperSide(detection.corners, index);
    return { kind: "edge-covered", side };
  }
  if (result.errors.some((error) => error.code === "PAPER_CURLED")) {
    return { kind: "curled" };
  }
  // Any other paper failure with all four corners present would be a gate
  // this module does not know; do not claim a pass for it.
  return { kind: "blocked" };
}
