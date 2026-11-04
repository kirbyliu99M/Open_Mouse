/**
 * Scan Lab (L3a, 2026-10-29): find an ID-1 card's 4 corners in a photo that
 * also holds an A4 sheet, for the "can a card alone be the scale reference?"
 * experiment (`scan-lab-2026-10-29/PROGRAM.md`). Lab only: nothing in the
 * real scan flow calls this, and every threshold here is candidate (未拍板).
 *
 * Two placements, both with the card's back facing up:
 * (a) `on-paper`: the card lies on the sheet — searched inside the sheet;
 * (b) `beside-paper`: the card lies on the table next to the sheet —
 *     searched in a band just outside it (the table may be wood or dark).
 * With the sheet known, only a card whose centre is on the placement's side
 * of the sheet's edge counts (L5: Kirby's photos hold two cards, one on the
 * sheet and one beside it); a card may touch the sheet's edge, and that side
 * is then fitted on the sheet-white-to-card edge (`coarse.ts`).
 *
 * Pipeline: `coarse.ts` finds card-shaped outlines from colour gradients
 * (on a downscaled copy for big photos), the best one is picked here, and
 * `refine.ts` fits each straight edge at full resolution and intersects
 * them, because the card's rounded corners put every outline vertex on an
 * arc, inside the real corner. Failures say why (`CardFailureCode`) and never
 * carry a guessed corner.
 *
 * L7 (2026-11-02), Kirby's fifth round:
 * - a two-colour card (red body, navy band along a long side) is found whole:
 *   a colour region's outline may be extended across a band of another
 *   colour (`coarse.ts` step 9); an extension is tried only when the
 *   region's own outline measured as the wrong size or shape;
 * - when the plain search finds no card, a second one runs on colour
 *   regions that stop at faint edges (the red card on the red and black mat
 *   leaked into the mat), so a card the first search finds keeps its pre-L7
 *   corners;
 * - with no sheet, colour regions are searched too and a card must pass
 *   shape-on-its-plane (`focalPx`), rounded-corner (`cornerCheck.ts`),
 *   clean-edge and size checks (`withoutSheet`); better no card than a
 *   wrong one;
 * - `card_clipped` needs an edge-backed outline (and, with no sheet, no
 *   bigger than half the frame).
 *
 * L11 (2026-11-04), Kirby's black card on the dark maze mat (hand mode,
 * card only):
 * - with no sheet, a colour region at the frame too big to be a cut-off
 *   card (the card's region merged with the mat) turns a `card_clipped`
 *   (or `no_candidate`) answer into `card_blends_background`;
 * - with no sheet and a `searchRegion` (the hand guide's card slot), when
 *   neither search finds a card, the box is searched for four straight
 *   edges (`lineSearch.ts`); a quad found so must pass every no-sheet check
 *   (corners judged by `cornerCheck.ts#cornerEdgeShapes` where the colours
 *   are too close for `cornerShapes`). `method` says which search found it.
 *
 * Coordinates: every point in and out is full-resolution image px, x right,
 * y down, pixel centres at +0.5 (`detect.ts`'s convention).
 */
import { ID1_CARD_MM } from "../../../lib/contracts/measurement";
import type { Point2 } from "../../geometry/homography";
import { scoreQuadAsCard } from "../../photo/card";
import {
  isConvexQuad,
  orderQuadCorners,
  polygonArea,
} from "../../paper/quad-math";
import { pointInConvexQuad } from "../../paper/palmChoice";
import {
  ABUT_SLACK_PX,
  buildSearchMask,
  distanceToQuadOutline,
  findCoarseCandidates,
  paperEdgeMarginPx,
  type CardPlacement,
  type CoarseCandidate,
  type PixelRect,
  type Quad,
} from "./coarse";
import { downscaleImage, isValidRgbaImage, type RgbaImage } from "./image";
import {
  cornerEdgeShapes,
  cornerShapes,
  showsRoundedCorner,
} from "./cornerCheck";
import { findCardByLines } from "./lineSearch";
import { cardOnPaperPlane, rectangleFromFocal } from "./planeCheck";
import { refineCardQuad, type CardSideFit } from "./refine";

/** Re-exported so a caller (the L3b page) needs only this module. */
export type { CardPlacement, PixelRect, Quad, RgbaImage, CardSideFit };

/** Per side, 0 = TL-TR, 1 = TR-BR, 2 = BR-BL, 3 = BL-TL. */
export type SideFits = readonly [
  CardSideFit,
  CardSideFit,
  CardSideFit,
  CardSideFit,
];

/** Where to look for the card; all points and rectangles in full-resolution image px. */
export interface DetectCardOptions {
  /** The sheet's 4 corners in image px (e.g. `detectPaperQuad(...).corners`); any start corner, either winding. */
  readonly paperCorners?: Quad | null;
  /** Where to look relative to the sheet. Ignored without `paperCorners`. */
  readonly placement?: CardPlacement;
  /** Only look inside this rectangle (image px). */
  readonly searchRegion?: PixelRect | null;
  /**
   * L12: with no sheet and no `searchRegion`, a box (image px) for the
   * straight-edge search only (`lineSearch.ts`), tried after both outline
   * searches of the whole frame found no card: a card those find keeps
   * exactly its corners. The hand guides without a card slot (G0, G-A4)
   * pass the box beside the hand (`hand/handCardRegion.ts`).
   */
  readonly linesRegion?: PixelRect | null;
  /**
   * The coarse search runs on a copy box-averaged down until its long edge
   * is at most this many px (refinement always uses full resolution).
   * Default 1200; candidate 未拍板.
   */
  readonly coarseMaxLongEdgePx?: number;
  /**
   * The sheet's true long side, mm (default 297, A4). Only used with
   * `paperCorners`, to judge failure evidence by the card size the sheet's
   * scale implies (`failureEvidence`); a found card is never judged by it.
   */
  readonly paperLongMm?: number;
  /**
   * The sheet's true short side, mm (default 210, A4). With `paperLongMm`,
   * the sheet's homography measures each candidate on the table (L6,
   * `planeCheck.ts`).
   */
  readonly paperShortMm?: number;
  /**
   * Whether the sheet's TL-TR side (after `orderQuadCorners`) is its long
   * side; default the pixel order. Only for the L6 size check.
   */
  readonly paperLongSideFirst?: boolean;
  /** The card's real size, mm (default ID-1); the L6 size check reads candidates against it. */
  readonly cardSizeMm?: { readonly longMm: number; readonly shortMm: number };
  /**
   * L7: the camera's focal length, full-image px (e.g. the nominal prior).
   * Only used with no sheet, to judge a candidate's shape on its own plane
   * (`planeCheck.ts#rectangleFromFocal`); without it the pixel aspect is
   * used (`CARD_ASPECT_TOLERANCE`).
   */
  readonly focalPx?: number | null;
  /** L7: the principal point, full-image px; default the image centre. */
  readonly principalPoint?: { readonly x: number; readonly y: number } | null;
}

