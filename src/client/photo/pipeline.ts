/**
 * Orchestrates the full top-down-photo → `ScanSubmission` pipeline
 * (issue #10 steps 2–7). This module is the glue between the pure pieces
 * (gates.ts, submission.ts, the #9 geometry modules) and the browser-only
 * adapters (decode.ts, markers.ts, card.ts, landmarks.ts) — it is itself
 * impure (Canvas, `ImageBitmap`) and is exercised by `tests/e2e/scan.spec.ts`
 * rather than Vitest.
 */
import { computeSheetLayout } from "../sheet/layout";
import {
  SHEET,
  PAPER_SIZES_MM,
  type PaperSize,
} from "../../lib/contracts/measurement";
import {
  estimateHomography,
  reprojectionErrorMm as computeReprojectionErrorMm,
  applyHomography,
  type Point2,
} from "../geometry/homography";
import {
  computeHandMeasurements,
  computeCorrectedHandMeasurements,
} from "../geometry/measurements";
import {
  computeCardScaleRatio,
  type CardCorners,
} from "../geometry/card-scale";
import { estimateFocalFromExif } from "../geometry/exif-focal";
import { decodePhoto, PhotoDecodeError, HEIC_RETAKE_MESSAGE } from "./decode";
import type { DecodedPhoto } from "./decode";
import {
  detectMarkers,
  buildMarkerCorrespondences,
  type DetectedMarker,
} from "./markers";
import { detectCardCorners } from "./card";
import { detectHandLandmarks } from "./landmarks";
import { rgbaToGrayscale, computeLaplacianVariance } from "./sharpness";
import {
  runPhotoGates,
  runPaperEdgeHandGates,
  checkMarkers,
  checkPaperFound,
  checkPaperCornersSeen,
  type GateFailure,
} from "./gates";
import {
  assembleScanSubmission,
  assemblePaperEdgeSubmission,
} from "./submission";
import { detectPaperQuad } from "../paper/detect";
import { evaluatePaperEdgeCalibration } from "../paper/calibration";
import type {
  HandMeasurements,
  ScanSubmission,
} from "../../lib/contracts/measurement";

export interface PipelineIssue {
  readonly code: string;
  readonly message: string;
}

export interface PhotoOverlay {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly markers: readonly DetectedMarker[];
  readonly card: CardCorners | null;
  readonly landmarksPx: readonly Point2[] | null;
  /**
   * MediaPipe's own handedness for the detected hand, when one was found —
   * `undefined` wherever no hand was ever detected in this photo (existing
   * overlay literals that predate this field). Lets a caller (the easy-scan
   * camera's hand chip) reflect what MediaPipe actually saw without a
   * second detection pass; the printed-sheet and paper-edge gates already
   * compute this value internally, this just also returns it.
   */
  readonly handedness?: "left" | "right" | null;
  /**
   * The detected blank sheet's own 4 corners (TL, TR, BR, BL), in this
   * photo's full-resolution pixel space — paper-edge calibration only.
   * `undefined` for the printed-sheet flow (which draws `markers`/`card`
   * instead) and wherever paper-edge didn't find a quad at all.
   */
  readonly paperCorners?: readonly [Point2, Point2, Point2, Point2] | null;
}

export type PipelineResult =
  | {
      readonly status: "ok";
      readonly measurements: HandMeasurements;
      readonly submission: ScanSubmission;
      readonly warnings: readonly GateFailure[];
      readonly overlay: PhotoOverlay;
    }
  | {
      readonly status: "needsManualCard";
      readonly overlay: PhotoOverlay;
    }
  | {
      readonly status: "error";
      readonly errors: readonly PipelineIssue[];
      readonly overlay: PhotoOverlay;
    };

