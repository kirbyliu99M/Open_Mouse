/**
 * Printed layouts for the learning kit, in sheet millimetres (origin top-left
 * of the 210 mm content column, y down), like `src/client/sheet/layout.ts`.
 *
 * Top-down pages keep the product sheet's marker geometry exactly (they reuse
 * `computeSheetLayout()`'s markers), so a kit photo runs through the same
 * homography code as the printed-sheet scan. They add the pose's QR codes on
 * the top flap and placement guides on the flat flap.
 *
 * Side pages need a different flap. The product sheet's upright markers sit
 * 12.5–37.5 mm above the table, where a hand seen from the side (25–50 mm
 * tall) would hide them. The side page folds 100 mm from the top, so its
 * markers and QR code stand 55–80 mm above the table, clear of the hand.
 */
import {
  computeSheetLayout,
  type MarkerLayout,
  type Point,
} from "../../client/sheet/layout";
import type { Camera } from "./kit";

export const KIT_PAGE_WIDTH_MM = 210;
export const KIT_PAGE_HEIGHT_MM = 265;
export const KIT_QR_SIZE_MM = 24;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Line {
  readonly start: Point;
  readonly end: Point;
}

export interface KitPageLayout {
  readonly camera: Camera;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly foldY: number;
  readonly markers: readonly MarkerLayout[];
  /** One or two QR codes, each a square of `KIT_QR_SIZE_MM`. */
  readonly qr: readonly Rect[];
  /** Where the pose code and name are printed. */
  readonly titleBox: Rect;
  /** Top-down: the middle-finger line. Side: the line the hand lies along. */
  readonly guideLine: Line;
  /** Top-down only: the wrist-crease line. */
  readonly wristLine: Line | null;
  /** A 100 mm check ruler, placed away from where the hand goes. */
  readonly ruler: Line;
}

function squareCorners(
  centre: Point,
  sizeMm: number,
): readonly [Point, Point, Point, Point] {
  const h = sizeMm / 2;
  return [
    { x: centre.x - h, y: centre.y - h },
    { x: centre.x + h, y: centre.y - h },
    { x: centre.x + h, y: centre.y + h },
    { x: centre.x - h, y: centre.y + h },
  ];
}

export function computeTopDownKitLayout(): KitPageLayout {
  const sheet = computeSheetLayout();
  const uprightY = 30; // the product sheet's upright-marker centre row
  const qrTop = uprightY - KIT_QR_SIZE_MM / 2;
  return {
    camera: "above",
    widthMm: KIT_PAGE_WIDTH_MM,
    heightMm: KIT_PAGE_HEIGHT_MM,
    foldY: sheet.foldLine.start.y,
    markers: sheet.markers,
    qr: [
      { x: 15, y: qrTop, w: KIT_QR_SIZE_MM, h: KIT_QR_SIZE_MM },
      {
        x: KIT_PAGE_WIDTH_MM - 15 - KIT_QR_SIZE_MM,
        y: qrTop,
        w: KIT_QR_SIZE_MM,
        h: KIT_QR_SIZE_MM,
      },
    ],
    titleBox: { x: 81, y: 16, w: 48, h: 30 },
    guideLine: { start: { x: 105, y: 72 }, end: { x: 105, y: 228 } },
    wristLine: { start: { x: 70, y: 236 }, end: { x: 140, y: 236 } },
    ruler: { start: { x: 55, y: 253 }, end: { x: 155, y: 253 } },
  };
}

export const SIDE_FOLD_Y_MM = 100;
const SIDE_MARKER_ROW_Y_MM = 32.5; // 67.5 mm above the table once folded
const SIDE_MARKER_SIZE_MM = 25;

export function computeSideKitLayout(): KitPageLayout {
  const markers: MarkerLayout[] = [
    { id: 4, centre: { x: 40, y: SIDE_MARKER_ROW_Y_MM } },
    { id: 5, centre: { x: 170, y: SIDE_MARKER_ROW_Y_MM } },
  ].map(({ id, centre }) => ({
    id,
    centre,
    sizeMm: SIDE_MARKER_SIZE_MM,
    corners: squareCorners(centre, SIDE_MARKER_SIZE_MM),
  }));
  return {
    camera: "side",
    widthMm: KIT_PAGE_WIDTH_MM,
    heightMm: KIT_PAGE_HEIGHT_MM,
    foldY: SIDE_FOLD_Y_MM,
    markers,
    qr: [
      {
        x: KIT_PAGE_WIDTH_MM / 2 - KIT_QR_SIZE_MM / 2,
        y: SIDE_MARKER_ROW_Y_MM - KIT_QR_SIZE_MM / 2,
        w: KIT_QR_SIZE_MM,
        h: KIT_QR_SIZE_MM,
      },
    ],
    titleBox: { x: 15, y: 1, w: 180, h: 14 },
    guideLine: {
      start: { x: 15, y: SIDE_FOLD_Y_MM + 8 },
      end: { x: 195, y: SIDE_FOLD_Y_MM + 8 },
    },
    wristLine: null,
    ruler: {
      start: { x: 55, y: KIT_PAGE_HEIGHT_MM - 20 },
      end: { x: 155, y: KIT_PAGE_HEIGHT_MM - 20 },
    },
  };
}

export function computeKitLayout(camera: Camera): KitPageLayout {
  return camera === "above"
    ? computeTopDownKitLayout()
    : computeSideKitLayout();
}

/** Height of a side-page point above the table once the flap is folded up. */
export function heightAboveTableMm(yMm: number): number {
  return SIDE_FOLD_Y_MM - yMm;
}
