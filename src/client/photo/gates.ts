/**
 * Per-photo quality gates (docs/PLAN.md §M2, issue #10 step 6). Pure
 * functions only — every gate takes plain numbers/points already computed
 * elsewhere (markers.ts, landmarks.ts, card.ts, sharpness.ts,
 * client/geometry/*) and returns either `null` (pass) or a `GateFailure`
 * with one plain-language retake instruction, per
 * docs/design-guidelines.md's "errors are specific and actionable, one
 * instruction each" rule.
 *
 * Sharpness is the one exception: docs/design-guidelines.md classifies low
 * sharpness as a *warning* ("usable, but e.g. low sharpness"), not a
 * retake-blocking error, so `checkSharpness` and `runPhotoGates` surface it
 * separately from the blocking `errors` list.
 */
import {
  SHEET,
  MAX_SCALE_DISAGREEMENT,
  PAPER_EDGE_LIMITS,
} from "../../lib/contracts/measurement";
import type { Point2 } from "../geometry/homography";
import type { SheetLayout } from "../sheet/layout";

export type GateFailureCode =
  | "MARKERS_MISSING"
  | "HAND_NOT_DETECTED"
  | "HANDEDNESS_MISMATCH"
  | "LOW_LANDMARK_CONFIDENCE"
  | "HAND_OUT_OF_BOUNDS"
  | "REPROJECTION_ERROR"
  | "CARD_SCALE_MISMATCH"
  | "LOW_SHARPNESS"
  | "PAPER_NOT_FOUND"
  | "PAPER_CORNER_HIDDEN"
  | "PAPER_EDGE_HIDDEN"
  | "PAPER_CURLED";

export interface GateFailure {
  readonly code: GateFailureCode;
  /** One plain-language sentence naming the problem and the fix. */
  readonly message: string;
}

export const GATE_THRESHOLDS = {
  /** Also the lens-distortion check (docs/PLAN.md §M2). */
  maxReprojectionErrorMm: 1.0,
  /** MediaPipe's own default is 0.5; we hold a stricter bar for accuracy. */
  minLandmarkConfidence: 0.7,
  /** Margin around the flat markers' bounding box, sheet mm. */
  sheetBoundsMarginMm: 100,
  /**
   * Laplacian-variance floor below which a photo is flagged as blurry.
   * Heuristic starting point (BT.601 luma, full downscaled frame); M2's
   * gate-replay harness (scripts/m2-gate-replay.ts) against Kirby's ground
   * truth photos is what should tune this for real.
   */
  minLaplacianVariance: 50,
  cardScaleDisagreement: MAX_SCALE_DISAGREEMENT,
} as const;

// ── Individual gates ─────────────────────────────────────────────────────