/**
 * Why no card came back:
 * - `invalid_input`: the image's dimensions and data length disagree.
 * - `no_candidate`: nothing card-shaped in the search area.
 * - `card_clipped`: an outline in the search area, no bigger than a card
 *   could look (`CLIPPED_MAX_EXPECTED_FRACTION`; with no sheet,
 *   `NO_PAPER_CLIPPED_MAX_FRACTION` of the frame, L7), with at least
 *   `CLIPPED_MIN_EDGE_SUPPORT` of its outline backed by edges (L7), runs off
 *   the frame (a corner of its quad within 3 coarse px of the border, L5)
 *   and no whole card was found (move back or re-centre).
 * - `too_small`: the largest card-shaped outline found has a long side under
 *   `MIN_CARD_LONG_SIDE_PX` (move closer). Outlines under
 *   `MIN_CONSIDERED_LONG_SIDE_PX` (punched holes, grid squares, specks) are
 *   not card evidence at all and never make this code (L4, 2026-10-30).
 * - `edge_fit_failed`: a side of the best candidate had too few clean edge
 *   points to fit a line (blur, low contrast, something on the edge).
 * - `implausible_quad`: the fitted corners are not a convex, card-shaped quad
 *   near the coarse outline, or fall outside the frame; with no sheet (L7),
 *   also a quad that is not card-shaped on its own plane, lacks a card's
 *   rounded corners, has a side that is not one clean edge, or is too big.
 * - `size_mismatch` (L6, only with the sheet): the card-shaped quad does not
 *   measure as the card on the table through the sheet's homography (a side
 *   pair off by more than `SIZE_TOLERANCE`, a corner off a right angle by
 *   more than `MAX_PLANE_ANGLE_ERROR_DEG`, or its long side in the image is
 *   its short side on the table: the record's `orientation.disagrees` case).
 * - `card_under_paper` (L6, only with the sheet): one side of the quad lies
 *   along the sheet's edge, that side is as long as a card side, and the
 *   card's extent across it is short: the sheet lies over part of the card
 *   and hides its far edge (move the card clear of the sheet).
 * - `card_blends_background` (L11, only with no sheet): the answer would
 *   have been `card_clipped` (or `no_candidate`), but a colour region running off the frame is
 *   far bigger than a card could look (long side over
 *   `NO_PAPER_CLIPPED_MAX_FRACTION` of the frame's short side, or more
 *   pixels than a card at `NO_PAPER_MIN_DISTANCE_MM`): the card's colour
 *   is too close to the table's to tell them apart (use a light or shiny
 *   card). Kirby's black card on the dark maze mat, 2026-11-03.
 */
export type CardFailureCode =
  | "invalid_input"
  | "no_candidate"
  | "card_clipped"
  | "too_small"
  | "edge_fit_failed"
  | "implausible_quad"
  | "size_mismatch"
  | "card_under_paper"
  | "card_blends_background";

/**
 * L11: which search found the card: `outline` (the colour-region and
 * edge-component candidates of `coarse.ts`) or `lines` (four straight
 * edges inside the search box, `lineSearch.ts`).
 */
export type CardMethod = "outline" | "lines";

/** `detectCard`'s answer: the fitted corners, or why there are none. */
export type CardDetection =
  | {
      readonly ok: true;
      /** TL, TR, BR, BL (`orderQuadCorners`), sub-pixel image px: intersections of the fitted edges. */
      readonly corners: Quad;
      /** The coarse outline's vertices (on the rounded corners), same order — diagnostic only, never measure from these. */
      readonly coarseCorners: Quad;
      /** Per side: residual (px) and points used. */
      readonly sides: SideFits;
      /** Largest of the four side residuals, px. */
      readonly worstResidualPx: number;
      /** `true` when TL-TR (and BR-BL) is the card's long (85.6 mm) side. */
      readonly longSideFirst: boolean;
      /** L11: which search found it (absent on results built before L11). */
      readonly method?: CardMethod;
    }
  | {
      readonly ok: false;
      readonly failure: CardFailureCode;
      /** The candidate it stopped on, if it got that far (diagnostic, never a measurement). */
      readonly coarseCorners: Quad | null;
      readonly sides: SideFits | null;
      /** L11: the straight-edge search of the search box ran and found no card. */
      readonly linesTried?: boolean;
    };

/** A card whose long side is shorter than this in the full image is `too_small`. Candidate 未拍板. */
export const MIN_CARD_LONG_SIDE_PX = 120;
/**
 * Card-shaped outlines with a long side under this are ignored outright, not
 * reported as `too_small`: at 40 px a card is about 0.5 px/mm, far beyond any
 * photo the lab takes, while a loose-leaf sheet's punched holes measured 15-18
 * px on Kirby's 1080 x 1920 photos (L4). Candidate 未拍板.
 */
export const MIN_CONSIDERED_LONG_SIDE_PX = 40;
/**
 * With a sheet in the photo, the card's long side should be about
 * `85.6 / paperLongMm` of the sheet's. A rejected outline is only reported
 * as `too_small` when it is at least this fraction of that size, and as
 * `card_clipped` when it is at most `CLIPPED_MAX_EXPECTED_FRACTION` of it (a
 * cut-off card cannot look bigger than a card). L4: on Kirby's photos a
 * 52 px blob (expected card about 317 px) said `too_small`, and desk-mat
 * outlines 1745-1875 px long said `card_clipped`. Candidate 未拍板.
 */
