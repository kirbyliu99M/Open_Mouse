/**
 * Orchestrates the full top-down-photo → `ScanSubmission` pipeline
 * (issue #10 steps 2–7). This module is the glue between the pure pieces
 * (gates.ts, submission.ts, the #9 geometry modules) and the browser-only
 * adapters (decode.ts, markers.ts, card.ts, landmarks.ts) — it is itself
 * impure (Canvas, `ImageBitmap`) and is exercised by `tests/e2e/scan.spec.ts`
 * rather than Vitest.
 */
import { computeSheetLayout } from "../sheet/layout";
import { SHEET } from "../../lib/contracts/measurement";
import {
  estimateHomography,
  reprojectionErrorMm as computeReprojectionErrorMm,
  applyHomography,
  type Point2,
} from "../geometry/homography";
import { computeHandMeasurements } from "../geometry/measurements";
import { computeCardScaleRatio, type CardCorners } from "../geometry/card-scale";
import { decodePhoto, PhotoDecodeError, HEIC_RETAKE_MESSAGE } from "./decode";
import { detectMarkers, buildMarkerCorrespondences, type DetectedMarker } from "./markers";
import { detectCardCorners } from "./card";
import { detectHandLandmarks } from "./landmarks";
import { rgbaToGrayscale, computeLaplacianVariance } from "./sharpness";
import { runPhotoGates, checkMarkers, type GateFailure } from "./gates";
import { assembleScanSubmission } from "./submission";
import type { HandMeasurements, ScanSubmission } from "../../lib/contracts/measurement";

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

export interface RunPhotoPipelineInput {
  readonly file: File;
  readonly hand: "left" | "right";
  readonly gripStyleStated?: "palm" | "claw" | "fingertip";
  /** A user-dragged correction/override for the card's 4 corners. */
  readonly manualCardCorners?: CardCorners;
}

function emptyOverlay(width: number, height: number): PhotoOverlay {
  return { imageWidth: width, imageHeight: height, markers: [], card: null, landmarksPx: null };
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
    const message = err instanceof PhotoDecodeError ? err.message : HEIC_RETAKE_MESSAGE;
    return {
      status: "error",
      errors: [{ code: "DECODE_FAILED", message }],
      overlay: emptyOverlay(0, 0),
    };
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
      errors: [markerFailure ?? { code: "MARKERS_MISSING", message: "Marker detection failed." }],
      overlay: { imageWidth: width, imageHeight: height, markers: detected, card: null, landmarksPx: null },
    };
  }

  const homography = estimateHomography(correspondences);
  const reprojectionErrorMm = computeReprojectionErrorMm(homography, correspondences);

  const cardCorners = input.manualCardCorners ?? detectCardCorners(imageData);
  if (!cardCorners) {
    return {
      status: "needsManualCard",
      overlay: { imageWidth: width, imageHeight: height, markers: detected, card: null, landmarksPx: null },
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

  const landmarksMm = hand.landmarksPx.map((p) => applyHomography(homography, p));
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
      overlay: { ...overlayBase, landmarksPx: hand.landmarksPx },
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
      overlay: { ...overlayBase, landmarksPx: hand.landmarksPx },
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
    overlay: { ...overlayBase, landmarksPx: hand.landmarksPx },
  };
}
