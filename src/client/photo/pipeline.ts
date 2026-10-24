/**
 * Orchestrates the full top-down-photo → `ScanSubmission` pipeline
 * (issue #10 steps 2–7). This module is the glue between the pure pieces
 * (gates.ts, submission.ts, the #9 geometry modules) and the browser-only
 * adapters (decode.ts, markers.ts, card.ts, landmarks.ts) — it is itself
 * impure (Canvas, `ImageBitmap`) and is exercised by `tests/e2e/scan.spec.ts`
 * rather than Vitest.
 */
import { computeSheetLayout } from "../sheet/layout";
import { SHEET, type PaperSize } from "../../lib/contracts/measurement";
import {
  estimateHomography,
  reprojectionErrorMm as computeReprojectionErrorMm,
  applyHomography,
  type Point2,
} from "../geometry/homography";
import { computeHandMeasurements } from "../geometry/measurements";
import {
  computeCardScaleRatio,
  type CardCorners,
} from "../geometry/card-scale";
import { decodePhoto, PhotoDecodeError, HEIC_RETAKE_MESSAGE } from "./decode";
import type { DecodedPhoto } from "./decode";
import {
  detectMarkers,
  buildMarkerCorrespondences,
  type DetectedMarker,
} from "./markers";
import { detectCardCorners } from "./card";
import { detectHandLandmarks } from "./landmarks";
import { assessHandFlatness } from "./handFlatness";
import { rgbaToGrayscale, computeLaplacianVariance } from "./sharpness";
import {
  runPhotoGates,
  checkMarkers,
  checkPaperFound,
  checkPaperCornersSeen,
  checkSharpness,
  type GateFailure,
} from "./gates";
import {
  assembleScanSubmission,
  assembleUserLengthSubmission,
} from "./submission";
import { resolvePipelineHand, type HandDecision } from "./hand";
import {
  measureWithUserLength,
  userLengthRetakeMessage,
  checkUserLengthStraightness,
  checkUserLengthProportion,
} from "./user-length";
import {
  checkHandDetected,
  checkHandedness,
  checkLandmarkConfidence,
} from "./gates";
import { yieldToBrowser } from "./yieldToBrowser";
import { getAnalysisRunner } from "./analysisWorkerClient";
import type { AnalysisFrame, AnalysisThread } from "./offMainAnalysis";
import {
  evaluateManualPaperCalibration,
  evaluatePaperEdgeCalibration,
} from "../paper/calibration";
import { orientManualQuad, shiftQuad, type Quad4 } from "../paper/manualQuad";
import type {
  HandMeasurements,
  ScanSubmission,
} from "../../lib/contracts/measurement";
import {
  analysisFrames,
  assumedDetectionFocalPx,
  toFullFrame,
  visibleRectInStill,
  type FrameSize,
  type PixelRect,
} from "../camera/visibleView";
import { finishPaperEdge } from "./paperEdgeFinish";
import { PALM_CHOICE, palmPointsOf, pointsInside } from "../paper/palmChoice";
import { handLandmarksOf } from "../paper/handMask";
import type { EdgeFitRecord } from "../paper/detect";
import { adoptSecondLook, planSecondLook } from "../paper/secondLook";
import type { ReusedFocal } from "../geometry/parallax";
import type { IssueDetail } from "./issue-detail";
import {
  paperMaxAngleDeviationDeg,
  paperObservedAspect,
  paperSizeFractions,
  paperWorstSide,
  type FocalDiagnostics,
  type HandDiagnostics,
  type PaperChoiceDiagnostics,
  type PaperDiagnostics,
  type PaperSecondLookDiagnostics,
  type PipelineDiagnostics,
  type ParallaxGuardDiagnostics,
  type ShadowPriorDiagnostics,
  type ViewDiagnostics,
} from "./diagnostics";

export interface PipelineIssue {
  readonly code: string;
  readonly message: string;
  /** What the message says that the code does not, for other languages. */
  readonly detail?: IssueDetail;
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
  /**
   * V3.2 F2 (candidate): the corners the paper detector could work out when it
   * found the sheet but not all four of its corners (`partialCorners`, TL, TR,
   * BR, BL, `null` where it could not), in the same full-resolution pixels.
   * Set only on that failure, so the frame the person adjusts can start from
   * them; absent everywhere else.
   */
  readonly paperPartialCorners?: readonly (Point2 | null)[];
  /**
   * F10 (candidate 未拍板): the detector's rough quad around the bright region
   * when it did not find all four corners (`guessCorners`), TL, TR, BR, BL in
   * the same full-resolution pixels. Set only on that failure, ONLY as where
   * the frame the person adjusts starts (every corner of it still to be
   * confirmed); nothing is measured from it.
   */
  readonly paperGuessCorners?: readonly [Point2, Point2, Point2, Point2];
}