export const TOO_SMALL_MIN_EXPECTED_FRACTION = 0.4;
export const CLIPPED_MAX_EXPECTED_FRACTION = 1.3;
/** Aspect-ratio tolerance against ID-1's 1.586 (same as `photo/card.ts`'s CARD_SCORE_TOLERANCE). Candidate 未拍板. */
export const CARD_ASPECT_TOLERANCE = 0.15;
/** A candidate needs at least this share of its outline backed by edge pixels (`CoarseCandidate.edgeSupport`). Candidate 未拍板. */
export const MIN_EDGE_SUPPORT = 0.7;
/** A refined corner may move at most this far from its coarse vertex: max(8 px, this many mm). Candidate 未拍板. */
export const MAX_REFINE_SHIFT_MM = 4;

/**
 * L6 (2026-11-01): with the sheet found, the fitted card's two side pairs,
 * measured on the table through the sheet's homography (`planeCheck.ts`),
 * must each be within this fraction of the card's real size. Data: on the 27
 * cards found on Kirby's three rounds of photos (2026-10-29, 10-30, 11-01)
 * the worst were -2.9 % (83.1 mm long, 19-48-52 on grid paper) and +1.5 %
 * (54.8 mm short, 08-38-50); the false card on 13-09-10 measured 39.8 x 25.4
 * mm (-53 %). 6 % is twice the worst real card and still catches a card with
 * 3.3 mm of its 54 mm side under the sheet. Candidate 未拍板.
 */
export const SIZE_TOLERANCE = 0.06;
/**
 * A fitted card with a side along the sheet's edge is `card_under_paper`
 * when its extent across that side is short of the card by more than this
 * fraction (the sheet hides the rest). Tighter than `SIZE_TOLERANCE`
 * because the direction of the error is known. Data: the 18 cards found
 * beside the sheet on Kirby's photos measured 53.9-54.8 mm across (ID-1:
 * 53.98), the lowest any found card measured on any side pair was -1.8 %
 * (52.8-53.1 mm, on grid paper, 2026-10-29); 3 % (1.6 mm of a 54 mm side)
 * leaves a 1-point margin below that. A card hidden by less than this is
 * found, and its measures carry that error. Candidate 未拍板.
 */
export const UNDER_PAPER_TOLERANCE = 0.03;
/**
 * ...and every corner within this many degrees of a right angle on the
 * table. Data: real cards 0.12-1.99 deg; 13-09-10's false card 44.8 deg.
 * Candidate 未拍板.
 */
export const MAX_PLANE_ANGLE_ERROR_DEG = 6;
/**
 * The coarse outline (on the rounded corners, 1-2 px off) is checked the
 * same way with these looser limits before refinement, so a candidate that
 * is plainly not the card is never refined. Candidate 未拍板.
 */
export const COARSE_SIZE_TOLERANCE = 0.15;
export const COARSE_MAX_PLANE_ANGLE_ERROR_DEG = 12;
/** With the sheet, at most this many candidates (largest first) that pass the coarse check are refined. Candidate 未拍板. */
export const MAX_CANDIDATES_TRIED = 4;
/**
 * With the sheet, the pixel aspect-ratio tolerance (`scoreQuadAsCard`, ratio
 * minus ID-1's 1.586) is widened to this, because the table-plane check
 * judges the shape: perspective alone stretches a card's pixel ratio (13-09-10
 * at a 16 deg phone tilt: 0.205; 13-09-12: 0.291, both a whole card on the
 * table, 84 x 53-54 mm). 0.6 allows about 40 deg of tilt along the card's
 * short side. Candidate 未拍板.
 */
export const SHEET_KNOWN_ASPECT_TOLERANCE = 0.6;

const DEFAULT_COARSE_MAX_LONG_EDGE_PX = 1200;

type PlaneVerdict = "ok" | "size_mismatch" | "card_under_paper";

/**
 * L6: read a card quad (TL, TR, BR, BL, full-image px) on the table through
 * the sheet's homography. `alongPaper[i]` says whether side i lies along the
 * sheet's edge. See `SIZE_TOLERANCE` and `card_under_paper`.
 */
function planeVerdict(
  quad: Quad,
  paper: Quad,
  paperLongMm: number,
  paperShortMm: number,
  paperLongSideFirst: boolean | undefined,
  card: { readonly longMm: number; readonly shortMm: number },
  alongPaper: readonly boolean[],
  tolerance: number,
  maxAngleDeg: number,
  underPaperTolerance: number,
): PlaneVerdict {
  const pc = cardOnPaperPlane(
    quad,
    paper,
    paperLongMm,
    paperShortMm,
    paperLongSideFirst,
  );
  if (!pc) return "size_mismatch";
  const within = (mm: number, truth: number) =>
    Math.abs(mm / truth - 1) <= tolerance;
  // A side along the sheet as long as one of the card's sides, with the
  // card's extent across it short: the sheet covers the rest.
  for (let i = 0; i < 4; i++) {
    if (!alongPaper[i]) continue;
    const along = pc.sideMm[i];
    const across = (pc.sideMm[(i + 1) % 4] + pc.sideMm[(i + 3) % 4]) / 2;
    const alongIsLong =
      Math.abs(along / card.longMm - 1) <= Math.abs(along / card.shortMm - 1);
    const alongTruth = alongIsLong ? card.longMm : card.shortMm;
    const acrossTruth = alongIsLong ? card.shortMm : card.longMm;
    if (
      // The side along the sheet is judged at the fine limit even on the
      // coarse pass (coarse corners are only 1-2 px off), so a wrong typed
      // card size is a size mismatch, not a card under the sheet.
      Math.abs(along / alongTruth - 1) <= SIZE_TOLERANCE &&
      across < acrossTruth * (1 - underPaperTolerance)
    ) {
      return "card_under_paper";
    }
  }
  if (
    !within(pc.longMm, card.longMm) ||
    !within(pc.shortMm, card.shortMm) ||
    pc.maxAngleErrorDeg > maxAngleDeg ||
    pc.pixelLongSideFirst !== pc.planeLongSideFirst
  ) {
    return "size_mismatch";
  }
  return "ok";
}

function longSideOf(q: Quad): number {
  const l = (i: number) =>
    Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y);
  return Math.max((l(0) + l(2)) / 2, (l(1) + l(3)) / 2);
}

