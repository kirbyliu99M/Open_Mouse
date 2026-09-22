/**
 * Calibration sheet marker layout — the single source of truth for where
 * every marker, the fold line, the ruler and the card outline sit, in sheet
 * millimetres. `src/app/sheet/page.tsx` draws from this; the (future)
 * capture code builds its homography correspondences from this same
 * function, so a change here moves both in lockstep.
 *
 * Coordinate frame: origin at the top-left of the printable content area,
 * x right, y down, one unit = one millimetre. Content is a fixed 210 mm
 * wide column (matches A4's width exactly); on US Letter the page is wider,
 * so `src/app/sheet/page.tsx` centres this column and the extra width just
 * becomes margin.
 */
import { ID1_CARD_MM, SHEET } from "../../lib/contracts/measurement";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface MarkerLayout {
  readonly id: number;
  readonly centre: Point;
  readonly sizeMm: number;
  /** Clockwise from the marker's own top-left corner. */
  readonly corners: readonly [Point, Point, Point, Point];
}

export interface FoldLineLayout {
  readonly start: Point;
  readonly end: Point;
}

export interface RulerLayout {
  readonly start: Point;
  readonly end: Point;
  readonly lengthMm: number;
}

export interface CardOutlineLayout {
  readonly widthMm: number;
  readonly heightMm: number;
  /** Clockwise from top-left. */
  readonly corners: readonly [Point, Point, Point, Point];
}

export interface SheetLayout {
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly sideMarginMm: number;
  /** Ids 0–3 (flat flap) followed by ids 4–5 (upright flap). */
  readonly markers: readonly MarkerLayout[];
  readonly foldLine: FoldLineLayout;
  readonly ruler: RulerLayout;
  readonly cardOutline: CardOutlineLayout;
}

// ── Layout constants (all mm) ────────────────────────────────────────────

const PAGE_WIDTH_MM = 210; // A4 width; centred with extra margin on Letter.
const SIDE_MARGIN_MM = (PAGE_WIDTH_MM - SHEET.markerLayoutOuterMm) / 2; // 15

const UPRIGHT_MARKER_CENTRE_Y_MM = 30;
const FOLD_LINE_Y_MM = 55;
const FLAT_SQUARE_TOP_MM = 67;
const FLAT_SQUARE_LEFT_MM = SIDE_MARGIN_MM;

const FLAT_SQUARE_BOTTOM_MM = FLAT_SQUARE_TOP_MM + SHEET.markerLayoutOuterMm; // 247
const BOTTOM_CONTENT_MM = 18; // room for the "print at 100%" instruction line
const PAGE_HEIGHT_MM = FLAT_SQUARE_BOTTOM_MM + BOTTOM_CONTENT_MM; // 265

const RULER_Y_MM = FLAT_SQUARE_TOP_MM + 40; // inside the flat square's interior
const CARD_TOP_MM = FLAT_SQUARE_TOP_MM + 90; // inside the flat square's interior

const UPRIGHT_MARKER_GAP_MM = 80; // centre-to-centre spacing, ids 4 and 5

function squareCorners(
  centre: Point,
  sizeMm: number,
): readonly [Point, Point, Point, Point] {
  const h = sizeMm / 2;
  return [
    { x: centre.x - h, y: centre.y - h }, // top-left
    { x: centre.x + h, y: centre.y - h }, // top-right
    { x: centre.x + h, y: centre.y + h }, // bottom-right
    { x: centre.x - h, y: centre.y + h }, // bottom-left
  ];
}

/** Pure function: the sheet-mm position of every printable sheet element. */
export function computeSheetLayout(): SheetLayout {
  const flatCentreX = FLAT_SQUARE_LEFT_MM + SHEET.markerLayoutOuterMm / 2; // 105
  const flatCentreY = FLAT_SQUARE_TOP_MM + SHEET.markerLayoutOuterMm / 2; // 157
  const half = SHEET.markerCentreSquareMm / 2; // 77.5

  // Ids 0–3, clockwise from top-left, centred on the 155 mm square.
  const flatCentres: Record<number, Point> = {
    [SHEET.flatMarkerIds[0]]: { x: flatCentreX - half, y: flatCentreY - half },
    [SHEET.flatMarkerIds[1]]: { x: flatCentreX + half, y: flatCentreY - half },
    [SHEET.flatMarkerIds[2]]: { x: flatCentreX + half, y: flatCentreY + half },
    [SHEET.flatMarkerIds[3]]: { x: flatCentreX - half, y: flatCentreY + half },
  };

  // Ids 4–5, left → right along the fold line.
  const uprightCentres: Record<number, Point> = {
    [SHEET.uprightMarkerIds[0]]: {
      x: PAGE_WIDTH_MM / 2 - UPRIGHT_MARKER_GAP_MM / 2,
      y: UPRIGHT_MARKER_CENTRE_Y_MM,
    },
    [SHEET.uprightMarkerIds[1]]: {
      x: PAGE_WIDTH_MM / 2 + UPRIGHT_MARKER_GAP_MM / 2,
      y: UPRIGHT_MARKER_CENTRE_Y_MM,
    },
  };

  const allCentres = { ...flatCentres, ...uprightCentres };
  const markers: MarkerLayout[] = [
    ...SHEET.flatMarkerIds,
    ...SHEET.uprightMarkerIds,
  ].map((id) => {
    const centre = allCentres[id];
    return {
      id,
      centre,
      sizeMm: SHEET.markerSizeMm,
      corners: squareCorners(centre, SHEET.markerSizeMm),
    };
  });

  const rulerStartX = (PAGE_WIDTH_MM - SHEET.rulerMm) / 2;
  const ruler: RulerLayout = {
    start: { x: rulerStartX, y: RULER_Y_MM },
    end: { x: rulerStartX + SHEET.rulerMm, y: RULER_Y_MM },
    lengthMm: SHEET.rulerMm,
  };

  const cardLeft = (PAGE_WIDTH_MM - ID1_CARD_MM.width) / 2;
  const cardOutline: CardOutlineLayout = {
    widthMm: ID1_CARD_MM.width,
    heightMm: ID1_CARD_MM.height,
    corners: [
      { x: cardLeft, y: CARD_TOP_MM },
      { x: cardLeft + ID1_CARD_MM.width, y: CARD_TOP_MM },
      { x: cardLeft + ID1_CARD_MM.width, y: CARD_TOP_MM + ID1_CARD_MM.height },
      { x: cardLeft, y: CARD_TOP_MM + ID1_CARD_MM.height },
    ],
  };

  return {
    pageWidthMm: PAGE_WIDTH_MM,
    pageHeightMm: PAGE_HEIGHT_MM,
    sideMarginMm: SIDE_MARGIN_MM,
    markers,
    foldLine: {
      start: { x: SIDE_MARGIN_MM, y: FOLD_LINE_Y_MM },
      end: { x: PAGE_WIDTH_MM - SIDE_MARGIN_MM, y: FOLD_LINE_Y_MM },
    },
    ruler,
    cardOutline,
  };
}
