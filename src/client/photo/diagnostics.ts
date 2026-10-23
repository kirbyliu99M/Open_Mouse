/**
 * What the pipeline measured about itself while it ran: sizes, timings and the
 * numbers its gates looked at. Plain numbers and short codes, never pixels. It
 * exists so the easy scan can keep a local record of every attempt
 * (`src/client/camera/attemptLog.ts`), because when a scan is rejected the
 * error code alone does not say why (a sheet that fills 65 % of the photo and a
 * sheet that fills 90 % can both read "PAPER_CURLED").
 */
import { computeQuadSkew } from "../camera/quad";
import { screenSideOfPaperSide, type PaperSide } from "../camera/paperGate";
import { lowestCoverageSide } from "../paper/detect";
import type { PaperDetectionStage } from "../paper/detectionStage";
import type { FrameSize, PixelRect } from "../camera/visibleView";
import type { HandFlatness } from "./handFlatness";
import type { AnalysisThread } from "./offMainAnalysis";
import type { PaperCornerSource } from "../../lib/contracts/measurement";
import type {
  ParallaxGuardField,
  ParallaxGuardRatios,
  ParallaxGuardReason,
} from "../geometry/parallaxGuard";

export interface PaperDiagnostics {
  /** Corners whose two sides were both fitted, 0-4. */
  readonly cornersSeen: number;
  /** A paper-sized region was found at all. */
  readonly paperRegionFound: boolean;
  /**
   * The sheet's width and height as a fraction of the analysed photo's: the
   * mean of its two long edges (or two short edges) over the photo's width
   * (height). `null` unless all four corners were found. The same measure as the
   * live cue's width fraction (`computeQuadWidthFraction`).
   */
  readonly widthFraction: number | null;
  readonly heightFraction: number | null;
  /** The worst side's mean edge-fit distance in mm, the number `PAPER_CURLED` is decided on; `null` without four corners. */
  readonly edgeFitResidualMm: number | null;
  /**
   * The largest deviation of the sheet's four corners from a right angle in the
   * photo, in degrees (`computeQuadSkew`), which is how straight on the shot
   * was; `null` unless all four corners were found. Read only for the
   * `paperSkew` bucket; no gate looks at it (the live auto-shutter has its own
   * limit in camera/constants.ts).
   */
  readonly maxAngleDeviationDeg: number | null;
  /**
   * The sheet's observed shape: the mean of its top and bottom edges over the
   * mean of its left and right edges, in the analysed photo's pixels (the
   * short side over the long, so about 0.7071 for A4 seen flat and straight
   * on); `null` unless all four corners were found. The same ratio as
   * `widthFraction * analysed width / (heightFraction * analysed height)`,
   * worked out from the corners so that no rounding or second photo size
   * enters it. Read only for the `paperAspect` bucket (2026-10-17,
   * candidate); no gate looks at it.
   */
  readonly observedAspect: number | null;
  /** The smallest fraction of any side that was seen, 0-1; `null` for a frame the person placed (no side was fitted). */
  readonly minSideCoverage: number | null;
  /**
   * The four per-side coverages, 0-1, in the detector's side order (0 = the
   * short side from the top-left to the top-right corner, then clockwise);
   * `null` where the detector did not measure them. Paper geometry only (scan
   * S3, 2026-10-19): it says which edge the 0.225-0.35 minimum was on.
   */
  readonly sideCoverages: readonly [number, number, number, number] | null;
  /**
   * The side with the lowest coverage, as the person sees it on the screen;
   * `null` without four corners, on a tie for the lowest, with every side
   * fully seen, or where the quad is turned too far for a plain name.
   */
  readonly worstSide: PaperSide | null;
  /**
   * The paper gates that failed, by code. Listed even where the result goes on
   * to report another error first: a photo with no hand reports only that, and
   * this still says whether the sheet would have passed.
   */
  readonly gateFailures: readonly string[];
  /**
   * Where the paper detector stopped when it found no sheet (scan S2,
   * 2026-10-21, candidate): one of `PAPER_DETECTION_STAGES`; `null` when a
   * sheet was found, and absent where nothing set it (hand-built diagnostics
   * in tests). A step of the algorithm, not a proven cause.
   */
  readonly failureStage?: PaperDetectionStage | null;
  /**
   * V3.2 F2 (candidate): where the corners came from, as the submission's
   * `cornersSource` says. Absent for the detector's own corners (every run
   * before V3.2 and every detected run since); `adjusted` or `manual` for a
   * frame the person placed, whose edge numbers are then `null`.
   */
  readonly cornersSource?: PaperCornerSource;
}