function fail(
  failure: CardFailureCode,
  coarseCorners: Quad | null = null,
  sides: SideFits | null = null,
): CardDetection {
  return { ok: false, failure, coarseCorners, sides };
}

function scaleQuad(q: Quad, f: number): Quad {
  const s = (p: Point2) => ({ x: p.x * f, y: p.y * f });
  return [s(q[0]), s(q[1]), s(q[2]), s(q[3])];
}

/**
 * L7 (2026-11-02), no sheet in view: there is no size check, so the card
 * must at least be card-SHAPED on the table. With `focalPx`, the fitted
 * quad's plane aspect (`planeCheck.ts#rectangleFromFocal`) must be within
 * this fraction of the card's, and its corner angle within
 * `NO_PAPER_MAX_ANGLE_ERROR_DEG` of 90. Data (L7, Kirby's five rounds, the
 * cards found with the sheet re-run without it, nominal focal): see the
 * PROGRAM.md row of 2026-11-02. An A4 sheet (1.414 against ID-1's 1.586,
 * -10.8 %) is outside it. Candidate 未拍板.
 */
export const NO_PAPER_ASPECT_TOLERANCE = 0.06;
export const NO_PAPER_MAX_ANGLE_ERROR_DEG = 8;
/** The same on the coarse outline, before refinement. Candidate 未拍板. */
export const NO_PAPER_COARSE_ASPECT_TOLERANCE = 0.15;
export const NO_PAPER_COARSE_MAX_ANGLE_ERROR_DEG = 12;
/**
 * No sheet: every fitted side must use at least this share of its samples
 * (a real card's edge is one straight line end to end; a printed or
 * textured rectangle on a mat often is not). Real cards found with the
 * sheet: lowest 0.62 (L7). Candidate 未拍板.
 */
export const NO_PAPER_MIN_SIDE_INLIER_FRACTION = 0.5;
/**
 * No sheet: the card may be no nearer the camera than this, mm, so its long
 * side is at most focal x long side / this many px (with no focal: half the
 * frame's short side). Kirby's closest lab photo (19-48-29, the sheet cut
 * off) has the card 740 px long at a nominal focal of 960 px (about 11 cm).
 * Candidate 未拍板.
 */
export const NO_PAPER_MIN_DISTANCE_MM = 100;
/**
 * No sheet: at most this many of the fitted quad's corners may look sharp,
 * and at least `NO_PAPER_MIN_ROUNDED_CORNERS` must look rounded
 * (`cornerCheck.ts`). On Kirby's 19-41-14 and 19-41-48 (no card in the
 * photo) the sheet plus a strip of dark mat below it made a card-shaped
 * rectangle on the table with four clean sides; its two top corners are the
 * sheet's, sharp. A card lying flush against the sheet's edge often shows
 * one or two square corners there (round 3: rrrs, rrss), so one is allowed.
 * Candidate 未拍板.
 */
export const NO_PAPER_MAX_SHARP_CORNERS = 1;
export const NO_PAPER_MIN_ROUNDED_CORNERS = 2;
export const NO_PAPER_MAX_LONG_FRACTION = 0.5;
/**
 * L7: an outline running off the frame is only `card_clipped` evidence when
 * at least this share of its sides away from the frame is backed by edge
 * pixels (`CoarseCandidate.edgeSupport`, which counts the frame side as
 * unbacked) and, with no sheet, its long side is at most
 * `NO_PAPER_CLIPPED_MAX_FRACTION` of the frame's short side. Kirby's
 * 15-49-48 (whole card, reported card_clipped) was a mat outline at the
 * frame. Candidate 未拍板.
 */
export const CLIPPED_MIN_EDGE_SUPPORT = 0.5;
export const NO_PAPER_CLIPPED_MAX_FRACTION = 0.5;

/** One outline `detectCard` may try: a coarse candidate's quad, or one of its L7 band extensions. */
interface Variant {
  readonly quad: Quad;
  readonly area: number;
  readonly base: boolean;
}

/** A coarse candidate's outlines that passed the shape screen, base first. */
interface Group {
  readonly variants: Variant[];
  readonly area: number;
}

/**
 * Find the card. See the module comment; `options` say where to look.
 * Never throws for a valid image.
 */
