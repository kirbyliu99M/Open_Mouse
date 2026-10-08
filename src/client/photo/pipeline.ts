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
import { detectPaperQuad } from "../paper/detect";
import { evaluatePaperEdgeCalibration } from "../paper/calibration";
import type {
  HandMeasurements,
  ScanSubmission,
} from "../../lib/contracts/measurement";
import {
  analysisFrames,
  assumedDetectionFocalPx,
  visibleRectInStill,
  type FrameSize,
  type PixelRect,
} from "../camera/visibleView";
import { finishPaperEdge } from "./paperEdgeFinish";
import {
  paperSizeFractions,
  type FocalDiagnostics,
  type HandDiagnostics,
  type PaperDiagnostics,
  type PipelineDiagnostics,
  type ViewDiagnostics,
} from "./diagnostics";

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
    hand: { detected: null, confidence: null, handedness: null },
    parallaxCorrected: null,
    focal: null,
  };
}

/** Looks for the hand, noting how long that took and what it found. */
async function detectHandTraced(
  bitmap: ImageBitmap,
  trace: PipelineTrace,
): Promise<Awaited<ReturnType<typeof detectHandLandmarks>>> {
  const startedAt = performance.now();
  try {
    const hand = await detectHandLandmarks(bitmap);
    trace.hand = hand
      ? {
          detected: true,
          confidence: hand.confidence,
          handedness: hand.handedness,
        }
      : { detected: false, confidence: null, handedness: null };
    return hand;
  } finally {
    trace.handMs = performance.now() - startedAt;
  }
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
    return runPaperEdgePipeline(decoded, input, calibration.paperSize, trace);
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

  const hand = await detectHandTraced(bitmap, trace);
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

  const handDecision = decideHand(input, hand.handedness);

  const landmarksMm = hand.landmarksPx.map((p) =>
    applyHomography(homography, p),
  );
  const flatMarkerCornersMm = layout.markers
    .filter((m) => (SHEET.flatMarkerIds as readonly number[]).includes(m.id))
    .flatMap((m) => m.corners);

  const gray = rgbaToGrayscale(imageData.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);
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
      decoded.bitmap.close();
      width = crop.width;
      height = crop.height;
    } catch {
      // A crop that fails is not a reason to fail the scan: the whole photo is analysed.
      crop = null;
    }
  }
  trace.fovCrop = crop;
  trace.analysed = { width, height };
  const frames = analysisFrames({ width: fullWidth, height: fullHeight }, crop);
  const imageData = getImageData(bitmap, width, height);
  // The sharpness is worked out first, so a photo that is turned back before
  // it reaches the hand gates (no sheet, no hand) still has one in its record
  // (diagnostics.ts). If it cannot be worked out here it is tried again below,
  // exactly as before.
  const gray = rgbaToGrayscale(imageData.data, width * height);
  try {
    trace.laplacianVariance = computeLaplacianVariance(gray, width, height);
  } catch {
    trace.laplacianVariance = null;
  }

  const paperStartedAt = performance.now();
  // The assumed focal length is the whole photo's, not the crop's: a crop
  // narrows the picture, not the lens (visibleView.ts). Without a crop it is
  // what the detector would have assumed anyway. A frame that was cut before
  // it got here says how wide the picture it was cut from was.
  const quad = detectPaperQuad(imageData, paperSize, {
    focalPxHint: assumedDetectionFocalPx(frames, input.focalReferenceWidthPx),
  });
  trace.paperMs = performance.now() - paperStartedAt;
  const quadSize = quad.corners
    ? paperSizeFractions(quad.corners, width, height)
    : null;
  trace.paper = {
    cornersSeen: quad.cornersSeen,
    paperRegionFound: quad.paperRegionFound,
    widthFraction: quadSize?.widthFraction ?? null,
    heightFraction: quadSize?.heightFraction ?? null,
    edgeFitResidualMm: null,
    minSideCoverage: quad.minSideCoverage,
    gateFailures: [],
  };
  // The overlay is always in the whole decoded photo's pixels.
  const overlayBase = {
    imageWidth: fullWidth,
    imageHeight: fullHeight,
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
    trace.paper = { ...trace.paper, gateFailures: [failure.code] };
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
  // only known after EXIF is read (finishPaperEdge), so it is set on the
  // submission from the real flag there; the placeholder here never reaches it.
  const paperEval = evaluatePaperEdgeCalibration(quad, paperSize, false);
  // Which paper gates failed, even where the result below goes on to report
  // another error first (a photo with no hand reports only that).
  trace.paper = {
    ...trace.paper,
    edgeFitResidualMm: paperEval.geometry?.edgeFitResidualMm ?? null,
    gateFailures: paperEval.errors.map((error) => error.code),
  };
  if (!paperEval.geometry) {
    return {
      status: "error",
      errors: paperEval.errors,
      overlay: { ...overlayBase, landmarksPx: null },
    };
  }

  const hand = await detectHandTraced(bitmap, trace);
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

  const laplacianVariance =
    trace.laplacianVariance ?? computeLaplacianVariance(gray, width, height);
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
  });
  trace.parallaxCorrected = finish.parallaxCorrected;
  trace.focal = finish.focal;
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
  const hand = await detectHandTraced(bitmap, trace);
  if (!hand)
    return {
      status: "error",
      errors: [
        {
          code: checkHandDetected(0)!.code,
          message:
            "We couldn't find a hand — keep your whole hand in view, fingers together, and retake.",
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
        },
      ],
      overlay,
    };
  }
  const proportionFailure = checkUserLengthProportion(measurements);
  if (proportionFailure)
    return { status: "error", errors: [proportionFailure], overlay };
  const imageData = getImageData(bitmap, width, height);
  const gray = rgbaToGrayscale(imageData.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);
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