function formatIdList(ids: readonly number[]): string {
  if (ids.length === 1) return `Marker ${ids[0]}`;
  if (ids.length === 2) return `Markers ${ids[0]} and ${ids[1]}`;
  return `Markers ${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

/** All 4 flat-flap markers (ids 0–3) must be found, exactly once each. */
export function checkMarkers(
  detectedIds: readonly number[],
): GateFailure | null {
  const found = new Set(detectedIds);
  const missing = (SHEET.flatMarkerIds as readonly number[]).filter(
    (id) => !found.has(id),
  );
  if (missing.length === 0) return null;
  const isAre = missing.length === 1 ? "is" : "are";
  return {
    code: "MARKERS_MISSING",
    message: `${formatIdList(missing)} ${isAre} hidden — keep all four corner squares visible.`,
  };
}

/** MediaPipe found no hand at all in the photo. */
export function checkHandDetected(landmarkCount: number): GateFailure | null {
  if (landmarkCount > 0) return null;
  return {
    code: "HAND_NOT_DETECTED",
    message:
      "We couldn't find a hand in this photo — lay your hand flat on the sheet, fingers together, and retake.",
  };
}

/** The hand the picker says vs. the hand MediaPipe actually saw. */
export function checkHandedness(
  detected: "left" | "right",
  stated: "left" | "right" | undefined,
  fixInstruction = "change the hand picker",
): GateFailure | null {
  if (stated === undefined || detected === stated) return null;
  return {
    code: "HANDEDNESS_MISMATCH",
    message: `This looks like your ${detected} hand, but you selected ${stated}. Retake with your ${stated} hand, or ${fixInstruction}.`,
  };
}

export function checkLandmarkConfidence(
  confidence: number,
  threshold: number = GATE_THRESHOLDS.minLandmarkConfidence,
): GateFailure | null {
  if (confidence >= threshold) return null;
  return {
    code: "LOW_LANDMARK_CONFIDENCE",
    message:
      "The hand wasn't detected clearly enough — retake in brighter, even light with your whole hand flat on the sheet.",
  };
}

/** Bounding box of the 4 flat markers' 16 corners, in sheet mm. */
export function computeFlatMarkerBoundsMm(layout: SheetLayout): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const flatIds = new Set<number>(SHEET.flatMarkerIds as readonly number[]);
  const corners = layout.markers
    .filter((m) => flatIds.has(m.id))
    .flatMap((m) => m.corners);
  if (corners.length === 0) {
    throw new RangeError(
      "computeFlatMarkerBoundsMm: layout has no flat-flap markers.",
    );
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * All 21 landmarks (already projected to sheet mm) must fall inside the
 * flat markers' bounding box, expanded by a margin — catches a hand that's
 * only partially in frame or a homography gone wrong, while still allowing
 * the hand to extend past the printed markers onto the table (the sheet
 * lies on the table, and the homography's plane is the table surface).
 */
export function checkHandInBounds(
  landmarksMm: readonly Point2[],
  flatMarkerCornersMm: readonly Point2[],
  marginMm: number = GATE_THRESHOLDS.sheetBoundsMarginMm,
): GateFailure | null {
  if (flatMarkerCornersMm.length === 0) {
    throw new RangeError("checkHandInBounds needs at least one marker corner.");
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of flatMarkerCornersMm) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  const bounds = {
    minX: minX - marginMm,
    minY: minY - marginMm,
    maxX: maxX + marginMm,
    maxY: maxY + marginMm,
  };
  const outOfBounds = landmarksMm.some(
    (p) =>
      p.x < bounds.minX ||
      p.x > bounds.maxX ||
      p.y < bounds.minY ||
      p.y > bounds.maxY,
  );
  if (!outOfBounds) return null;
  return {
    code: "HAND_OUT_OF_BOUNDS",
    message:
      "Part of your hand is outside the sheet — make sure your whole hand and the sheet are both fully in frame.",
  };
}

export function checkReprojectionError(
  errorMm: number,
  threshold: number = GATE_THRESHOLDS.maxReprojectionErrorMm,
): GateFailure | null {
  if (errorMm < threshold) return null;
  return {
    code: "REPROJECTION_ERROR",
    message:
      "The sheet looks warped or the camera is at an angle — flatten the sheet, shoot from directly above with your phone's main (1×) camera.",
  };
}

export function checkCardScale(
  ratio: number,
  maxDisagreement: number = GATE_THRESHOLDS.cardScaleDisagreement,
): GateFailure | null {
  if (Math.abs(ratio - 1) <= maxDisagreement) return null;
  return {
    code: "CARD_SCALE_MISMATCH",
    message:
      'Your printer scaled the page — reprint the sheet at 100% / actual size (turn off "fit to page").',
  };
}

// ── Paper-edge gates (plain-paper calibration, no printed markers) ──────

/**
 * `detectPaperQuad` never even located a plausible paper-sized rectangle
 * (`paperRegionFound: false` — see that field's own doc comment). Keyed
 * off `paperRegionFound`, NOT `cornersSeen === 0`: heavy occlusion (e.g.
 * fingers covering the whole top edge) can genuinely find the paper
 * (`paperRegionFound: true`) while still failing to fit any individual
 * side, and that case is `checkPaperCornersSeen`'s "a corner/edge is
 * hidden" — a materially different, more specific and more actionable
 * message than "we couldn't find a sheet of paper at all" (2026-09-25 PR
 * #59 review, M2).
 */
export function checkPaperFound(paperRegionFound: boolean): GateFailure | null {
  if (paperRegionFound) return null;
  return {
    code: "PAPER_NOT_FOUND",
    message:
      "We couldn't find a sheet of paper in this photo — place a blank A4 (or Letter) sheet flat on a plain, contrasting surface and retake.",
  };
}

/**
 * The paper itself was found, but fewer than all 4 corners were — some
 * side(s) couldn't be fit, whether from 0 up to 3 corners actually seen
 * (`checkPaperFound` already covers "no paper region located at all").
 * Usually means part of the sheet is out of frame or a hand/fingers cover
 * a whole edge.
 */
export function checkPaperCornersSeen(
  cornersSeen: 0 | 1 | 2 | 3 | 4,
): GateFailure | null {
  if (cornersSeen === 4) return null;
  return {
    code: "PAPER_CORNER_HIDDEN",
    message:
      "A corner or edge of the paper is hidden — move back, reposition so the whole sheet is visible corner to corner, and keep your hand clear of the edges.",
  };
}

export function checkPaperEdgeCoverage(
  minSideCoverage: number,
  threshold: number = PAPER_EDGE_LIMITS.minSideCoverage,
): GateFailure | null {
  if (minSideCoverage >= threshold) return null;
  return {
    code: "PAPER_EDGE_HIDDEN",
    message:
      "Too much of one edge of the paper is covered — move your hand so more of the sheet's edges are visible, then retake.",
  };
}

export function checkPaperCurled(
  edgeFitResidualMm: number,
  threshold: number = PAPER_EDGE_LIMITS.maxEdgeFitResidualMm,
): GateFailure | null {
  if (edgeFitResidualMm <= threshold) return null;
  return {
    code: "PAPER_CURLED",
    message:
      "The paper doesn't look flat — smooth it out on a hard surface (no curls, folds or lifted corners) and retake.",
  };
}

/** Warning, not a blocking error — see the module doc comment. */
export function checkSharpness(
  laplacianVariance: number,
  threshold: number = GATE_THRESHOLDS.minLaplacianVariance,
): GateFailure | null {
  if (laplacianVariance >= threshold) return null;
  return {
    code: "LOW_SHARPNESS",
    message:
      "This photo looks a little blurry, which may reduce accuracy. You can continue, or retake for a sharper shot.",
  };
}

// ── Aggregate ─────────────────────────────────────────────────────────────

export interface PhotoGateInput {
  readonly detectedMarkerIds: readonly number[];
  readonly landmarkCount: number;
  readonly handedness: "left" | "right" | null;
  readonly handStated: "left" | "right" | undefined;
  readonly landmarkConfidence: number;
  readonly landmarksMm: readonly Point2[];
  readonly flatMarkerCornersMm: readonly Point2[];
  readonly reprojectionErrorMm: number;
  readonly cardScaleRatio: number;
  readonly laplacianVariance: number;
}

export interface PhotoGateReport {
  /** Every blocking failure found, in the order the checks ran. */
  readonly errors: readonly GateFailure[];
  /** Non-blocking issues (currently just sharpness). */
  readonly warnings: readonly GateFailure[];
  readonly ok: boolean;
}

/**
 * Runs every gate in a fixed order and short-circuits the ones that need
 * data an earlier failure means we don't have yet (markers before
 * homography-derived checks, a detected hand before handedness/confidence).
 * Still returns every independently-checkable failure, not just the first,
 * so the UI (or a test) can see the whole picture.
 */
export function runPhotoGates(input: PhotoGateInput): PhotoGateReport {
  const errors: GateFailure[] = [];

  const markerFailure = checkMarkers(input.detectedMarkerIds);
  if (markerFailure) errors.push(markerFailure);

  const handDetectedFailure = checkHandDetected(input.landmarkCount);
  if (handDetectedFailure) {
    errors.push(handDetectedFailure);
  } else {
    if (input.handedness) {
      const handednessFailure = checkHandedness(
        input.handedness,
        input.handStated,
      );
      if (handednessFailure) errors.push(handednessFailure);
    } else {
      errors.push(checkLandmarkConfidence(0)!);
    }
    if (input.handedness) {
      const confidenceFailure = checkLandmarkConfidence(
        input.landmarkConfidence,
      );
      if (confidenceFailure) errors.push(confidenceFailure);
    }
  }

  if (!markerFailure) {
    if (!handDetectedFailure) {
      const boundsFailure = checkHandInBounds(
        input.landmarksMm,
        input.flatMarkerCornersMm,
      );
      if (boundsFailure) errors.push(boundsFailure);
    }
    const reprojectionFailure = checkReprojectionError(
      input.reprojectionErrorMm,
    );
    if (reprojectionFailure) errors.push(reprojectionFailure);
    const cardFailure = checkCardScale(input.cardScaleRatio);
    if (cardFailure) errors.push(cardFailure);
  }

  const warnings: GateFailure[] = [];
  const sharpnessFailure = checkSharpness(input.laplacianVariance);
  if (sharpnessFailure) warnings.push(sharpnessFailure);

  return { errors, warnings, ok: errors.length === 0 };
}

// ── Aggregate — paper-edge (plain-paper) calibration ─────────────────────

export interface PaperEdgeGateInput {
  readonly cornersSeen: 0 | 1 | 2 | 3 | 4;
  /** `detectPaperQuad`'s own `paperRegionFound` — see that field's doc comment and `checkPaperFound`. */
  readonly paperRegionFound: boolean;
  /** `detectPaperQuad`'s coverage metric, 0–1. */
  readonly minSideCoverage: number;
  /** `detectPaperQuad`'s residual, already converted to sheet mm. */
  readonly edgeFitResidualMm: number;
  readonly landmarkCount: number;
  readonly handedness: "left" | "right" | null;
  readonly handStated: "left" | "right" | undefined;
  readonly landmarkConfidence: number;
  readonly landmarksMm: readonly Point2[];
  /** The paper's own 4 corners in sheet mm (0,0)–(w,h) — the bounds `checkHandInBounds` checks against. */
  readonly paperCornersMm: readonly Point2[];
  readonly laplacianVariance: number;
}

export interface PaperEdgeOnlyGateInput {
  readonly paperRegionFound: boolean;
  readonly cornersSeen: 0 | 1 | 2 | 3 | 4;
  readonly minSideCoverage: number;
  readonly edgeFitResidualMm: number;
}

export interface PaperEdgeOnlyGateResult {
  readonly errors: readonly GateFailure[];
}

/**
 * Just the 4 paper-specific checks (found / all corners seen / edge
 * coverage / curled) — no hand data needed at all. Factored out so
 * `src/client/paper/calibration.ts`'s pure, directly-tested
 * `evaluatePaperEdgeCalibration` and `runPaperEdgeGates` below share a
 * single implementation instead of the same 4 lines living in two places
 * (2026-09-25 PR #59 review: `runPaperEdgePipeline`'s geometry → gates →
 * calibration chain had no direct test at all — hard rule 3).
 */
export function checkPaperEdgeGatesOnly(
  input: PaperEdgeOnlyGateInput,
): PaperEdgeOnlyGateResult {
  const errors: GateFailure[] = [];
  const paperFoundFailure = checkPaperFound(input.paperRegionFound);
  if (paperFoundFailure) {
    errors.push(paperFoundFailure);
  } else {
    const cornerFailure = checkPaperCornersSeen(input.cornersSeen);
    if (cornerFailure) errors.push(cornerFailure);
    const coverageFailure = checkPaperEdgeCoverage(input.minSideCoverage);
    if (coverageFailure) errors.push(coverageFailure);
    const curledFailure = checkPaperCurled(input.edgeFitResidualMm);
    if (curledFailure) errors.push(curledFailure);
  }
  return { errors };
}

/**
 * Same shape and intent as `runPhotoGates`, for the paper-edge
 * calibration path: paper-specific checks (found / all corners seen /
 * edge coverage / curled — `checkPaperEdgeGatesOnly` above) replace the
 * marker/reprojection/card checks, while the hand checks
 * (`checkHandDetected`, `checkHandedness`, `checkLandmarkConfidence`,
 * `checkHandInBounds`) and the sharpness warning are the exact same
 * functions `runPhotoGates` uses — a hand is a hand regardless of how the
 * sheet was calibrated.
 */
export function runPaperEdgeGates(input: PaperEdgeGateInput): PhotoGateReport {
  const { errors: paperErrors } = checkPaperEdgeGatesOnly(input);
  const hand = runPaperEdgeHandGates({
    ...input,
    paperFound: !checkPaperFound(input.paperRegionFound),
  });
  const errors = [...paperErrors, ...hand.errors];
  return { errors, warnings: hand.warnings, ok: errors.length === 0 };
}

export interface PaperEdgeHandGateInput {
  /** Whether a paper region was found at all (bounds only apply then). */
  readonly paperFound: boolean;
  readonly landmarkCount: number;
  readonly handedness: "left" | "right" | null;
  readonly handStated: "left" | "right" | undefined;
  readonly handednessFixInstruction?: string;
  readonly landmarkConfidence: number;
  readonly landmarksMm: readonly Point2[];
  readonly paperCornersMm: readonly Point2[];
  readonly laplacianVariance: number;
}

/**
 * The hand half of `runPaperEdgeGates` on its own, so the pipeline can run
 * the paper half exactly once (through `evaluatePaperEdgeCalibration`) and
 * add these — no paper check is evaluated twice.
 */
export function runPaperEdgeHandGates(
  input: PaperEdgeHandGateInput,
): PhotoGateReport {
  const errors: GateFailure[] = [];
  const handDetectedFailure = checkHandDetected(input.landmarkCount);
  if (handDetectedFailure) {
    errors.push(handDetectedFailure);
  } else {
    if (input.handedness) {
      const handednessFailure = checkHandedness(
        input.handedness,
        input.handStated,
        input.handednessFixInstruction,
      );
      if (handednessFailure) errors.push(handednessFailure);
    } else {
      errors.push(checkLandmarkConfidence(0)!);
    }
    if (input.handedness) {
      const confidenceFailure = checkLandmarkConfidence(
        input.landmarkConfidence,
      );
      if (confidenceFailure) errors.push(confidenceFailure);
    }
    if (input.paperFound && input.paperCornersMm.length > 0) {
      const boundsFailure = checkHandInBounds(
        input.landmarksMm,
        input.paperCornersMm,
      );
      if (boundsFailure) errors.push(boundsFailure);
    }
  }

  const warnings: GateFailure[] = [];
  const sharpnessFailure = checkSharpness(input.laplacianVariance);
  if (sharpnessFailure) warnings.push(sharpnessFailure);

  return { errors, warnings, ok: errors.length === 0 };
}