export function detectCard(
  image: RgbaImage,
  options: DetectCardOptions = {},
): CardDetection {
  if (!isValidRgbaImage(image)) return fail("invalid_input");
  const maxEdge =
    options.coarseMaxLongEdgePx ?? DEFAULT_COARSE_MAX_LONG_EDGE_PX;
  const factor = Math.max(
    1,
    Math.ceil(Math.max(image.width, image.height) / maxEdge),
  );
  const small = downscaleImage(image, factor);
  const inv = 1 / factor;
  const paper = options.paperCorners
    ? orderQuadCorners(options.paperCorners)
    : null;
  const smallPaper = paper ? scaleQuad(paper, inv) : null;
  const mask = buildSearchMask(small.width, small.height, {
    paperCorners: smallPaper,
    placement: options.placement,
    searchRegion: options.searchRegion
      ? {
          x: options.searchRegion.x * inv,
          y: options.searchRegion.y * inv,
          width: options.searchRegion.width * inv,
          height: options.searchRegion.height * inv,
        }
      : null,
  });
  // L7: with no sheet, colour regions too (a card on a patterned mat has
  // edges that merge with the pattern; its inside is one colour).
  const colourRegions =
    smallPaper !== null ? options.placement === "beside-paper" : true;
  // L5: a quad "reaches the frame" when a corner is this close to the border
  // or beyond it (the coarse copy's 2 px border band, in full-image px).
  const frameBand = 3 * factor;
  const reachesFrame = (q: Quad) =>
    q.some(
      (p) =>
        p.x <= frameBand ||
        p.y <= frameBand ||
        p.x >= image.width - frameBand ||
        p.y >= image.height - frameBand,
    );

  const card = options.cardSizeMm ?? {
    longMm: Math.max(ID1_CARD_MM.width, ID1_CARD_MM.height),
    shortMm: Math.min(ID1_CARD_MM.width, ID1_CARD_MM.height),
  };
  const focal =
    options.focalPx && options.focalPx > 0
      ? {
          f: options.focalPx,
          cx: options.principalPoint?.x ?? image.width / 2,
          cy: options.principalPoint?.y ?? image.height / 2,
        }
      : null;
  const frameShort = Math.min(image.width, image.height);

  const paperArea = paper ? polygonArea(paper) : Infinity;
  const expectedCardLongPx = paper
    ? (longSideOf(paper) * Math.max(ID1_CARD_MM.width, ID1_CARD_MM.height)) /
      (options.paperLongMm ?? 297)
    : null;
  // Without a sheet there is no scale; L7: a cut-off card is at most half
  // the frame's short side (Kirby's whole cards: 190-360 px of 1080).
  const clippedMaxPx =
    expectedCardLongPx !== null
      ? CLIPPED_MAX_EXPECTED_FRACTION * expectedCardLongPx
      : NO_PAPER_CLIPPED_MAX_FRACTION * frameShort;
  const tooSmallMinPx =
    expectedCardLongPx !== null
      ? Math.max(
          MIN_CONSIDERED_LONG_SIDE_PX,
          TOO_SMALL_MIN_EXPECTED_FRACTION * expectedCardLongPx,
        )
      : MIN_CONSIDERED_LONG_SIDE_PX;
  // L11: no sheet: the most pixels a whole card can cover (its long side at
  // most `maxLongPx`, see `withoutSheet`), and whether a colour region at
  // the frame bigger than that, or longer than `clippedMaxPx`, was seen.
  const noSheetMaxLongPx = focal
    ? (focal.f * card.longMm) / NO_PAPER_MIN_DISTANCE_MM
    : NO_PAPER_MAX_LONG_FRACTION * frameShort;
  const maxCardAreaPx =
    (noSheetMaxLongPx * noSheetMaxLongPx * card.shortMm) / card.longMm;
  let blendsSeen = false;
  /** Screen and try one set of coarse candidates (see below). */
  const decide = (candidates: readonly CoarseCandidate[]): CardDetection => {
    // When no whole card is found, the failure is the reason the LARGEST
    // rejected card evidence was turned down, so a speck cannot outvote a card.
    let rejected: { failure: CardFailureCode; longPx: number } | null = null;
    const partial: Quad[] = [];
    // L6: with the sheet, the table-plane check below judges the shape, so the
    // pixel aspect only has to allow for perspective. L7: so does the focal
    // check with no sheet.
    const aspectTolerance =
      paper || focal ? SHEET_KNOWN_ASPECT_TOLERANCE : CARD_ASPECT_TOLERANCE;
    const reject = (failure: CardFailureCode, longPx: number) => {
      if (!rejected || longPx > rejected.longPx) rejected = { failure, longPx };
    };
    /**
     * The shape screen for one outline (full-image px). `base` outlines
     * record why they were turned down; L7 extensions only pass or not.
     */
    const screen = (
      quad: Quad,
      support: number,
      c: CoarseCandidate,
      base: boolean,
    ): Variant | null => {
      if (!isConvexQuad(quad)) return null;
      const area = polygonArea(quad);
      // The sheet itself, or sheet + card. (Until L4 a quad holding the sheet's
      // centre was also dropped as "the sheet", which threw away every card
      // lying in the middle of the sheet: Kirby's 2026-10-29 photos.)
      if (paper && area > 0.5 * paperArea) return null;
      if (
        paper &&
        paper.filter((p) => pointInConvexQuad(p, quad)).length >= 3
      ) {
        return null;
      }
      // L5: the placement says which side of the sheet's edge the card is on;
      // its centre decides (a card may touch the sheet's edge).
      if (paper && options.placement) {
        const centre = {
          x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
          y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
        };
        const inside = pointInConvexQuad(centre, paper);
        if (inside !== (options.placement === "on-paper")) return null;
      }
      const longPx = longSideOf(quad);
      if (longPx < MIN_CONSIDERED_LONG_SIDE_PX) return null;
      // L5: cut off only when the outline itself runs to the frame. A component
      // that reaches the border through a wood-grain line, around a card that
      // does not, is judged by its shape like any other (Kirby's 08-39-02
      // photo: card 10 px from the edge, reported card_clipped until L5).
      if (c.touchesBorder && reachesFrame(quad)) {
        if (
          base &&
          longPx >= MIN_CARD_LONG_SIDE_PX / 2 &&
          longPx <= clippedMaxPx &&
          support >= CLIPPED_MIN_EDGE_SUPPORT
        ) {
          reject("card_clipped", longPx);
        } else if (
          // L11: a colour region at the frame far bigger than a card could
          // look: the card (or what looks like one) merged with the table.
          base &&
          !paper &&
          c.source === "region" &&
          (longPx > clippedMaxPx ||
            c.pixelCount * factor * factor > maxCardAreaPx)
        ) {
          blendsSeen = true;
        }
        return null;
      }
      const score = scoreQuadAsCard(quad);
      if (score === null) return null;
      if (support < MIN_EDGE_SUPPORT) return null;
      if (score > aspectTolerance) {
        // L6: a card partly under the sheet is a shorter rectangle than a card;
        // kept aside to say so (`card_under_paper`) if no card is found.
        if (
          base &&
          paper &&
          options.placement === "beside-paper" &&
          longPx >= MIN_CARD_LONG_SIDE_PX
        ) {
          partial.push(orderQuadCorners(quad));
        }
        return null;
      }
      if (longPx < MIN_CARD_LONG_SIDE_PX) {
        if (base && longPx >= tooSmallMinPx) reject("too_small", longPx);
        return null;
      }
      return { quad: orderQuadCorners(quad), area, base };
    };
    const groups: Group[] = [];
    for (const c of candidates) {
      const variants: Variant[] = [];
      const b = screen(scaleQuad(c.quad, factor), c.edgeSupport, c, true);
      if (b) variants.push(b);
      for (const e of c.extensions) {
        const v = screen(scaleQuad(e.quad, factor), e.edgeSupport, c, false);
        if (v) variants.push(v);
      }
      if (variants.length > 0) {
        groups.push({ variants, area: variants[0].area });
      }
    }
    // The largest card-shaped outline is tried first; an L7 band extension
    // only when its own candidate's outline measured as the wrong size or
    // shape (a two-colour card's region holds one colour: a card without the
    // band, too short across). Extending a one-colour card that already
    // measures right could only push a side out onto a mat line.
    groups.sort((p, q) => q.area - p.area);
    if (!paper) {
      return withoutSheet(image, groups, card, focal, frameShort, rejected);
    }
    // With the sheet (L6), the largest card-shaped outline is still tried
    // first, but one that does not measure as the card on the table is passed
    // over for the next largest (13-09-10: the largest was a quad at the
    // table's edge, 39.8 x 25.4 mm).
    const sheet = paper;
    const paperLongMm = options.paperLongMm ?? 297;
    const paperShortMm = options.paperShortMm ?? 210;
    // A side "lies along the sheet" when both its ends are within the masked
    // band at the sheet's edge (plus coarse slack), as in coarse.ts.
    const alongReach = paperEdgeMarginPx(sheet) + ABUT_SLACK_PX * factor;
    const alongPaperOf = (q: Quad) =>
      [0, 1, 2, 3].map(
        (i) =>
          distanceToQuadOutline(q[i], sheet) <= alongReach &&
          distanceToQuadOutline(q[(i + 1) % 4], sheet) <= alongReach,
      );
    const verdict = (
      q: Quad,
      tol: number,
      maxAngle: number,
      underTol: number = tol,
    ) =>
      planeVerdict(
        q,
        sheet,
        paperLongMm,
        paperShortMm,
        options.paperLongSideFirst,
        card,
        alongPaperOf(q),
        tol,
        maxAngle,
        underTol,
      );
    // The failure reported is the largest candidate's that passed the coarse
    // check; failing that, card_under_paper if any candidate was one; then
    // size_mismatch if an outline with ID-1's pixel aspect was turned down by
    // the sheet; else the pre-L6 answer (card_clipped, too_small,
    // no_candidate).
    let firstFailure: CardDetection | null = null;
    let underPaper: Quad | null = null;
    let refinedCount = 0;
    for (const g of groups) {
      if (refinedCount >= MAX_CANDIDATES_TRIED) break;
      let refinedHere = false;
      let groupFailure: CardDetection | null = null;
      let groupUnder: Quad | null = null;
      for (const v of g.variants) {
        // An extension only after the candidate's own outline (when it was
        // card-shaped at all) failed a measure: wrong size, or short across
        // as if under the sheet. Not after a failed edge fit.
        if (!v.base && groupFailure && groupFailure.ok === false) {
          const f = groupFailure.failure;
          if (f !== "size_mismatch" && f !== "card_under_paper") break;
        }
        const coarse = v.quad;
        const pre = verdict(
          coarse,
          COARSE_SIZE_TOLERANCE,
          COARSE_MAX_PLANE_ANGLE_ERROR_DEG,
        );
        if (pre !== "ok") {
          if (pre === "card_under_paper") groupUnder ??= coarse;
          continue;
        }
        refinedHere = true;
        const d = refineAndCheck(
          image,
          coarse,
          aspectTolerance,
          alongPaperOf(coarse),
          alongReach + 2,
        );
        if (!d.ok) {
          // A card running under the sheet has sharp corners at the sheet's edge
          // and may not refine; the coarse outline already says why.
          const under =
            verdict(
              coarse,
              COARSE_SIZE_TOLERANCE,
              COARSE_MAX_PLANE_ANGLE_ERROR_DEG,
              UNDER_PAPER_TOLERANCE,
            ) === "card_under_paper";
          groupFailure ??= under
            ? fail("card_under_paper", coarse, d.sides)
            : d;
          continue;
        }
        const fine = verdict(
          d.corners,
          SIZE_TOLERANCE,
          MAX_PLANE_ANGLE_ERROR_DEG,
          UNDER_PAPER_TOLERANCE,
        );
        if (fine === "ok") return d;
        groupFailure ??= fail(fine, coarse, d.sides);
      }
      if (refinedHere) refinedCount++;
      if (groupFailure) firstFailure ??= groupFailure;
      if (groupUnder) underPaper ??= groupUnder;
    }
    if (firstFailure) return firstFailure;
    if (!underPaper) {
      underPaper =
        partial.find(
          (q) =>
            verdict(
              q,
              COARSE_SIZE_TOLERANCE,
              COARSE_MAX_PLANE_ANGLE_ERROR_DEG,
            ) === "card_under_paper",
        ) ?? null;
    }
    if (underPaper) return fail("card_under_paper", underPaper);
    // Something the pre-L6 rule would have taken for the card (ID-1's pixel
    // aspect) that the sheet says is not one: the 13-09-10 case.
    const cardShaped = groups.find((g) => {
      const score = scoreQuadAsCard(g.variants[0].quad);
      return score !== null && score <= CARD_ASPECT_TOLERANCE;
    });
    if (cardShaped) {
      return fail("size_mismatch", cardShaped.variants[0].quad);
    }
    const r = rejected as { failure: CardFailureCode } | null;
    return fail(r ? r.failure : "no_candidate");
  };
  const first = decide(
    findCoarseCandidates(small, mask, {
      paperCorners: smallPaper,
      colourRegions,
    }).candidates,
  );
  if (first.ok || !colourRegions) return first;
  // L7: a second try, colour regions that stop at faint edges (a card whose
  // colour is close to the mat's: Kirby's red card front on the red and
  // black mat). Only when the first found nothing, so a card the first try
  // finds keeps exactly its pre-L7 corners; the first try's failure is
  // reported when this one finds nothing either.
  const second = decide(
    findCoarseCandidates(small, mask, {
      paperCorners: smallPaper,
      colourRegions: true,
      regionEdgeBarrier: true,
      edgeComponents: false,
    }).candidates,
  );
  if (second.ok) return second;
  // L11: no sheet and a search box (the hand guide's card slot): four
  // straight edges in the box, held to every no-sheet check. L12: or, with
  // no slot, the box beside the hand (`linesRegion`).
  const linesBoxes = options.searchRegion
    ? [options.searchRegion]
    : options.linesRegion
      ? linesWindows(options.linesRegion)
      : [];
  if (!paper && linesBoxes.length > 0) {
    for (const box of linesBoxes) {
      const byLines = searchByLines(image, box, card, focal, noSheetMaxLongPx);
      if (byLines.ok) return byLines;
    }
    const answer = relabel(first, blendsSeen);
    return answer.ok ? answer : { ...answer, linesTried: true };
  }
  return relabel(first, blendsSeen);
}