export type PipelineResult =
  | {
      readonly status: "ok";
      readonly measurements: HandMeasurements;
      readonly submission: ScanSubmission;
      readonly warnings: readonly GateFailure[];
      readonly overlay: PhotoOverlay;
      readonly diagnostics?: PipelineDiagnostics;
    }
  | {
      readonly status: "needsManualCard";
      readonly overlay: PhotoOverlay;
      readonly diagnostics?: PipelineDiagnostics;
    }
  | {
      readonly status: "error";
      readonly errors: readonly PipelineIssue[];
      readonly overlay: PhotoOverlay;
      readonly diagnostics?: PipelineDiagnostics;
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
  | { readonly method: "paper-edge"; readonly paperSize: PaperSize }
  | { readonly method: "user-length"; readonly handLengthMm: number };

export interface RunPhotoPipelineInput {
  readonly file: File;
  readonly hand: "left" | "right";
  /**
   * `true` when `hand` is the user's own choice. `false` means it is only a
   * default (easy scan until its hand button is tapped): the detected hand is
   * submitted instead and a disagreement is not a retake. Defaults to `true`,
   * so a caller that never says (the printed-sheet page) has its hand checked.
   */
  readonly handExplicit?: boolean;
  /** Wording for the mismatch fix available in this caller's UI. */
  readonly handednessFixInstruction?: string;
  readonly gripStyleStated?: "palm" | "claw" | "fingertip";
  /** A user-dragged correction/override for the card's 4 corners. Printed-sheet only. */
  readonly manualCardCorners?: CardCorners;
  /** Defaults to `{ method: "printed-sheet" }` — every existing caller keeps working unchanged. */
  readonly calibration?: CalibrationInput;
  /**
   * What the person saw when this photo was taken from the live viewfinder
   * (`takePhoto()` or a canvas frame): the stream's size and the part of it
   * that was on screen. A paper-edge photo is cropped to that part before it
   * is looked at (`visibleRectInStill`, visibleView.ts). Omitted for an
   * uploaded photo, which has no viewfinder.
   */
  readonly previewView?: {
    readonly stream: FrameSize;
    readonly visibleInStream: PixelRect;
  };
  /**
   * For an image that was already cut to the part on screen before it was
   * handed over (a frame of the video: nothing here is cropped, so the
   * pipeline cannot tell): the width, in this image's pixels, of the whole
   * stream it was cut from. The paper detector's assumed focal length (when the
   * photo has no EXIF) is worked out from it, as the live loop's is, because a
   * cut narrows the picture, not the lens (`assumedDetectionFocalPx`). Omitted,
   * the image's own width is used, as before: uploads, the printed sheet and
   * the camera's photo never pass it. Not used by any gate.
   */
  readonly focalReferenceWidthPx?: number;
  /**
   * landmark-raw-v3 (candidate, design R7 §1.3): for the same frames as
   * `focalReferenceWidthPx`, the LONG edge of the whole stream in this
   * image's pixels (`frameFocalReferenceLongEdgePx`). The nominal focal prior
   * is taken on it, so a frame cut on its long side keeps the stream's lens.
   * Omitted, the whole decoded photo's long edge is used. Paper-edge only.
   */
  readonly focalReferenceLongEdgePx?: number;
  /**
   * Told when a step of the analysis has finished, for the loader's ring
   * (V3.2 U1): `decoded` (the photo is decoded), `paper` (the sheet was
   * looked for; paper-edge only) and `hand` (the hand was looked for).
   * Called once per step that runs, in that order, whatever the step found.
   * It only listens: nothing in the run reads it or waits for it, and a
   * callback that throws is ignored. Omitted, nothing is called. After each
   * step (and before the sheet is looked for) the run lets the browser draw
   * a frame (`yieldToBrowser`, F7), so the loader moves while it works; that
   * only waits and changes nothing the run computes.
   */
  readonly onStage?: (stage: PipelineStage) => void;
  /**
   * V3.2 F2 (candidate, 未拍板): a paper frame the person placed on the photo
   * after the detector's own was turned back. Paper-edge only. `corners` are
   * in the WHOLE decoded photo's pixels (the overlay's), in any order: they are
   * moved into the analysed picture and labelled as the detector labels its
   * own (`orientManualQuad`). The detector does not run; every hand gate, the
   * homography (`buildPaperHomography`) and the measurements are the same as
   * for detected corners. `source` is what the submission's `cornersSource`
   * says: `adjusted` (the detector's corners, moved or confirmed) or `manual`
   * (placed where the detector had none).
   */
  readonly manualPaperCorners?: {
    readonly corners: Quad4;
    readonly source: "adjusted" | "manual";
  };
  /**
   * F10 item 2 (R6 F1, candidate 未拍板): read only with `manualPaperCorners`.
   * The focal length this same photo's automatic run used (EXIF, or a
   * reliable homography estimate on the detector's corners), so a placed
   * frame keeps the parallax correction that a few px of hand placement would
   * otherwise switch off (R6: palm width +3.0 mm, hand length +4.9 mm,
   * simulated). The photo's own EXIF still comes first. Ignored on the
   * automatic path.
   */
  readonly reusedFocal?: ReusedFocal | null;
}

/** The steps `onStage` reports. */
export type PipelineStage = "decoded" | "paper" | "hand";

/** Tells the caller a step has finished; a callback that throws changes nothing. */
function notifyStage(input: RunPhotoPipelineInput, stage: PipelineStage) {
  try {
    input.onStage?.(stage);
  } catch {
    // The loader is a convenience: it must never break a scan.
  }
}

/**
 * What a run notes about itself for `PipelineDiagnostics` (diagnostics.ts):
 * filled in by whichever steps ran, read once at the end.
 */
interface PipelineTrace {
  decodeMs: number | null;
  paperMs: number | null;
  handMs: number | null;
  decoded: FrameSize | null;
  analysed: FrameSize | null;
  fovCrop: PixelRect | null;
  view: ViewDiagnostics | null;
  paper: PaperDiagnostics | null;
  laplacianVariance: number | null;
  hand: HandDiagnostics;
  parallaxCorrected: boolean | null;
  focal: FocalDiagnostics | null;
  shadowPrior: ShadowPriorDiagnostics | null;
  parallaxGuard: ParallaxGuardDiagnostics | null;
  analysisThread: AnalysisThread | null;
  /** V3.2 F17: the palm-guided second look at the sheet, when there was one. */
  paperChoice: PaperChoiceDiagnostics | null;
  /** V3.2 F19: the second call to the detector (F17 and/or F19), when there was one. */
  paperSecondLook: PaperSecondLookDiagnostics | null;
  /** V3.2 F19: how the sides of the sheet in the result were fitted, when one was found. */
  paperEdgeFit: EdgeFitRecord | null;
}

function newTrace(): PipelineTrace {
  return {
    decodeMs: null,
    paperMs: null,
    handMs: null,
    decoded: null,
    analysed: null,
    fovCrop: null,
    view: null,
    paper: null,
    laplacianVariance: null,
    hand: {
      detected: null,
      confidence: null,
      handedness: null,
      flatness: null,
    },
    parallaxCorrected: null,
    focal: null,
    shadowPrior: null,
    parallaxGuard: null,
    analysisThread: null,
    paperChoice: null,
    paperSecondLook: null,
    paperEdgeFit: null,
  };
}

/**
 * Notes where an offloaded step ran (F8): `fallback` as soon as any step fell
 * back to the main thread, `worker` while every one ran in the worker.
 */
function noteAnalysisThread(trace: PipelineTrace, thread: AnalysisThread) {
  if (trace.analysisThread !== "fallback") trace.analysisThread = thread;
}

/**
 * The sharpness of a frame, worked out in the worker where there is one (F8)
 * and on the main thread otherwise: the same `rgbaToGrayscale` +
 * `computeLaplacianVariance` either way. Where it cannot be worked out (an
 * image too small to have an interior) it is computed again here, so the run
 * throws exactly as it did when it was computed here in the first place.
 */
async function offloadedSharpness(
  frame: AnalysisFrame,
  reread: () => AnalysisFrame,
  trace: PipelineTrace,
): Promise<number> {
  const sharp = await getAnalysisRunner().run(
    { kind: "sharpness" },
    frame,
    reread,
  );
  noteAnalysisThread(trace, sharp.thread);
  const { width, height, data } = sharp.frame;
  return (
    sharp.outcome.laplacianVariance ??
    computeLaplacianVariance(
      rgbaToGrayscale(data, width * height),
      width,
      height,
    )
  );
}

/**
 * Whether an error is the hand detector failing to load
 * (`HandLandmarkerLoadError`, landmarks.ts). By name, not `instanceof`, so a
 * test that fakes the landmarks module without the class still works.
 */
function isHandLoaderFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "HandLandmarkerLoadError";
}

