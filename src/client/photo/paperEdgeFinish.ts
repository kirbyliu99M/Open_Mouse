/**
 * The second half of the plain-paper pipeline, once the sheet and a hand have
 * been found: the hand gates, the EXIF focal length, the parallax-corrected
 * measurements and the result with its overlay. Split out of `pipeline.ts`
 * (which needs a canvas, MediaPipe and a decoded bitmap) so that everything
 * that depends on whether the photo was cropped to the part the person saw is
 * pure and can be run, and tested, in Node (its wiring is tested through the real
 * pipeline in tests/unit/pipeline-view-crop.test.ts).
 *
 * When the photo was cropped (`visibleView.ts`), the quad and the landmarks are
 * in the CROPPED image's pixels, and three things must stay right:
 *
 * 1. The EXIF focal length in pixels is worked out from the whole decoded
 *    photo's size (`frames.focalFrame`): a crop narrows the picture, not the
 *    lens.
 * 2. The principal point is the centre of the image that was analysed
 *    (`frames.principalFrame`); the crop is centred, so that is the whole
 *    photo's centre.
 * 3. The overlay (paper corners, landmarks) is reported in the WHOLE decoded
 *    photo's pixels (`toFullFrame`), so the frozen photo and the result sheet
 *    need not know there was a crop.
 */
import {
  PAPER_SIZES_MM,
  type PaperSize,
} from "../../lib/contracts/measurement";
import { applyHomography, type Point2 } from "../geometry/homography";
import { estimateFocalFromExif } from "../geometry/exif-focal";
import { computeCorrectedHandMeasurements } from "../geometry/measurements";
import type { PaperEdgeCalibrationResult } from "../paper/calibration";
import type { SheetQuadDetection } from "../paper/detect";
import {
  analysisFrames,
  toFullFrame,
  type FrameSize,
  type PixelRect,
} from "../camera/visibleView";
import { runPaperEdgeHandGates } from "./gates";
import { resolvePipelineHand } from "./hand";
import { assemblePaperEdgeSubmission } from "./submission";
import type { DetectedMarker } from "./markers";
import type { FocalDiagnostics } from "./diagnostics";
import type { PipelineResult } from "./pipeline";

export interface PaperEdgeFinishInput {
  /** The detection, in the analysed (possibly cropped) image's pixels. All four corners found. */
  readonly quad: SheetQuadDetection;
  /** `evaluatePaperEdgeCalibration(quad, paperSize, false)`, with its geometry. */
  readonly paperEval: PaperEdgeCalibrationResult;
  readonly paperSize: PaperSize;
  /** What MediaPipe found, in the analysed image's pixels. */
  readonly hand: {
    readonly landmarksPx: readonly Point2[];
    readonly handedness: "left" | "right" | null;
    readonly confidence: number;
  };
  readonly request: {
    readonly hand: "left" | "right";
    readonly handExplicit?: boolean;
    readonly handednessFixInstruction?: string;
    readonly gripStyleStated?: "palm" | "claw" | "fingertip";
  };
  readonly laplacianVariance: number;
  /** The decoded photo's size (the whole of it). */
  readonly decoded: FrameSize;
  /** The crop that was analysed, in the decoded photo's pixels, or `null`. */
  readonly crop: PixelRect | null;
  /** The photo file's bytes, read only once the gates have passed (for the EXIF focal length). */
  readonly readJpegBytes: () => Promise<Uint8Array | null>;
}

export interface PaperEdgeFinish {
  readonly result: PipelineResult;
  /** Whether the parallax correction ran; `null` when the run ended before it. */
  readonly parallaxCorrected: boolean | null;
  /** The focal length the correction used; `null` when the run ended before it. */
  readonly focal: FocalDiagnostics | null;
}

/**
 * The hand gates, the focal length, the corrected measurements and the result.
 * `quad.corners` and `paperEval.geometry` are required (the caller has already
 * turned back a photo without them).
 */