/**
 * L12: the box beside the hand (`linesRegion`) is about a hand long; the
 * straight-edge search shrinks its box to `LINE_MAX_LONG_EDGE_PX`, and on
 * Kirby's G0 photo (box 444 x 1029 px, shrunk 3 x) it took a maze line for
 * the card's left side, where the slot-sized part of the same box (shrunk
 * 2 x) found the card. So a tall box is searched in windows at most
 * `LINES_WINDOW_PX` tall, overlapping by half, top to bottom. Candidate 未拍板.
 */
export const LINES_WINDOW_PX = 760;

function linesWindows(r: PixelRect): PixelRect[] {
  const long = Math.max(r.width, r.height);
  if (long <= LINES_WINDOW_PX) return [r];
  const out: PixelRect[] = [];
  const along = r.height >= r.width;
  const size = LINES_WINDOW_PX;
  const span = along ? r.height : r.width;
  const n = Math.ceil((span - size) / (size / 2)) + 1;
  for (let i = 0; i < n; i++) {
    const off = Math.min(i * (size / 2), span - size);
    out.push(
      along
        ? { x: r.x, y: r.y + off, width: r.width, height: size }
        : { x: r.x + off, y: r.y, width: size, height: r.height },
    );
  }
  return out;
}

/**
 * L11: with no sheet, a `card_clipped` (or `no_candidate`) answer becomes
 * `card_blends_background` when a colour region at the frame was far
 * bigger than a card could look (see `CardFailureCode`).
 */