/** Looks for the hand, noting how long that took and what it found. */
async function detectHandTraced(
  bitmap: ImageBitmap,
  trace: PipelineTrace,
  input: RunPhotoPipelineInput,
): Promise<Awaited<ReturnType<typeof detectHandLandmarks>>> {
  const startedAt = performance.now();
  let hand: Awaited<ReturnType<typeof detectHandLandmarks>>;
  try {
    hand = await detectHandLandmarks(bitmap);
    trace.hand = hand
      ? {
          detected: true,
          confidence: hand.confidence,
          handedness: hand.handedness,
          // Shadow mode: read off the landmarks this one detection returned.
          // It cannot throw, and nothing below reads it.
          flatness: assessHandFlatness(hand.landmarksPx),
        }
      : {
          detected: false,
          confidence: null,
          handedness: null,
          flatness: null,
        };
  } finally {
    trace.handMs = performance.now() - startedAt;
    notifyStage(input, "hand");
  }
  // A frame for the loader before the measurements are worked out (F7).
  await yieldToBrowser();
  return hand;
}

/**
 * Every pipeline decides the hand exactly once, through here, right after the
 * hand was detected. It is the only place `input.hand` is read.
 */
function decideHand(
  input: RunPhotoPipelineInput,
  detected: "left" | "right" | null,
): HandDecision {
  return resolvePipelineHand({
    selected: input.hand,
    detected,
    explicit: input.handExplicit !== false,
  });
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
  const startedAt = performance.now();
  const trace = newTrace();
  const result = await runPhotoPipelineTraced(input, trace);
  const diagnostics: PipelineDiagnostics = {
    decodeMs: trace.decodeMs,
    paperMs: trace.paperMs,
    handMs: trace.handMs,
    totalMs: performance.now() - startedAt,
    decoded: trace.decoded,
    analysed: trace.analysed,
    fovCrop: trace.fovCrop,
    view: trace.view,
    paper: trace.paper,
    laplacianVariance: trace.laplacianVariance,
    hand: trace.hand,
    parallaxCorrected: trace.parallaxCorrected,
    // The numbers the result and the submission carry, read off the result.
    measured:
      result.status === "ok"
        ? {
            handLengthMm: result.measurements.handLengthMm,
            palmWidthMm: result.measurements.palmWidthMm,
          }
        : { handLengthMm: null, palmWidthMm: null },
    focal: trace.focal,
    shadowPrior: trace.shadowPrior,
    parallaxGuard: trace.parallaxGuard,
    analysisThread: trace.analysisThread,
    // Only where there was a second look, so every other record is as it was.
    ...(trace.paperChoice ? { paperChoice: trace.paperChoice } : {}),
    // F19: only where there is something to say, so other records are as they were.
    ...(trace.paperEdgeFit || trace.paperSecondLook
      ? {
          paperEdgeFit: {
            edgeFit: trace.paperEdgeFit,
            secondLook: trace.paperSecondLook,
          },
        }
      : {}),
  };
  return { ...result, diagnostics };
}