/**
 * Which calibration reference this photo uses. Omitted (or explicitly
 * `"printed-sheet"`) keeps today's behaviour byte-for-byte — the ArUco
 * flat-flap sheet + bank-card cross-check. `"paper-edge"` (2026-09-25
 * decision, see `src/lib/contracts/measurement.ts`) measures against ANY
 * blank sheet of the given size, found from its own edges
 * (`src/client/paper/detect.ts`) — no printing, no card.
 */
export type CalibrationInput =
  | { readonly method: "printed-sheet" }
  | { readonly method: "paper-edge"; readonly paperSize: PaperSize };

export interface RunPhotoPipelineInput {
  readonly file: File;
  readonly hand: "left" | "right";
  readonly gripStyleStated?: "palm" | "claw" | "fingertip";
  /** A user-dragged correction/override for the card's 4 corners. Printed-sheet only. */
  readonly manualCardCorners?: CardCorners;
  /** Defaults to `{ method: "printed-sheet" }` — every existing caller keeps working unchanged. */
  readonly calibration?: CalibrationInput;
}

function emptyOverlay(width: number, height: number): PhotoOverlay {
  return {
    imageWidth: width,
    imageHeight: height,
    markers: [],
    card: null,
    landmarksPx: null,
  };
}

function getImageData(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2D canvas context is unavailable in this browser.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function runPhotoPipeline(
  input: RunPhotoPipelineInput,
): Promise<PipelineResult> {
  let decoded;
  try {
    decoded = await decodePhoto(input.file);
  } catch (err) {
    const message =
      err instanceof PhotoDecodeError ? err.message : HEIC_RETAKE_MESSAGE;
    return {
      status: "error",
      errors: [{ code: "DECODE_FAILED", message }],
      overlay: emptyOverlay(0, 0),
    };
  }

  const calibration = input.calibration ?? { method: "printed-sheet" };
  if (calibration.method === "paper-edge") {
    return runPaperEdgePipeline(decoded, input, calibration.paperSize);
  }

  const { bitmap, width, height } = decoded;
  const imageData = getImageData(bitmap, width, height);
  const layout = computeSheetLayout();

  const detected = detectMarkers(imageData);
  const { correspondences, missingIds } = buildMarkerCorrespondences(
    detected,
    layout,
  );
  const markerFailure = checkMarkers(detected.map((m) => m.id));
  if (markerFailure || missingIds.length > 0) {
    return {
      status: "error",
      errors: [
        markerFailure ?? {
          code: "MARKERS_MISSING",
          message: "Marker detection failed.",
        },
      ],
      overlay: {
        imageWidth: width,
        imageHeight: height,
        markers: detected,
        card: null,
        landmarksPx: null,
      },
    };
  }

  const homography = estimateHomography(correspondences);
  const reprojectionErrorMm = computeReprojectionErrorMm(
    homography,
    correspondences,
  );

  const cardCorners = input.manualCardCorners ?? detectCardCorners(imageData);
  if (!cardCorners) {
    return {
      status: "needsManualCard",
      overlay: {
        imageWidth: width,
        imageHeight: height,
        markers: detected,
        card: null,
        landmarksPx: null,
      },
    };
  }
  const cardScaleRatio = computeCardScaleRatio(cardCorners, homography);

  const hand = await detectHandLandmarks(bitmap);
  const overlayBase = {
    imageWidth: width,
    imageHeight: height,
    markers: detected,
    card: cardCorners,
  };

  if (!hand) {
    return {
      status: "error",
      errors: [
        {
          code: "HAND_NOT_DETECTED",
          message:
            "We couldn't find a hand in this photo — lay your hand flat on the sheet, fingers together, and retake.",
        },
      ],
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }

  const landmarksMm = hand.landmarksPx.map((p) =>
    applyHomography(homography, p),
  );
  const flatMarkerCornersMm = layout.markers
    .filter((m) => (SHEET.flatMarkerIds as readonly number[]).includes(m.id))
    .flatMap((m) => m.corners);

  const gray = rgbaToGrayscale(imageData.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);

  const report = runPhotoGates({
    detectedMarkerIds: detected.map((m) => m.id),
    landmarkCount: hand.landmarksPx.length,
    handedness: hand.handedness,
    handStated: input.hand,
    landmarkConfidence: hand.confidence,
    landmarksMm,
    flatMarkerCornersMm,
    reprojectionErrorMm,
    cardScaleRatio,
    laplacianVariance,
  });

  if (!report.ok) {
    return {
      status: "error",
      errors: report.errors,
      overlay: {
        ...overlayBase,
        landmarksPx: hand.landmarksPx,
        handedness: hand.handedness,
      },
    };
  }

  let measurements: HandMeasurements;
  try {
    measurements = computeHandMeasurements(hand.landmarksPx, homography);
  } catch {
    return {
      status: "error",
      errors: [
        {
          code: "MEASUREMENT_OUT_OF_RANGE",
          message:
            "These measurements look implausible — retake with your whole hand flat on the sheet and the camera directly overhead.",
        },
      ],
      overlay: {
        ...overlayBase,
        landmarksPx: hand.landmarksPx,
        handedness: hand.handedness,
      },
    };
  }

  const submission = assembleScanSubmission({
    hand: input.hand,
    gripStyleStated: input.gripStyleStated,
    measurements,
    markerIds: detected.map((m) => m.id),
    reprojectionErrorMm,
    cardScaleRatio,
  });

  return {
    status: "ok",
    measurements,
    submission,
    warnings: report.warnings,
    overlay: {
      ...overlayBase,
      landmarksPx: hand.landmarksPx,
      handedness: hand.handedness,
    },
  };
}

/**
 * The plain-paper counterpart to the printed-sheet flow above: no ArUco
 * markers, no bank-card cross-check. `detectPaperQuad` finds the sheet's
 * own 4 corners; those become the homography directly. Reuses the
 * corrected (parallax-aware) measurement path — `computeCorrectedHandMeasurements`
 * — rather than the uncorrected one the printed-sheet flow still uses, so
 * `parallaxCorrected` in the submitted calibration reflects whether it
 * actually ran, instead of the printed-sheet builder's hardcoded `false`.
 * Never returns `"needsManualCard"` — there is no card in this flow.
 */
async function runPaperEdgePipeline(
  decoded: DecodedPhoto,
  input: RunPhotoPipelineInput,
  paperSize: PaperSize,
): Promise<PipelineResult> {
  const { bitmap, width, height } = decoded;
  const imageData = getImageData(bitmap, width, height);

  const quad = detectPaperQuad(imageData, paperSize);
  const overlayBase = {
    imageWidth: width,
    imageHeight: height,
    markers: [] as DetectedMarker[],
    card: null,
  };

  if (!quad.corners) {
    const failure = checkPaperFound(quad.paperRegionFound) ??
      checkPaperCornersSeen(quad.cornersSeen) ?? {
        code: "PAPER_NOT_FOUND" as const,
        message:
          "We couldn't find a sheet of paper in this photo — place a blank A4 (or Letter) sheet flat on a plain, contrasting surface and retake.",
      };
    return {
      status: "error",
      errors: [failure],
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }

  // homography + the worst side's residual in mm (via its own normal
  // direction, not a generic centroid average) — this is
  // `computePaperEdgeGeometry` (src/client/paper/calibration.ts), the
  // pure, directly-tested slice of this function (2026-09-25 PR #59
  // review: hard rule 3).
  // The shipped path goes through the same pure chain the tests exercise
  // (evaluatePaperEdgeCalibration): geometry, the paper gates and the
  // calibration fields all come from this one call. parallaxCorrected is
  // only known after EXIF is read below, so it is set on the submission
  // from the real flag there; the placeholder here never reaches it.
  const paperEval = evaluatePaperEdgeCalibration(quad, paperSize, false);
  if (!paperEval.geometry) {
    return {
      status: "error",
      errors: paperEval.errors,
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }
  const { homography } = paperEval.geometry;

  const hand = await detectHandLandmarks(bitmap);
  if (!hand) {
    return {
      status: "error",
      errors: [
        {
          code: "HAND_NOT_DETECTED",
          message:
            "We couldn't find a hand in this photo — lay your hand flat on the sheet, fingers together, and retake.",
        },
      ],
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }

  const landmarksMm = hand.landmarksPx.map((p) =>
    applyHomography(homography, p),
  );
  const { width: paperWidthMm, height: paperHeightMm } =
    PAPER_SIZES_MM[paperSize];
  const paperCornersMm: Point2[] = [
    { x: 0, y: 0 },
    { x: paperWidthMm, y: 0 },
    { x: paperWidthMm, y: paperHeightMm },
    { x: 0, y: paperHeightMm },
  ];

  const gray = rgbaToGrayscale(imageData.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);

  // Paper gates ran once, inside evaluatePaperEdgeCalibration; only the hand
  // gates run here, and both sets of failures are reported together.
  const handReport = runPaperEdgeHandGates({
    paperFound: quad.paperRegionFound,
    landmarkCount: hand.landmarksPx.length,
    handedness: hand.handedness,
    handStated: input.hand,
    landmarkConfidence: hand.confidence,
    landmarksMm,
    paperCornersMm,
    laplacianVariance,
  });
  const report = {
    errors: [...paperEval.errors, ...handReport.errors],
    warnings: handReport.warnings,
    ok: paperEval.ok && handReport.ok,
  };

  if (!report.ok) {
    return {
      status: "error",
      errors: report.errors,
      overlay: {
        ...overlayBase,
        landmarksPx: hand.landmarksPx,
        handedness: hand.handedness,
        paperCorners: quad.corners,
      },
    };
  }

  let exifFocalPx: number | null = null;
  try {
    const jpegBytes = new Uint8Array(await input.file.arrayBuffer());
    exifFocalPx =
      estimateFocalFromExif(jpegBytes, {
        widthPx: width,
        heightPx: height,
      })?.fPx ?? null;
  } catch {
    // A malformed/unreadable EXIF block must not fail the scan — it just
    // means no parallax correction (same as no EXIF at all).
    exifFocalPx = null;
  }

  let corrected;
  try {
    corrected = computeCorrectedHandMeasurements(hand.landmarksPx, homography, {
      exifFocalPx,
      widthPx: width,
      heightPx: height,
    });
  } catch {
    return {
      status: "error",
      errors: [
        {
          code: "MEASUREMENT_OUT_OF_RANGE",
          message:
            "These measurements look implausible — retake with your whole hand flat on the sheet and the camera directly overhead.",
        },
      ],
      overlay: {
        ...overlayBase,
        landmarksPx: hand.landmarksPx,
        handedness: hand.handedness,
        paperCorners: quad.corners,
      },
    };
  }

  // Type narrowing only: report.ok required paperEval.ok, and a passing
  // evaluation always carries its calibration. Its fields are what gets
  // submitted.
  const calibration = paperEval.calibration;
  if (!calibration) {
    return {
      status: "error",
      errors: paperEval.errors,
      overlay: { ...overlayBase, landmarksPx: hand.landmarksPx },
    };
  }
  const submission = assemblePaperEdgeSubmission({
    hand: input.hand,
    gripStyleStated: input.gripStyleStated,
    measurements: corrected.measurements,
    paperSize: calibration.paperSize,
    edgeFitResidualMm: calibration.edgeFitResidualMm,
    minSideCoverage: calibration.minSideCoverage,
    parallaxCorrected: corrected.parallaxCorrected,
  });

  return {
    status: "ok",
    measurements: corrected.measurements,
    submission,
    warnings: report.warnings,
    overlay: {
      ...overlayBase,
      landmarksPx: hand.landmarksPx,
      handedness: hand.handedness,
      paperCorners: quad.corners,
    },
  };
}
