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
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../geometry/homography";
import { estimateFocalFromExif } from "../geometry/exif-focal";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
  type CorrectedMeasurementsResult,
} from "../geometry/measurements";
import {
  focalCorroborated,
  judgeParallaxCorrection,
} from "../geometry/parallaxGuard";
import {
  estimateFocalFromHomography,
  type PrincipalPoint,
} from "../geometry/focal-from-homography";
import { centrePrincipalPoint } from "../geometry/camera-pose";
import {
  computeUncorrectedShadow,
  NOMINAL_FOCAL_EQUIV_MM,
  NOMINAL_FOCAL_EQUIV_MM_STILL,
  nominalFocalPxFromLongEdge,
} from "../geometry/nominalFocalShadow";
import type { ReusedFocal } from "../geometry/parallax";
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
import type {
  FocalDiagnostics,
  ParallaxGuardDiagnostics,
  ShadowPriorDiagnostics,
} from "./diagnostics";
import type { PipelineResult } from "./pipeline";
import type { Point3 } from "./handWorld";
import {
  buildPlacementDiagnostics,
  type PlacementDiagnostics,
} from "./placementDiagnostics";

export interface PaperEdgeFinishInput {
  /**
   * The detection, in the analysed (possibly cropped) image's pixels. All four
   * corners found. For a frame the person placed (V3.2 F2), its four labelled
   * corners and `paperRegionFound: true`: only these two fields are read.
   */
  readonly quad: Pick<SheetQuadDetection, "corners" | "paperRegionFound">;
  /**
   * `evaluatePaperEdgeCalibration(quad, paperSize, false)`, with its geometry,
   * or `evaluateManualPaperCalibration` for a placed frame (a homography, no
   * fitted edge). Only the homography of the geometry is read.
   */
  readonly paperEval: Pick<
    PaperEdgeCalibrationResult,
    "ok" | "errors" | "calibration"
  > & {
    readonly geometry: { readonly homography: Homography } | null;
  };
  readonly paperSize: PaperSize;
  /** What MediaPipe found, in the analysed image's pixels. */
  readonly hand: {
    readonly landmarksPx: readonly Point2[];
    readonly handedness: "left" | "right" | null;
    readonly confidence: number;
    /** V3.3 WP1b (log only): MediaPipe's world landmarks and per-point z, when it gave them. */
    readonly worldLandmarks?: readonly Point3[] | null;
    readonly landmarkZ?: readonly number[] | null;
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
  /**
   * Shadow mode (candidate; landmark-raw-v3: the uncorrected numbers beside
   * the reported ones): for the diagnostics only. Default true. `false` skips
   * it; the result is the same either way
   * (tests/unit/paper-edge-finish-shadow.test.ts).
   */
  readonly shadowPrior?: boolean;
  /** Replaces the shadow computation; a seam for the test that it cannot change the result. */
  readonly computeShadow?: typeof computeUncorrectedShadow;
  /**
   * landmark-raw-v3 (candidate, design R7 §1.3): the long edge, in the decoded
   * photo's pixels, of the whole camera frame the photo came from; the nominal
   * focal prior is taken on it. Only a frame of the video that was cut before
   * it got here passes it (`frameFocalReferenceLongEdgePx`), and passing it
   * is what marks the photo as a video frame (18 mm prior). Omitted (or not a
   * finite number above 0), the photo is a still: the whole decoded photo's
   * long edge at the still lens (26 mm, `nominalPriorFor`).
   */
  readonly focalReferenceLongEdgePx?: number;
  /**
   * F10 item 2 (R6 F1, candidate): a frame the person placed only. The same
   * photo's focal length from its automatic run, used when this photo has no
   * EXIF focal length of its own (`resolveFocalPx`). Omitted on the automatic
   * path, which is therefore exactly what it was.
   */
  readonly reusedFocal?: ReusedFocal | null;
}

export interface PaperEdgeFinish {
  readonly result: PipelineResult;
  /** Whether the parallax correction ran; `null` when the run ended before it. */
  readonly parallaxCorrected: boolean | null;
  /** The focal length the correction used; `null` when the run ended before it. */
  readonly focal: FocalDiagnostics | null;
  /** What the nominal focal prior would have changed; `null` unless the run ended in a measurement (or shadow mode is off). Not part of `result`. */
  readonly shadowPrior: ShadowPriorDiagnostics | null;
  /** V3.2 F16: the correction the safety check refused, `null` when none was (`guardCorrection`). Not part of `result`. */
  readonly parallaxGuard: ParallaxGuardDiagnostics | null;
  /**
   * V3.3 WP1b (candidate, log only): where the hand lay and how flat it was
   * (placementDiagnostics.ts), read off the same corrected points the
   * measurement used. Present only on a run that ended in a measurement. Not
   * part of `result`; nothing reads it but the attempt log.
   */
  readonly placement?: PlacementDiagnostics | null;
}

/**
 * V3.2 F16 (candidate, 未拍板): the parallax correction's safety check
 * (parallaxGuard.ts). A correction is not used when a ratio of the three
 * lengths is outside the limits (`judgeParallaxCorrection`) AND its focal
 * length is not backed by the photo (`focalCorroborated`: not from EXIF, and
 * not near the sheet homography's own focal estimate, worked out about
 * `principalPoint`). The scan is then measured from the same landmarks with
 * no correction (`computeHandMeasurements`, the uncorrected path), with
 * `parallaxCorrected: false` and `focalSource: "none"` (the contract's "no
 * correction was made"), so the engine scale leaves it as it is. The refusal
 * and its numbers go to the local attempt log only.
 *
 * Known gap (未拍板, for Claude): scan_quality reads `focalSource` and the
 * shadow prior after this step, so a refused correction is sent as
 * `focalSource: "none"`, `parallaxCorrected: false`, `priorEffect` within_2,
 * the same as a scan that had no focal length at all.
 *
 * A scan that was not corrected, or whose uncorrected lengths cannot be
 * worked out, is returned as it came. Pure.
 */
export function guardCorrection(
  corrected: CorrectedMeasurementsResult,
  landmarksPx: readonly Point2[],
  homography: Homography,
  principalPoint: PrincipalPoint,
): {
  readonly corrected: CorrectedMeasurementsResult;
  readonly refusal: ParallaxGuardDiagnostics | null;
} {
  if (
    !corrected.parallaxCorrected ||
    corrected.fPx === null ||
    corrected.focalSource === "none"
  )
    return { corrected, refusal: null };
  let uncorrected;
  try {
    uncorrected = computeHandMeasurements(landmarksPx, homography);
  } catch {
    // Nothing to fall back to: the corrected numbers stand, as before F16.
    return { corrected, refusal: null };
  }
  const verdict = judgeParallaxCorrection(uncorrected, corrected.measurements);
  if (verdict.accept) return { corrected, refusal: null };
  if (
    focalCorroborated(
      corrected.focalSource,
      corrected.fPx,
      corrected.focalSource === "exif"
        ? null
        : (estimateFocalFromHomography(homography, principalPoint)?.fPx ??
            null),
    )
  )
    return { corrected, refusal: null };
  return {
    corrected: {
      measurements: uncorrected,
      parallaxCorrected: false,
      focalSource: "none",
      fPx: null,
      heightsMm: null,
    },
    refusal: {
      refused: true,
      reason: verdict.reason,
      field: verdict.field,
      ratios: verdict.ratios,
      refusedFocal: { source: corrected.focalSource, px: corrected.fPx },
    },
  };
}

/**
 * The nominal focal prior for this photo, px (landmark-raw-v3, candidate).
 * A frame of the live video (`focalReferenceLongEdgePx` passed) gets the
 * video frame's lens (`NOMINAL_FOCAL_EQUIV_MM`, 18 mm, Kirby's S25 frames,
 * 實測) on the whole stream's long edge. Anything else (an upload, the
 * camera's takePhoto picture) is a still: the still lens
 * (`NOMINAL_FOCAL_EQUIV_MM_STILL`, 26 mm, candidate 未拍板, F17 review) on the
 * whole decoded photo's long edge. `null` only for a size that is not a
 * number.
 */
export function nominalPriorFor(
  focalFrame: FrameSize,
  focalReferenceLongEdgePx?: number,
): number | null {
  if (
    typeof focalReferenceLongEdgePx === "number" &&
    Number.isFinite(focalReferenceLongEdgePx) &&
    focalReferenceLongEdgePx > 0
  ) {
    return nominalFocalPxFromLongEdge(
      focalReferenceLongEdgePx,
      NOMINAL_FOCAL_EQUIV_MM,
    );
  }
  return nominalFocalPxFromLongEdge(
    Math.max(focalFrame.width, focalFrame.height),
    NOMINAL_FOCAL_EQUIV_MM_STILL,
  );
}

const finiteOrNull = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

/**
 * The shadow for an ok scan (landmark-raw-v3: the uncorrected lengths, their
 * hand-length delta to the reported one and the homography's own focal
 * estimate). Wrapped so that nothing it does, a throw included, can reach the
 * scan: the worst case is a `null` delta.
 */
function shadowPriorOf(
  input: PaperEdgeFinishInput,
  frames: ReturnType<typeof analysisFrames>,
  homography: Homography,
  reported: {
    readonly handLengthMm: number;
    readonly palmLengthMm: number;
    readonly palmWidthMm: number;
  },
): ShadowPriorDiagnostics | null {
  if (input.shadowPrior === false) return null;
  const compute = input.computeShadow ?? computeUncorrectedShadow;
  try {
    const shadow = compute({
      // Copies: whatever the shadow does to its input, the scan's own points stay as they are.
      landmarksPx: input.hand.landmarksPx.map((p) => ({ x: p.x, y: p.y })),
      homography,
      principalFrame: frames.principalFrame,
      reported: {
        handLengthMm: reported.handLengthMm,
        palmLengthMm: reported.palmLengthMm,
        palmWidthMm: reported.palmWidthMm,
      },
    });
    const delta = finiteOrNull(shadow?.handLengthDeltaMm);
    const u = shadow?.uncorrected;
    const uncorrected =
      u &&
      finiteOrNull(u.handLengthMm) !== null &&
      finiteOrNull(u.palmLengthMm) !== null &&
      finiteOrNull(u.palmWidthMm) !== null
        ? {
            handLengthMm: u.handLengthMm,
            palmLengthMm: u.palmLengthMm,
            palmWidthMm: u.palmWidthMm,
          }
        : null;
    const h = shadow?.homographyFocal;
    const homographyFocal =
      h && finiteOrNull(h.px) !== null && typeof h.reliable === "boolean"
        ? { px: h.px, reliable: h.reliable }
        : null;
    return {
      handLengthDeltaMm: delta,
      uncorrected,
      reported: {
        handLengthMm: reported.handLengthMm,
        palmLengthMm: reported.palmLengthMm,
        palmWidthMm: reported.palmWidthMm,
      },
      homographyFocal,
    };
  } catch {
    return {
      handLengthDeltaMm: null,
      uncorrected: null,
      reported: null,
      homographyFocal: null,
    };
  }
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
      shadowPrior: null,
      parallaxGuard: null,
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
      shadowPrior: null,
      parallaxGuard: null,
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

  let corrected: CorrectedMeasurementsResult;
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
        ...(input.reusedFocal ? { reusedFocal: input.reusedFocal } : {}),
        // landmark-raw-v3 (candidate): the nominal prior, last before none.
        nominalFocalPx: nominalPriorFor(
          frames.focalFrame,
          input.focalReferenceLongEdgePx,
        ),
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
      shadowPrior: null,
      parallaxGuard: null,
    };
  }

  // V3.2 F16: a correction that cannot be right is not used.
  const guarded = guardCorrection(
    corrected,
    hand.landmarksPx,
    geometry.homography,
    centrePrincipalPoint(
      frames.principalFrame.width,
      frames.principalFrame.height,
    ),
  );
  corrected = guarded.corrected;
  const parallaxGuard = guarded.refusal;

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
      shadowPrior: null,
      parallaxGuard,
    };
  }
  const submission = assemblePaperEdgeSubmission({
    hand: handDecision.submitted,
    gripStyleStated: input.request.gripStyleStated,
    measurements: corrected.measurements,
    paperSize: calibration.paperSize,
    cornersSource: calibration.cornersSource,
    edgeFitResidualMm: calibration.edgeFitResidualMm,
    minSideCoverage: calibration.minSideCoverage,
    parallaxCorrected: corrected.parallaxCorrected,
    focalSource: corrected.focalSource,
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
    // Beside the result, never in it: the measurements, the submission and the
    // warnings above are already final.
    shadowPrior: shadowPriorOf(
      input,
      frames,
      geometry.homography,
      corrected.measurements,
    ),
    parallaxGuard,
    placement: placementOf(input, frames, geometry.homography, corrected),
  };
}

/**
 * V3.3 WP1b (log only): the placement record of an ok scan, from the
 * measurement's own focal length and heights (so the points are the ones it
 * was read off). Copies of the landmarks go in; a throw is `null`.
 */
function placementOf(
  input: PaperEdgeFinishInput,
  frames: ReturnType<typeof analysisFrames>,
  homography: Homography,
  corrected: CorrectedMeasurementsResult,
): PlacementDiagnostics | null {
  try {
    return buildPlacementDiagnostics({
      landmarksPx: input.hand.landmarksPx.map((p) => ({ x: p.x, y: p.y })),
      homography,
      paperSize: input.paperSize,
      analysed: frames.principalFrame,
      fPx: corrected.parallaxCorrected ? corrected.fPx : null,
      heightsMm: corrected.parallaxCorrected ? corrected.heightsMm : null,
      worldLandmarks: input.hand.worldLandmarks ?? null,
      landmarkZ: input.hand.landmarkZ ?? null,
    });
  } catch {
    return null;
  }
}