function relabel(d: CardDetection, blendsSeen: boolean): CardDetection {
  if (d.ok || !blendsSeen) return d;
  if (d.failure !== "card_clipped" && d.failure !== "no_candidate") return d;
  return { ...d, failure: "card_blends_background" };
}

/**
 * L11: corners for the no-sheet check: `cornerShapes` (colour), and where
 * it cannot judge (inside and outside closer than `CORNER_MIN_CONTRAST`,
 * Kirby's black card on the dark mat), `cornerEdgeShapes` (whether the
 * sides' edges run on into the corner). Only the straight-edge search uses
 * the second; the outline search keeps exactly its L7 rule.
 */
function cornersOk(
  image: RgbaImage,
  corners: Quad,
  edgeFallback: boolean,
): boolean {
  const colour = cornerShapes(image, corners);
  const edge = edgeFallback ? cornerEdgeShapes(image, corners) : null;
  const shapes = colour.map((c, i) => (c === "unknown" && edge ? edge[i] : c));
  return (
    shapes.filter((c) => c === "sharp").length <= NO_PAPER_MAX_SHARP_CORNERS &&
    shapes.filter((c) => c === "rounded").length >= NO_PAPER_MIN_ROUNDED_CORNERS
  );
}

/**
 * L12: the no-sheet corner gate on its own (`cornersOk` and
 * `showsRoundedCorner`), exported for tests: a quad (fitted corners) whose
 * corners do not read as a card's is turned down whatever else it passes.
 * `edgeFallback` as the straight-edge search uses it (corners judged by
 * their edges where the colours are too close). Pure.
 */
export function noSheetCornersPass(
  image: RgbaImage,
  corners: Quad,
  edgeFallback: boolean,
): boolean {
  return (
    cornersOk(image, corners, edgeFallback) &&
    showsRoundedCorner(image, corners)
  );
}

/**
 * L7's no-sheet bar for a refined card (`withoutSheet`): rounded corners,
 * clean sides, size, card-shaped on its plane.
 */
function passesWithoutSheet(
  image: RgbaImage,
  d: Extract<CardDetection, { ok: true }>,
  card: { readonly longMm: number; readonly shortMm: number },
  focal: {
    readonly f: number;
    readonly cx: number;
    readonly cy: number;
  } | null,
  maxLongPx: number,
  edgeCornerFallback: boolean,
): boolean {
  const cleanSides = d.sides.every(
    (s) =>
      s.pointsSampled > 0 &&
      s.pointsUsed / s.pointsSampled >= NO_PAPER_MIN_SIDE_INLIER_FRACTION,
  );
  return (
    cornersOk(image, d.corners, edgeCornerFallback) &&
    // L12: and at least one corner rounded beyond what blur alone gives a
    // sharp one (sharp ID-1 rectangles passed `cornerShapes` when small and
    // blurred).
    showsRoundedCorner(image, d.corners) &&
    cleanSides &&
    longSideOf(d.corners) <= maxLongPx &&
    cardShapedWithoutSheet(
      d.corners,
      card,
      focal,
      NO_PAPER_ASPECT_TOLERANCE,
      NO_PAPER_MAX_ANGLE_ERROR_DEG,
    )
  );
}

/**
 * L11: the straight-edge search in the box (`lineSearch.ts`): its best
 * `MAX_CANDIDATES_TRIED` quads, each refined and held to the no-sheet bar.
 */
function searchByLines(
  image: RgbaImage,
  region: PixelRect,
  card: { readonly longMm: number; readonly shortMm: number },
  focal: {
    readonly f: number;
    readonly cx: number;
    readonly cy: number;
  } | null,
  maxLongPx: number,
): CardDetection {
  const aspectTolerance = focal
    ? SHEET_KNOWN_ASPECT_TOLERANCE
    : CARD_ASPECT_TOLERANCE;
  const quads = findCardByLines(image, region, {
    minLongPx: MIN_CARD_LONG_SIDE_PX,
    maxLongPx,
    aspectTolerance,
  });
  for (const q of quads.slice(0, MAX_CANDIDATES_TRIED)) {
    if (
      !cardShapedWithoutSheet(
        q.quad,
        card,
        focal,
        NO_PAPER_COARSE_ASPECT_TOLERANCE,
        NO_PAPER_COARSE_MAX_ANGLE_ERROR_DEG,
      )
    ) {
      continue;
    }
    // L12: a light rim along a side belongs to the card (refine.ts).
    const d = refineAndCheck(
      image,
      q.quad,
      aspectTolerance,
      undefined,
      undefined,
      true,
    );
    if (!d.ok) continue;
    if (passesWithoutSheet(image, d, card, focal, maxLongPx, true)) {
      return { ...d, method: "lines" };
    }
  }
  return fail("no_candidate");
}

