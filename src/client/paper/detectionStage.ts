/**
 * Scan S2 (V3.2, 2026-10-21, candidate 未拍板): WHERE the paper detector
 * stopped when it found no sheet, as a named stage.
 *
 * A stage says which step of the algorithm (`detect.ts`'s header) the frame
 * failed at. It does not say what physically happened: a sheet "split" by a
 * hand, by a shadow band or by a light desk can all end at the same step, so
 * the words shown for a stage say "may" (`src/lib/copy/paper-stage.ts`), and a
 * frame that fits none of the named steps is `unknown`.
 *
 * - `no_bright_region`: no bright, low-saturation region of any size (the
 *   largest one is under `MIN_PIECE_FRACTION` of the frame).
 * - `region_split`: the bright pixels are there, but in pieces: two or more
 *   sizeable pieces that together would pass the area floor while none does
 *   alone; or a region that fills under half of the quad fitted around it.
 * - `too_small`: one sizeable piece, but under the area floor (or the fitted
 *   quad is under its own floor) and nothing else would make up the rest.
 * - `aspect_mismatch`: a quad was found, but it is not the chosen paper's
 *   rectangle (the orientation residual or the rectified aspect check).
 * - `exception`: something threw while looking.
 * - `unknown`: every other way out (too few boundary points, a degenerate or
 *   non-convex quad, a region much LARGER than its quad, a frame under 20 px).
 *
 * Diagnostic only: no stage changes whether a frame is accepted, its corners
 * or any number measured from it. Pure.
 */
import { PAPER_DETECTION_STAGES } from "../../lib/contracts/analytics";
import type { Locale } from "../../lib/contracts/locale";
import {
  paperStageCopy,
  type PaperStageCopy,
  type PaperStageLines,
} from "../../lib/copy/paper-stage";

/**
 * The stages are the analytics contract's `PAPER_DETECTION_STAGES` (V3.2 F6):
 * one list, so the value `scan_rejected.paperStage` carries is always one the
 * contract accepts.
 */
export { PAPER_DETECTION_STAGES };

export type PaperDetectionStage = (typeof PAPER_DETECTION_STAGES)[number];

export function isPaperDetectionStage(
  value: unknown,
): value is PaperDetectionStage {
  return (
    typeof value === "string" &&
    (PAPER_DETECTION_STAGES as readonly string[]).includes(value)
  );
}

/** Which lines of `src/lib/copy/paper-stage.ts` stand for each stage. */
export const PAPER_STAGE_COPY_KEYS: Record<
  PaperDetectionStage,
  keyof PaperStageCopy
> = {
  no_bright_region: "noBrightRegion",
  region_split: "regionSplit",
  aspect_mismatch: "aspectMismatch",
  too_small: "tooSmall",
  exception: "exception",
  unknown: "unknown",
};

/** The live line and the retake sentence for a stage, in a locale. Pure. */
export function paperStageLines(
  stage: PaperDetectionStage,
  locale: Locale,
): PaperStageLines {
  return paperStageCopy(locale)[PAPER_STAGE_COPY_KEYS[stage]];
}

/**
 * The smallest piece of bright region (a fraction of the frame) that counts as
 * "a piece of paper" when telling the stages apart. Classification only (no
 * gate reads it): 2 % of a frame is about a fifth of the 10 % area floor, so a
 * sheet cut in up to five pieces still reads as split, while sensor noise and
 * small reflections stay below it.
 */
export const MIN_PIECE_FRACTION = 0.02;

/**
 * The stage for a frame whose LARGEST bright region is under the detector's
 * area floor (`minAreaFraction` of `pixelCount`). `areas` are the pixel counts
 * of every connected bright region, in any order. Pure; O(areas.length).
 */
export function stageForSmallRegions(
  areas: readonly number[],
  pixelCount: number,
  minAreaFraction: number,
): PaperDetectionStage {
  if (!(pixelCount > 0)) return "unknown";
  const minPiece = MIN_PIECE_FRACTION * pixelCount;
  let largest = 0;
  let pieces = 0;
  let piecesArea = 0;
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i]!;
    if (area > largest) largest = area;
    if (area >= minPiece) {
      pieces += 1;
      piecesArea += area;
    }
  }
  if (largest < minPiece) return "no_bright_region";
  if (pieces >= 2 && piecesArea >= minAreaFraction * pixelCount) {
    return "region_split";
  }
  return "too_small";
}