export async function finishPaperEdge(
  input: PaperEdgeFinishInput,
): Promise<PaperEdgeFinish> {
  const { quad, paperEval, hand, crop } = input;
  const frames = analysisFrames(input.decoded, crop);
  const toFull = (p: Point2): Point2 => toFullFrame(p, crop);
  const overlayBase = {
    imageWidth: input.decoded.width,
    imageHeight: input.decoded.height,
    markers: [] as DetectedMarker[],
    card: null,
  };
  const corners = quad.corners;
  const geometry = paperEval.geometry;
  if (!corners || !geometry) {
    return {
      result: {
        status: "error",
        errors: paperEval.errors,
        overlay: { ...overlayBase, landmarksPx: null },
      },
      parallaxCorrected: null,
      focal: null,
    };
  }
  const paperCornersFull = corners.map(toFull) as unknown as readonly [
    Point2,
    Point2,
    Point2,
    Point2,
  ];
  const handFull = hand.landmarksPx.map(toFull);
  const handDecision = resolvePipelineHand({
    selected: input.request.hand,
    detected: hand.handedness,
    explicit: input.request.handExplicit !== false,
  });

  const landmarksMm = hand.landmarksPx.map((p) =>
    applyHomography(geometry.homography, p),
  );
  const { width: paperWidthMm, height: paperHeightMm } =
    PAPER_SIZES_MM[input.paperSize];
  const paperCornersMm: Point2[] = [
    { x: 0, y: 0 },
    { x: paperWidthMm, y: 0 },
    { x: paperWidthMm, y: paperHeightMm },
    { x: 0, y: paperHeightMm },
  ];

  // Paper gates ran once, inside evaluatePaperEdgeCalibration; only the hand
  // gates run here, and both sets of failures are reported together.
  const handReport = runPaperEdgeHandGates({
    paperFound: quad.paperRegionFound,
    landmarkCount: hand.landmarksPx.length,
    handedness: hand.handedness,
    handStated: handDecision.stated,
    handednessFixInstruction: input.request.handednessFixInstruction,
    landmarkConfidence: hand.confidence,
    landmarksMm,
    paperCornersMm,
    laplacianVariance: input.laplacianVariance,
  });
  const report = {
    errors: [...paperEval.errors, ...handReport.errors],
    warnings: handReport.warnings,
    ok: paperEval.ok && handReport.ok,
  };
  const overlay = {
    ...overlayBase,
    landmarksPx: handFull,
    handedness: hand.handedness,
    paperCorners: paperCornersFull,
  };

  if (!report.ok) {
    return {
      result: { status: "error", errors: report.errors, overlay },
      parallaxCorrected: null,
      focal: null,
    };
  }

  let exifFocalPx: number | null = null;
  try {
    const jpegBytes = await input.readJpegBytes();
    // The WHOLE decoded photo's size, even when it was cropped.
    exifFocalPx = jpegBytes
      ? (estimateFocalFromExif(jpegBytes, {
          widthPx: frames.focalFrame.width,
          heightPx: frames.focalFrame.height,
        })?.fPx ?? null)
      : null;
  } catch {
    // A malformed/unreadable EXIF block must not fail the scan — it just
    // means no parallax correction (same as no EXIF at all).
    exifFocalPx = null;
  }

  let corrected;
  try {
    // The analysed image's size gives the principal point (its centre), which
    // a centred crop leaves where it was.
    corrected = computeCorrectedHandMeasurements(
      hand.landmarksPx,
      geometry.homography,
      {
        exifFocalPx,
        widthPx: frames.principalFrame.width,
        heightPx: frames.principalFrame.height,
      },
    );
  } catch {
    return {
      result: {
        status: "error",
        errors: [
          {
            code: "MEASUREMENT_OUT_OF_RANGE",
            message:
              "These measurements look implausible — retake with your whole hand flat on the sheet and the camera directly overhead.",
          },
        ],
        overlay,
      },
      parallaxCorrected: null,
      focal: null,
    };
  }

  const focal: FocalDiagnostics = {
    source: corrected.focalSource,
    px: corrected.fPx,
  };

  // Type narrowing only: report.ok required paperEval.ok, and a passing
  // evaluation always carries its calibration. Its fields are what gets
  // submitted.
  const calibration = paperEval.calibration;
  if (!calibration) {
    return {
      result: {
        status: "error",
        errors: paperEval.errors,
        overlay: { ...overlayBase, landmarksPx: handFull },
      },
      parallaxCorrected: corrected.parallaxCorrected,
      focal,
    };
  }
  const submission = assemblePaperEdgeSubmission({
    hand: handDecision.submitted,
    gripStyleStated: input.request.gripStyleStated,
    measurements: corrected.measurements,
    paperSize: calibration.paperSize,
    edgeFitResidualMm: calibration.edgeFitResidualMm,
    minSideCoverage: calibration.minSideCoverage,
    parallaxCorrected: corrected.parallaxCorrected,
  });
  return {
    result: {
      status: "ok",
      measurements: corrected.measurements,
      submission,
      warnings: report.warnings,
      overlay,
    },
    parallaxCorrected: corrected.parallaxCorrected,
    focal,
  };
}
