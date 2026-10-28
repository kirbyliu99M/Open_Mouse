/**
 * The sheet looked for at a higher resolution (Kirby 2026-10-27, candidate
 * / 未拍板; "a user whose scan fails gives up, so it must work the first
 * time").
 *
 * Kirby's S25 photos: the sheet's left side lay on a lit strip of light wood
 * that the detector took for part of the sheet. At the live sample's 342 px
 * the sheet was never found (`aspect_mismatch`); at 512 px one photo was, at
 * 683 px (a long edge of 1280) both were, with the corners within about
 * 1 px of the full-size photo's. Every live frame at 1280 would cost about
 * 4x the 640 px sample on the main thread, so:
 *
 * - Live (`shouldConfirmHiRes`): while the live sample misses the sheet at a
 *   stage the forearm or a bright neighbour causes, the hand seen, at most
 *   every `intervalMs` one frame at `longEdgePx` goes to the analysis worker
 *   (offMainAnalysis.ts). A sheet it finds with every paper gate passed
 *   (`sheetPasses`) is scaled to the sample (`scaleDetection`) and carried
 *   (sheetCarry.ts), so the ring and the cue go on.
 * - At the shot (`precheckOrder`): the ring's kept full-size frames are
 *   checked sharpest first with the photo's own paper gate, and the first
 *   that passes is the photo. None passes: the sharpest, as before.
 * - The photo's analysis still decides; where it turns the sheet back, the
 *   frame the person adjusts starts on the sheet found here (pipeline
 *   `knownSheetCorners`), not on a rough guess.
 *
 * Pure: the live loop and the shutter keep the state.
 */
import type { Point2 } from "../geometry/homography";
import { evaluatePaperEdgeCalibration } from "../paper/calibration";
import type { PaperSize, SheetQuadDetection } from "../paper/detect";
import { HAND_CUT_STAGES } from "./sheetCarry";

type Quad4 = readonly [Point2, Point2, Point2, Point2];

const scalePoint = (p: Point2, f: number): Point2 => ({
  x: p.x * f,
  y: p.y * f,
});

/** Four corners times `f`. */
export function scaleCorners(corners: Quad4, f: number): Quad4 {
  return [
    scalePoint(corners[0], f),
    scalePoint(corners[1], f),
    scalePoint(corners[2], f),
    scalePoint(corners[3], f),
  ];
}

/** Corners from a picture of `from`'s size to one of `to`'s (the same region at another resolution). */
export function cornersToSize(
  corners: Quad4,
  from: { readonly width: number; readonly height: number },
  to: { readonly width: number; readonly height: number },
): Quad4 {
  const fx = to.width / from.width;
  const fy = to.height / from.height;
  return corners.map((p) => ({ x: p.x * fx, y: p.y * fy })) as unknown as Quad4;
}

/** A detection at another resolution: every pixel figure times `f`. */
export function scaleDetection(
  detection: SheetQuadDetection,
  f: number,
): SheetQuadDetection {
  return {
    ...detection,
    corners: detection.corners ? scaleCorners(detection.corners, f) : null,
    partialCorners: detection.partialCorners.map((p) =>
      p ? scalePoint(p, f) : null,
    ) as unknown as SheetQuadDetection["partialCorners"],
    edgeFitResidualPx: detection.edgeFitResidualPx * f,
    ...(detection.guessCorners
      ? { guessCorners: scaleCorners(detection.guessCorners, f) }
      : {}),
  };
}

/** A sheet with four corners that every paper gate of the photo passes. */
export function sheetPasses(
  detection: SheetQuadDetection,
  paperSize: PaperSize,
): boolean {
  if (!detection.corners || detection.cornersSeen < 4) return false;
  return evaluatePaperEdgeCalibration(detection, paperSize, false).ok;
}

/** Whether the live loop sends this frame to be looked at again at the higher resolution. */
export function shouldConfirmHiRes(input: {
  readonly detection: SheetQuadDetection;
  readonly handSeen: boolean;
  readonly inFlight: boolean;
  readonly lastAtMs: number | null;
  readonly nowMs: number;
  readonly intervalMs: number;
}): boolean {
  const stage = input.detection.failureStage;
  if (input.inFlight || !input.handSeen) return false;
  if (stage === undefined || !HAND_CUT_STAGES.includes(stage)) return false;
  return (
    input.lastAtMs === null || input.nowMs - input.lastAtMs >= input.intervalMs
  );
}

/**
 * The size of the higher-resolution frame for a sample of `sample`: the
 * sample's shape with its long edge at `longEdgePx` (never smaller than the
 * sample), and the factor from it back to the sample.
 */
export function hiResSize(
  sample: { readonly width: number; readonly height: number },
  longEdgePx: number,
): {
  readonly width: number;
  readonly height: number;
  readonly toSample: number;
} {
  const long = Math.max(sample.width, sample.height);
  const k = Math.max(1, longEdgePx / long);
  return {
    width: Math.round(sample.width * k),
    height: Math.round(sample.height * k),
    toSample: sample.width / Math.round(sample.width * k),
  };
}

/** The kept frames' indices, sharpest (full-size score) first; a score that is not a number last. */
export function precheckOrder(scores: readonly number[]): number[] {
  return scores
    .map((s, i) => ({ s: Number.isFinite(s) ? s : -Infinity, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((e) => e.i);
}