async function runPhotoPipelineTraced(
  input: RunPhotoPipelineInput,
  trace: PipelineTrace,
): Promise<PipelineResult> {
  let decoded;
  const decodeStartedAt = performance.now();
  try {
    decoded = await decodePhoto(input.file);
    trace.decodeMs = performance.now() - decodeStartedAt;
    trace.decoded = { width: decoded.width, height: decoded.height };
    trace.analysed = trace.decoded;
    notifyStage(input, "decoded");
  } catch (err) {
    trace.decodeMs = performance.now() - decodeStartedAt;
    const message =
      err instanceof PhotoDecodeError ? err.message : HEIC_RETAKE_MESSAGE;
    return {
      status: "error",
      errors: [{ code: "DECODE_FAILED", message }],
      overlay: emptyOverlay(0, 0),
    };
  }

  // The decoded bitmap holds a full-size picture in memory until it is closed:
  // every way out of the run below closes it, exactly once.
  const releaseDecoded = closeOnce(decoded.bitmap);
  try {
    // A frame for the loader after decoding (F7).
    await yieldToBrowser();
    return await runDecodedPipeline(decoded, input, trace, releaseDecoded);
  } finally {
    releaseDecoded();
  }
}

/** A function that closes `bitmap` the first time it is called and never again. */
function closeOnce(bitmap: ImageBitmap): () => void {
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    bitmap.close();
  };
}

/**
 * Everything after decoding. It never closes the decoded bitmap on its own
 * account except through `releaseDecoded` (a paper-edge crop frees the
 * full-size picture early); `runPhotoPipelineTraced` closes it in a `finally`.
 */