export interface HandDiagnostics {
  /** `null` when the pipeline stopped before it looked for a hand. */
  readonly detected: boolean | null;
  readonly confidence: number | null;
  readonly handedness: "left" | "right" | null;
  /**
   * SHADOW MODE (2026-10-19, 未拍板 candidate): how flat the four fingers look
   * (`assessHandFlatness`), a grade and two ratios of distances in the same
   * picture. Worked out from the landmarks the one detection already returned;
   * no gate, measurement or submission reads it. `null` when no hand was
   * detected. Stays on the device (the attempt log); only the grade leaves, as
   * the `handPose` bucket of the scan events.
   */
  readonly flatness: HandFlatness | null;
}

/** What the person saw, and how it was carried over to the photo (visibleView.ts). */
export interface ViewDiagnostics {
  /** The stream's size at the moment of capture. */
  readonly stream: FrameSize;
  /** The part of the stream that was on screen, in the stream's pixels. */
  readonly visibleInStream: PixelRect;
  /** Which relation between the stream and the photo was used. */
  readonly model: string;
  /** The centred-part model holds (the stream was no wider a view than the photo). */
  readonly modelApplies: boolean;
  /** (stream - photo) / photo, in long over short. */
  readonly aspectDiff: number;
}

export interface PipelineDiagnostics {
  readonly decodeMs: number | null;
  /** Looking for the sheet. */
  readonly paperMs: number | null;
  /** Looking for the hand. */
  readonly handMs: number | null;
  readonly totalMs: number;
  /** The decoded, oriented photo (at most 3000 px on its long edge); `null` when it would not decode. */
  readonly decoded: { readonly width: number; readonly height: number } | null;
  /** What was analysed: the same, unless the photo was cropped to the preview's field of view. */
  readonly analysed: { readonly width: number; readonly height: number } | null;
  /**
   * The crop that was applied, in the decoded photo's pixels; `null` when none
   * was. It is now the crop to the part of the photo the person saw on screen
   * (visibleView.ts); the field keeps its first name, `fovCrop`, so that the
   * JSON the attempt log and the debug panel produce, and the documents that
   * describe it, do not change.
   */
  readonly fovCrop: PixelRect | null;
  /** `null` for an upload (no viewfinder) or where the region could not be worked out. */
  readonly view: ViewDiagnostics | null;
  readonly paper: PaperDiagnostics | null;
  /** Laplacian variance of the analysed photo; `null` where the pipeline stopped before it was worked out. */
  readonly laplacianVariance: number | null;
  readonly hand: HandDiagnostics;
  /** Whether the parallax correction ran; `null` where the pipeline stopped before that. */
  readonly parallaxCorrected: boolean | null;
  /**
   * The hand length and palm width of an ok scan, exactly as the result and the
   * submission carry them (unrounded); `null` for a run that did not end in a
   * measurement.
   */
  readonly measured: MeasuredDiagnostics;
  /** Where the parallax correction's focal length came from, and its value; `null` where the pipeline stopped before that. */
  readonly focal: FocalDiagnostics | null;
  /**
   * SHADOW MODE (2026-10-16, candidate; turned round in landmark-raw-v3: the
   * uncorrected numbers beside the reported ones): worked out beside the real
   * measurement and used by nothing in it;
   * `null` where the run did not end in a measurement. Stays on the device (the
   * attempt log, and the `priorEffect` bucket of `scan_quality`).
   */
  readonly shadowPrior: ShadowPriorDiagnostics | null;
  /**
   * V3.2 F16 (candidate): a parallax correction the safety check did not use
   * (`parallaxGuard.ts`), with why; `null` when no correction was refused;
   * absent in hand-built diagnostics (tests). Local attempt log only: it
   * changes no number beyond the refusal itself and is not sent to analytics.
   */
  readonly parallaxGuard?: ParallaxGuardDiagnostics | null;
  /**
   * V3.2 F8 (candidate): where the sheet detector and the sharpness ran,
   * `worker` (a Web Worker, off the main thread) or `fallback` (the main
   * thread, because the worker was missing or failed; `fallback` as soon as
   * any one step fell back); `null` where neither ran; absent in hand-built
   * diagnostics (tests). Local attempt log
   * only: it changes no number and is not sent to analytics.
   */
  readonly analysisThread?: AnalysisThread | null;
}

