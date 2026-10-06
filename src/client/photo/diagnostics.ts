/**
 * What the pipeline measured about itself while it ran: sizes, timings and the
 * numbers its gates looked at. Plain numbers and short codes, never pixels. It
 * exists so the easy scan can keep a local record of every attempt
 * (`src/client/camera/attemptLog.ts`), because when a scan is rejected the
 * error code alone does not say why (a sheet that fills 65 % of the photo and a
 * sheet that fills 90 % can both read "PAPER_CURLED").
 */
import type { FrameSize, PixelRect } from "../camera/visibleView";

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
  /** The smallest fraction of any side that was seen, 0-1. */
  readonly minSideCoverage: number;
  /**
   * The paper gates that failed, by code. Listed even where the result goes on
   * to report another error first: a photo with no hand reports only that, and
   * this still says whether the sheet would have passed.
   */
  readonly gateFailures: readonly string[];
}

export interface HandDiagnostics {
  /** `null` when the pipeline stopped before it looked for a hand. */
  readonly detected: boolean | null;
  readonly confidence: number | null;
  readonly handedness: "left" | "right" | null;
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
}

type Pt = { readonly x: number; readonly y: number };

const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

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