async function runDecodedPipeline(
  decoded: DecodedPhoto,
  input: RunPhotoPipelineInput,
  trace: PipelineTrace,
  releaseDecoded: () => void,
): Promise<PipelineResult> {
  const calibration = input.calibration ?? { method: "printed-sheet" };
  if (calibration.method === "user-length") {
    return runUserLengthPipeline(
      decoded,
      input,
      calibration.handLengthMm,
      trace,
    );
  }
  if (calibration.method === "paper-edge") {
    return runPaperEdgePipeline(
      decoded,
      input,
      calibration.paperSize,
      trace,
      releaseDecoded,
    );
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

  const hand = await detectHandTraced(bitmap, trace, input);
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
          detail: { kind: "handNotDetected", on: "sheet" },
        },
      ],
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }

  const handDecision = decideHand(input, hand.handedness);

  const landmarksMm = hand.landmarksPx.map((p) =>
    applyHomography(homography, p),
  );
  const flatMarkerCornersMm = layout.markers
    .filter((m) => (SHEET.flatMarkerIds as readonly number[]).includes(m.id))
    .flatMap((m) => m.corners);

  // In the worker where there is one (F8); the markers and the card above
  // have read the pixels already, and nothing below reads them again.
  const laplacianVariance = await offloadedSharpness(
    imageData,
    () => getImageData(bitmap, width, height),
    trace,
  );
  trace.laplacianVariance = laplacianVariance;

  const report = runPhotoGates({
    detectedMarkerIds: detected.map((m) => m.id),
    landmarkCount: hand.landmarksPx.length,
    handedness: hand.handedness,
    handStated: handDecision.stated,
    handednessFixInstruction: input.handednessFixInstruction,
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
    hand: handDecision.submitted,
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
 *
 * A photo taken from the live viewfinder (`input.previewView`) is cropped to
 * the part the person saw on screen first, right after decoding and before
 * anything is detected (visibleView.ts says why and what it must not damage).
 * The paper gates, the hand and the sharpness all look at that part and the
 * result is worked out by `finishPaperEdge` (paperEdgeFinish.ts), which keeps
 * the parallax correction right: the focal length comes from the whole decoded
 * photo's size, the principal point from the cropped image's centre, and the
 * overlay is reported in the whole photo's pixels.
 */
async function runPaperEdgePipeline(
  decoded: DecodedPhoto,
  input: RunPhotoPipelineInput,
  paperSize: PaperSize,
  trace: PipelineTrace,
  releaseDecoded: () => void,
): Promise<PipelineResult> {
  const fullWidth = decoded.width;
  const fullHeight = decoded.height;
  let bitmap = decoded.bitmap;
  let width = decoded.width;
  let height = decoded.height;
  const view = input.previewView
    ? visibleRectInStill(
        { width: fullWidth, height: fullHeight },
        input.previewView.stream,
        input.previewView.visibleInStream,
      )
    : null;
  let crop: PixelRect | null = view?.crop ?? null;
  if (input.previewView && view) {
    trace.view = {
      stream: input.previewView.stream,
      visibleInStream: input.previewView.visibleInStream,
      model: view.model,
      modelApplies: view.modelApplies,
      aspectDiff: view.aspectDiff,
    };
  }
  if (crop) {
    try {
      bitmap = await createImageBitmap(
        decoded.bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
      );
      releaseDecoded();
      width = crop.width;
      height = crop.height;
    } catch {
      // A crop that fails is not a reason to fail the scan: the whole photo is analysed.
      crop = null;
    }
  }
  // The cropped bitmap is this function's own: closed on every way out of the
  // analysis below. (The decoded one is the caller's, or `releaseDecoded`'s.)
  try {
    trace.fovCrop = crop;
    trace.analysed = { width, height };
    const frames = analysisFrames(
      { width: fullWidth, height: fullHeight },
      crop,
    );
    // The pixels go to the worker and come back with each answer (F8), so
    // `frame` is always the copy that is here now. Where a failed worker kept
    // them, they are read again from the same bitmap.
    const analysedBitmap = bitmap;
    const reread = () => getImageData(analysedBitmap, width, height);
    let frame: AnalysisFrame = getImageData(bitmap, width, height);
    const grayOf = () => rgbaToGrayscale(frame.data, width * height);
    // The sharpness is worked out first, so a photo that is turned back before
    // it reaches the hand gates (no sheet, no hand) still has one in its record
    // (diagnostics.ts). If it cannot be worked out here it is tried again below,
    // exactly as before. It runs in the worker where there is one (F8): the
    // same functions, with `null` where they throw, as here.
    const sharp = await getAnalysisRunner().run(
      { kind: "sharpness" },
      frame,
      reread,
    );
    frame = sharp.frame;
    noteAnalysisThread(trace, sharp.thread);
    trace.laplacianVariance = sharp.outcome.laplacianVariance;
    // A frame for the loader before the sheet is looked for, the longest
    // step on a large photo (F7).
    await yieldToBrowser();

    const paperStartedAt = performance.now();
    // The assumed focal length is the whole photo's, not the crop's: a crop
    // narrows the picture, not the lens (visibleView.ts). Without a crop it is
    // what the detector would have assumed anyway. A frame that was cut before
    // it got here says how wide the picture it was cut from was.
    const focalPxHint = assumedDetectionFocalPx(
      frames,
      input.focalReferenceWidthPx,
    );
    // A frame the person placed (V3.2 F2) replaces the detector's: it is its
    // own branch, so the detected path below is exactly what it was.
    if (input.manualPaperCorners) {
      return await finishManualPaper({
        input,
        manual: input.manualPaperCorners,
        paperSize,
        trace,
        bitmap,
        grayOf,
        width,
        height,
        fullWidth,
        fullHeight,
        crop,
        focalPxHint,
        paperStartedAt,
      });
    }
    // The detector runs once, in the worker where there is one (F8), else
    // here: the same `detectPaperQuad`, the same pixels and arguments.
    // `failureGuess` (F10): a photo that fails also says where the bright
    // region was, for the frame the person adjusts; a found sheet's result is
    // exactly what it was without it.
    const detected = await getAnalysisRunner().run(
      {
        kind: "paper",
        paperSize,
        options: { focalPxHint, failureGuess: true },
      },
      frame,
      reread,
    );
    frame = detected.frame;
    noteAnalysisThread(trace, detected.thread);
    let quad = detected.outcome.quad;
    trace.paperMs = performance.now() - paperStartedAt;
    notifyStage(input, "paper");
    await yieldToBrowser();
    const notePaper = (q: typeof quad) => {
      const quadSize = q.corners
        ? paperSizeFractions(q.corners, width, height)
        : null;
      trace.paper = {
        cornersSeen: q.cornersSeen,
        paperRegionFound: q.paperRegionFound,
        widthFraction: quadSize?.widthFraction ?? null,
        heightFraction: quadSize?.heightFraction ?? null,
        edgeFitResidualMm: null,
        maxAngleDeviationDeg: q.corners
          ? paperMaxAngleDeviationDeg(q.corners)
          : null,
        observedAspect: q.corners ? paperObservedAspect(q.corners) : null,
        minSideCoverage: q.minSideCoverage,
        sideCoverages: q.sideCoverages ?? null,
        worstSide: paperWorstSide(q.corners, q.sideCoverages),
        gateFailures: [],
        failureStage: q.failureStage ?? null,
      };
    };
    notePaper(quad);
    // The overlay is always in the whole decoded photo's pixels.
    const overlayBase = {
      imageWidth: fullWidth,
      imageHeight: fullHeight,
      markers: [] as DetectedMarker[],
      card: null,
    };

    // homography + the worst side's residual in mm (via its own normal
    // direction, not a generic centroid average) — this is
    // `computePaperEdgeGeometry` (src/client/paper/calibration.ts), the
    // pure, directly-tested slice of this function (2026-09-25 PR #59
    // review: hard rule 3).
    // The shipped path goes through the same pure chain the tests exercise
    // (evaluatePaperEdgeCalibration): geometry, the paper gates and the
    // calibration fields all come from this one call. parallaxCorrected is
    // only known after EXIF is read (finishPaperEdge), so it is set on the
    // submission from the real flag there; the placeholder here never reaches it.
    const evaluate = (q: typeof quad) => {
      if (!q.corners) return null;
      const evaluation = evaluatePaperEdgeCalibration(q, paperSize, false);
      // Which paper gates failed, even where the result below goes on to
      // report another error first (a photo with no hand reports only that).
      trace.paper = trace.paper && {
        ...trace.paper,
        edgeFitResidualMm: evaluation.geometry?.edgeFitResidualMm ?? null,
        gateFailures: evaluation.errors.map((error) => error.code),
      };
      return evaluation;
    };
    let paperEval = evaluate(quad);

    // V3.2 F17 (candidate, 未拍板; Kirby's preview 7: "it went to my
    // window"): the hand is looked for here, before the paper's verdict is
    // returned. When the sheet was not found, or does not hold the palm, the
    // detector looks again with the palm (palmChoice.ts) and its answer is
    // taken only if it chose another bright region. A photo with no hand, or
    // a sheet that holds the palm, goes on exactly as before.
    // F17 review: the hand detector failing to LOAD (offline, the model or
    // its wasm not downloaded) is taken as no palm here, so a photo with no
    // sheet still gets its paper error and its partial corners (and the
    // adjustment opens) exactly as before F17; the load error itself is
    // thrown once the sheet is found, where the hand was looked for before
    // F17. Any other failure is thrown here as it was.
    let hand: Awaited<ReturnType<typeof detectHandTraced>>;
    let handLoadError: unknown = null;
    try {
      hand = await detectHandTraced(bitmap, trace, input);
    } catch (error) {
      if (!isHandLoaderFailure(error)) throw error;
      hand = null;
      handLoadError = error;
    }
    const palm = hand ? palmPointsOf(hand.landmarksPx) : null;
    const holdsPalm =
      paperEval?.geometry != null &&
      palm !== null &&
      pointsInside(quad.corners, palm) >= PALM_CHOICE.minPointsInside;
    // V3.2 F19 (candidate): when the first answer failed a paper check and
    // the hand is known, the same second call also carries the hand's 21
    // landmarks, so points under the hand and arm are left out and pieces
    // the arm cut apart are joined (secondLook.ts decides when, and whether
    // its answer is taken). A photo whose sheet held the palm and passed is
    // never looked at twice.
    const plan = planSecondLook({
      firstHasCorners: quad.corners !== null,
      firstOk: paperEval?.ok === true,
      palm,
      holdsPalm,
      hand: hand ? handLandmarksOf(hand.landmarksPx) : null,
    });
    if (plan) {
      const secondStartedAt = performance.now();
      const again = await getAnalysisRunner().run(
        {
          kind: "paper",
          paperSize,
          options: { focalPxHint, failureGuess: true, ...plan },
        },
        frame,
        reread,
      );
      frame = again.frame;
      noteAnalysisThread(trace, again.thread);
      const second = again.outcome.quad;
      const secondOk =
        second.corners !== null &&
        evaluatePaperEdgeCalibration(second, paperSize, false).ok;
      const used = adoptSecondLook({
        plan,
        palmChose: second.paperChoice?.reason === "palm",
        firstHasCorners: quad.corners !== null,
        secondHasCorners: second.corners !== null,
        secondOk,
      });
      if (plan.palmPointsPx) {
        const choice = second.paperChoice;
        trace.paperChoice = choice ? { ...choice, used } : null;
      }
      trace.paperSecondLook = {
        palm: plan.palmPointsPx !== undefined,
        handMask: plan.handLandmarksPx !== undefined,
        used,
        ms: performance.now() - secondStartedAt,
        // F19 review: the masked answer that was not taken, so the log keeps
        // its numbers (the result's edge fit is then the first call's).
        ...(!used && plan.handLandmarksPx !== undefined
          ? {
              notUsed: {
                cornersSeen: second.cornersSeen,
                sideResidualsPx: second.edgeFit?.sideResidualsPx ?? null,
                excludedPoints: second.edgeFit?.excludedPoints ?? null,
                piecesJoined: second.edgeFit?.piecesJoined ?? null,
              },
            }
          : {}),
      };
      if (used) {
        quad = second;
        notePaper(quad);
        paperEval = evaluate(quad);
      }
    }
    trace.paperEdgeFit = quad.edgeFit ?? null;

    if (!quad.corners) {
      // With the step the detector stopped at (scan S2): the words name it,
      // the code and whether the photo fails stay what they were.
      const failure = checkPaperFound(
        quad.paperRegionFound,
        quad.failureStage,
      ) ??
        checkPaperCornersSeen(quad.cornersSeen) ?? {
          code: "PAPER_NOT_FOUND" as const,
          message:
            "We couldn't find a sheet of paper in this photo — place a blank A4 (or Letter) sheet flat on a plain, contrasting surface and retake.",
        };
      trace.paper = trace.paper && {
        ...trace.paper,
        gateFailures: [failure.code],
      };
      // The corners it did work out, for the frame the person may adjust
      // (V3.2 F2): only when the sheet itself was found.
      const partial = quad.paperRegionFound
        ? quad.partialCorners.map((p) => (p ? toFullFrame(p, crop) : null))
        : null;
      // ...and the rough quad around the bright region (F10), a start only.
      const guess = quad.guessCorners
        ? (quad.guessCorners.map((p) => toFullFrame(p, crop)) as unknown as [
            Point2,
            Point2,
            Point2,
            Point2,
          ])
        : null;
      return {
        status: "error",
        errors: [failure],
        overlay: {
          ...overlayBase,
          landmarksPx: null,
          ...(partial && partial.some((p) => p !== null)
            ? { paperPartialCorners: partial }
            : {}),
          ...(guess ? { paperGuessCorners: guess } : {}),
        },
      };
    }

    if (!paperEval?.geometry) {
      return {
        status: "error",
        errors: paperEval?.errors ?? [],
        overlay: { ...overlayBase, landmarksPx: null },
      };
    }

    if (handLoadError !== null) throw handLoadError;

    if (!hand) {
      return {
        status: "error",
        errors: [
          {
            code: "HAND_NOT_DETECTED",
            message:
              "We couldn't find a hand in this photo — lay your hand flat on the sheet, fingers together, and retake.",
            detail: { kind: "handNotDetected", on: "paper" },
          },
        ],
        overlay: { ...overlayBase, landmarksPx: null },
      };
    }

    const laplacianVariance =
      trace.laplacianVariance ??
      computeLaplacianVariance(grayOf(), width, height);
    trace.laplacianVariance = laplacianVariance;

    const finish = await finishPaperEdge({
      quad,
      paperEval,
      paperSize,
      hand,
      request: input,
      laplacianVariance,
      decoded: { width: fullWidth, height: fullHeight },
      crop,
      readJpegBytes: async () => new Uint8Array(await input.file.arrayBuffer()),
      ...(input.focalReferenceLongEdgePx !== undefined
        ? { focalReferenceLongEdgePx: input.focalReferenceLongEdgePx }
        : {}),
    });
    trace.parallaxCorrected = finish.parallaxCorrected;
    trace.focal = finish.focal;
    trace.shadowPrior = finish.shadowPrior;
    trace.parallaxGuard = finish.parallaxGuard;
    return finish.result;
  } finally {
    if (bitmap !== decoded.bitmap) bitmap.close();
  }
}

/**
 * The paper-edge run for a frame the person placed (V3.2 F2, candidate): the
 * frame instead of the detector, then the same hand detection and the same
 * `finishPaperEdge` (hand gates, EXIF focal length, parallax-corrected
 * measurements, overlay) as detected corners. The frame is checked again
 * here (`evaluateManualPaperCalibration`), whatever the screen checked.
 */
async function finishManualPaper(args: {
  readonly input: RunPhotoPipelineInput;
  readonly manual: NonNullable<RunPhotoPipelineInput["manualPaperCorners"]>;
  readonly paperSize: PaperSize;
  readonly trace: PipelineTrace;
  readonly bitmap: ImageBitmap;
  /** The analysed picture in grey, worked out only if the sharpness must be tried again. */
  readonly grayOf: () => Float64Array;
  readonly width: number;
  readonly height: number;
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly crop: PixelRect | null;
  readonly focalPxHint: number;
  readonly paperStartedAt: number;
}): Promise<PipelineResult> {
  const { input, manual, paperSize, trace, width, height, crop } = args;
  const image = { width, height };
  // Whole-photo pixels to the analysed picture's, then the detector's labels.
  const inAnalysed = shiftQuad(
    manual.corners,
    -(crop?.x ?? 0),
    -(crop?.y ?? 0),
  );
  const corners = orientManualQuad(
    inAnalysed,
    paperSize,
    image,
    args.focalPxHint,
  );
  const paperEval = evaluateManualPaperCalibration({
    corners,
    cornersSource: manual.source,
    paperSize,
    image,
    parallaxCorrected: false,
  });
  trace.paperMs = performance.now() - args.paperStartedAt;
  notifyStage(input, "paper");
  await yieldToBrowser();
  const quadSize = paperSizeFractions(corners, width, height);
  // What the record says of a placed frame: its geometry, where its corners
  // came from, and no edge numbers (there was no fitted edge to measure).
  trace.paper = {
    cornersSeen: 4,
    paperRegionFound: true,
    widthFraction: quadSize?.widthFraction ?? null,
    heightFraction: quadSize?.heightFraction ?? null,
    edgeFitResidualMm: null,
    maxAngleDeviationDeg: paperMaxAngleDeviationDeg(corners),
    observedAspect: paperObservedAspect(corners),
    minSideCoverage: null,
    sideCoverages: null,
    worstSide: null,
    gateFailures: paperEval.errors.map((error) => error.code),
    failureStage: null,
    cornersSource: manual.source,
  };
  const overlayBase = {
    imageWidth: args.fullWidth,
    imageHeight: args.fullHeight,
    markers: [] as DetectedMarker[],
    card: null,
  };
  if (!paperEval.ok || !paperEval.geometry) {
    return {
      status: "error",
      errors: paperEval.errors,
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }
  const hand = await detectHandTraced(args.bitmap, trace, input);
  if (!hand) {
    return {
      status: "error",
      errors: [
        {
          code: "HAND_NOT_DETECTED",
          message:
            "We couldn't find a hand in this photo — lay your hand flat on the sheet, fingers together, and retake.",
          detail: { kind: "handNotDetected", on: "paper" },
        },
      ],
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }
  const laplacianVariance =
    trace.laplacianVariance ??
    computeLaplacianVariance(args.grayOf(), width, height);
  trace.laplacianVariance = laplacianVariance;
  const finish = await finishPaperEdge({
    quad: { corners, paperRegionFound: true },
    paperEval,
    paperSize,
    hand,
    request: input,
    laplacianVariance,
    decoded: { width: args.fullWidth, height: args.fullHeight },
    crop,
    readJpegBytes: async () => new Uint8Array(await input.file.arrayBuffer()),
    ...(input.reusedFocal ? { reusedFocal: input.reusedFocal } : {}),
    ...(input.focalReferenceLongEdgePx !== undefined
      ? { focalReferenceLongEdgePx: input.focalReferenceLongEdgePx }
      : {}),
  });
  trace.parallaxCorrected = finish.parallaxCorrected;
  trace.focal = finish.focal;
  trace.shadowPrior = finish.shadowPrior;
  trace.parallaxGuard = finish.parallaxGuard;
  return finish.result;
}

async function runUserLengthPipeline(
  decoded: DecodedPhoto,
  input: RunPhotoPipelineInput,
  handLengthMm: number,
  trace: PipelineTrace,
): Promise<PipelineResult> {
  const { bitmap, width, height } = decoded;
  const overlayBase = {
    imageWidth: width,
    imageHeight: height,
    markers: [] as DetectedMarker[],
    card: null,
  };
  const hand = await detectHandTraced(bitmap, trace, input);
  if (!hand)
    return {
      status: "error",
      errors: [
        {
          code: checkHandDetected(0)!.code,
          message:
            "We couldn't find a hand — keep your whole hand in view, fingers together, and retake.",
          detail: { kind: "handNotDetected", on: "nothing" },
        },
      ],
      overlay: { ...overlayBase, landmarksPx: null },
    };
  const handDecision = decideHand(input, hand.handedness);
  const overlay = {
    ...overlayBase,
    landmarksPx: hand.landmarksPx,
    handedness: hand.handedness,
  };
  const errors = [
    ...(hand.handedness
      ? [
          checkHandedness(
            hand.handedness,
            handDecision.stated,
            input.handednessFixInstruction,
          ),
        ]
      : [checkLandmarkConfidence(0)]),
    ...(hand.handedness ? [checkLandmarkConfidence(hand.confidence)] : []),
  ].filter(
    (failure): failure is NonNullable<typeof failure> => failure !== null,
  );
  if (errors.length) return { status: "error", errors, overlay };
  const straightnessFailure = checkUserLengthStraightness(hand.landmarksPx);
  if (straightnessFailure)
    return { status: "error", errors: [straightnessFailure], overlay };
  let measurements: HandMeasurements;
  try {
    measurements = measureWithUserLength(hand.landmarksPx, handLengthMm);
  } catch {
    return {
      status: "error",
      errors: [
        {
          code: "MEASUREMENT_OUT_OF_RANGE",
          message: userLengthRetakeMessage(handLengthMm),
          detail: { kind: "typedLength", typedMm: handLengthMm },
        },
      ],
      overlay,
    };
  }
  const proportionFailure = checkUserLengthProportion(measurements);
  if (proportionFailure)
    return { status: "error", errors: [proportionFailure], overlay };
  const imageData = getImageData(bitmap, width, height);
  // In the worker where there is one (F8).
  const laplacianVariance = await offloadedSharpness(
    imageData,
    () => getImageData(bitmap, width, height),
    trace,
  );
  trace.laplacianVariance = laplacianVariance;
  const sharpnessFailure = checkSharpness(laplacianVariance);
  const submission = assembleUserLengthSubmission({
    hand: handDecision.submitted,
    gripStyleStated: input.gripStyleStated,
    measurements,
    handLengthMm,
  });
  return {
    status: "ok",
    measurements,
    submission,
    warnings: sharpnessFailure ? [sharpnessFailure] : [],
    overlay,
  };
}