export interface ShadowPriorDiagnostics {
  /**
   * Since landmark-raw-v3 (candidate): the UNCORRECTED hand length minus the
   * one reported, in mm (before v3 it was the nominal prior's minus the
   * reported one; the contract's `PRIOR_EFFECT_BUCKETS` says the same).
   * `null` when the shadow could not be worked out (it never fails the scan).
   */
  readonly handLengthDeltaMm: number | null;
  /**
   * landmark-raw-v3 (candidate), local attempt log only, never analytics: the
   * same landmarks with no parallax correction, mm, for Kirby's S25 check of
   * the engine-scale ratios (design R7 §5.3). Absent before v3; `null` when
   * they could not be worked out.
   */
  readonly uncorrected?: {
    readonly handLengthMm: number;
    readonly palmLengthMm: number;
    readonly palmWidthMm: number;
  } | null;
  /**
   * landmark-raw-v3 (candidate), local attempt log only: the three lengths
   * the scan reported, mm, beside `uncorrected` (the measured engine-scale
   * ratios are uncorrected over reported). Absent before v3.
   */
  readonly reported?: {
    readonly handLengthMm: number;
    readonly palmLengthMm: number;
    readonly palmWidthMm: number;
  } | null;
  /**
   * landmark-raw-v3 (candidate), local attempt log only: the homography's own
   * focal estimate, px, and whether it was judged reliable, whether or not the
   * correction used it (design R7 §5.3 b). Absent before v3; `null` when no
   * estimate could be made.
   */
  readonly homographyFocal?: {
    readonly px: number;
    readonly reliable: boolean;
  } | null;
}

export interface MeasuredDiagnostics {
  readonly handLengthMm: number | null;
  readonly palmWidthMm: number | null;
}

/** A parallax correction that was worked out and then not used (V3.2 F16, candidate). */
export interface ParallaxGuardDiagnostics {
  readonly refused: true;
  readonly reason: ParallaxGuardReason;
  /** The first length that failed the check. */
  readonly field: ParallaxGuardField;
  /** Uncorrected over corrected, unrounded. */
  readonly ratios: ParallaxGuardRatios;
  /** The focal length the refused correction used. */
  readonly refusedFocal: {
    readonly source: "exif" | "homography" | "nominal";
    readonly px: number;
  };
}

export interface FocalDiagnostics {
  readonly source: "exif" | "homography" | "nominal" | "none";
  /** In px; `null` when `source` is "none" (no correction was possible). */
  readonly px: number | null;
}

type Pt = { readonly x: number; readonly y: number };

const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * How far the sheet's corners are from right angles, in degrees
 * (`computeQuadSkew`, the same measure the live cue reads), from the detector's
 * corners (TL, TR, BR, BL). `null` where it is not a finite number.
 */
export function paperMaxAngleDeviationDeg(
  corners: readonly [Pt, Pt, Pt, Pt],
): number | null {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const { maxAngleDeviationDeg } = computeQuadSkew({
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  });
  return Number.isFinite(maxAngleDeviationDeg) ? maxAngleDeviationDeg : null;
}

/**
 * The on-screen name of the side with the lowest coverage, from the detector's
 * four corners (TL, TR, BR, BL) and its four per-side coverages; `null` when
 * either is missing, when two or more sides tie for the lowest, when all are
 * fully seen, or when the quad is turned too far for a plain name.
 */
export function paperWorstSide(
  corners: readonly [Pt, Pt, Pt, Pt] | null,
  sideCoverages: readonly number[] | null | undefined,
): PaperSide | null {
  if (!corners || !sideCoverages || sideCoverages.length !== 4) return null;
  const index = lowestCoverageSide(sideCoverages);
  if (index === null) return null;
  return screenSideOfPaperSide(corners, index);
}

/**
 * The sheet's share of the photo: its width (mean of the top and bottom edges)
 * over the photo's width, and its height (mean of the left and right edges) over
 * the photo's height. Corners are TL, TR, BR, BL, as `detectPaperQuad` gives
 * them (TL to TR is the sheet's short side). `null` for a photo without a size.
 */
export function paperSizeFractions(
  corners: readonly [Pt, Pt, Pt, Pt],
  imageWidth: number,
  imageHeight: number,
): { widthFraction: number; heightFraction: number } | null {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;
  const [tl, tr, br, bl] = corners;
  return {
    widthFraction: (len(tl, tr) + len(bl, br)) / 2 / imageWidth,
    heightFraction: (len(tl, bl) + len(tr, br)) / 2 / imageHeight,
  };
}

/**
 * The sheet's observed width over height (see `PaperDiagnostics.observedAspect`):
 * the mean of the top and bottom edges over the mean of the left and right
 * edges, from the detector's corners (TL, TR, BR, BL; TL to TR is the sheet's
 * short side). `null` where it is not a finite positive number.
 */
export function paperObservedAspect(
  corners: readonly [Pt, Pt, Pt, Pt],
): number | null {
  const [tl, tr, br, bl] = corners;
  const aspect = (len(tl, tr) + len(bl, br)) / (len(tl, bl) + len(tr, br));
  return Number.isFinite(aspect) && aspect > 0 ? aspect : null;
}