/**
 * L7: is a quad (full-image px) card-shaped with no sheet in view? With a
 * focal length, by its plane aspect and corner angle
 * (`rectangleFromFocal`); without, by its pixel aspect
 * (`CARD_ASPECT_TOLERANCE`, the pre-L7 rule).
 */
function cardShapedWithoutSheet(
  q: Quad,
  card: { readonly longMm: number; readonly shortMm: number },
  focal: {
    readonly f: number;
    readonly cx: number;
    readonly cy: number;
  } | null,
  aspectTol: number,
  maxAngleDeg: number,
): boolean {
  if (!focal) {
    const score = scoreQuadAsCard(q);
    return score !== null && score <= CARD_ASPECT_TOLERANCE;
  }
  const rect = rectangleFromFocal(q, focal.f, focal.cx, focal.cy);
  if (!rect) return false;
  const want = card.longMm / card.shortMm;
  return (
    Math.abs(rect.aspect / want - 1) <= aspectTol &&
    rect.angleErrorDeg <= maxAngleDeg
  );
}

/**
 * L7 (2026-11-02): the card with no sheet in view (the sheet not found, or
 * none). No size check is possible, so the bar is shape and edge quality:
 * card-shaped on its plane (`cardShapedWithoutSheet`), corners rounded like a
 * card's (`NO_PAPER_MAX_SHARP_CORNERS`), every side one clean
 * straight edge (`NO_PAPER_MIN_SIDE_INLIER_FRACTION`), not nearer than
 * `NO_PAPER_MIN_DISTANCE_MM`. Largest first, at most
 * `MAX_CANDIDATES_TRIED` refined; better no card than a wrong one.
 */
function withoutSheet(
  image: RgbaImage,
  groups: readonly Group[],
  card: { readonly longMm: number; readonly shortMm: number },
  focal: {
    readonly f: number;
    readonly cx: number;
    readonly cy: number;
  } | null,
  frameShort: number,
  rejected: { failure: CardFailureCode; longPx: number } | null,
): CardDetection {
  const aspectTolerance = focal
    ? SHEET_KNOWN_ASPECT_TOLERANCE
    : CARD_ASPECT_TOLERANCE;
  const maxLongPx = focal
    ? (focal.f * card.longMm) / NO_PAPER_MIN_DISTANCE_MM
    : NO_PAPER_MAX_LONG_FRACTION * frameShort;
  let firstFailure: CardDetection | null = null;
  let refinedCount = 0;
  for (const g of groups) {
    if (refinedCount >= MAX_CANDIDATES_TRIED) break;
    let refinedHere = false;
    let baseShapeFailed = false;
    for (const v of g.variants) {
      // An extension only when the candidate's own outline was the wrong
      // shape (or not card-shaped enough to be screened in at all).
      if (!v.base && g.variants[0].base && !baseShapeFailed) break;
      if (longSideOf(v.quad) > maxLongPx) {
        continue;
      }
      if (
        !cardShapedWithoutSheet(
          v.quad,
          card,
          focal,
          NO_PAPER_COARSE_ASPECT_TOLERANCE,
          NO_PAPER_COARSE_MAX_ANGLE_ERROR_DEG,
        )
      ) {
        if (v.base) baseShapeFailed = true;
        continue;
      }
      refinedHere = true;
      // L12: the light-rim rule (refine.ts) is NOT used here: on the L12
      // synthetic set it moved a wood-grain quad's sides onto lighter grain
      // and let it pass (a new false card); only the straight-edge search
      // of a box uses it.
      const d = refineAndCheck(image, v.quad, aspectTolerance);
      if (!d.ok) {
        firstFailure ??= d;
        continue;
      }
      if (!passesWithoutSheet(image, d, card, focal, maxLongPx, false)) {
        if (v.base) baseShapeFailed = true;
        firstFailure ??= fail("implausible_quad", v.quad, d.sides);
        continue;
      }
      return d;
    }
    if (refinedHere) refinedCount++;
  }
  if (firstFailure) return firstFailure;
  return fail(rejected ? rejected.failure : "no_candidate");
}

/** Refine one coarse quad (full-image px) and judge the fitted corners. */
function refineAndCheck(
  image: RgbaImage,
  coarse: Quad,
  aspectTolerance: number,
  alongSheet: readonly boolean[] = [false, false, false, false],
  alongWindowPx = 0,
  outerRim = false,
): CardDetection {
  const refined = refineCardQuad(
    image,
    coarse,
    alongSheet,
    alongWindowPx,
    outerRim,
  );
  if (!refined.corners) {
    return fail("edge_fit_failed", coarse, refined.sides);
  }
  const corners = refined.corners;
  const pxPerMm =
    longSideOf(corners) / Math.max(ID1_CARD_MM.width, ID1_CARD_MM.height);
  const maxShift = Math.max(8, MAX_REFINE_SHIFT_MM * pxPerMm);
  const inFrame = corners.every(
    (p) => p.x >= 0 && p.y >= 0 && p.x <= image.width && p.y <= image.height,
  );
  if (!inFrame) return fail("card_clipped", coarse, refined.sides);
  const score = scoreQuadAsCard(corners);
  const shiftOk = corners.every(
    (p, i) => Math.hypot(p.x - coarse[i].x, p.y - coarse[i].y) <= maxShift,
  );
  if (
    !isConvexQuad(corners) ||
    score === null ||
    score > aspectTolerance ||
    !shiftOk
  ) {
    return fail("implausible_quad", coarse, refined.sides);
  }
  const residuals = refined.sides.map((s) => s.residualPx ?? 0);
  const l = (i: number) =>
    Math.hypot(
      corners[(i + 1) % 4].x - corners[i].x,
      corners[(i + 1) % 4].y - corners[i].y,
    );
  return {
    ok: true,
    corners,
    coarseCorners: coarse,
    sides: refined.sides,
    worstResidualPx: Math.max(...residuals),
    longSideFirst: l(0) + l(2) >= l(1) + l(3),
    method: "outline",
  };
}
