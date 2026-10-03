/**
 * Printed layouts for kit v2 (protocol `agreed-v2`), in sheet millimetres:
 * origin at the top-left of the A4 page, x right, y down, like `layout.ts`.
 *
 * Two single-page A4 sheets, both shared by the left and the right hand and
 * with no pose QR code (the pose comes from the shooting order). Reference
 * designs: docs/design/learning-kit-v2-proposal-2026-10-02/sheet-designs/.
 *
 *  - Sheet A keeps the product sheet's four markers exactly (they are
 *    `computeSheetLayout()`'s own), the centre line and the wrist line, and has
 *    the 100 mm check line.
 *  - Sheet B puts six markers (ids 0 to 5, 25 mm) on the outer ring and leaves
 *    the hand area blank. Alignment is by tick marks at the two paper edges.
 *    Its print-scale check is the 180 mm between the outer edges of the two
 *    top markers.
 *
 * Both have a participant-card slot (the card is `KIT_V2_CARD`, one size for
 * both sheets) and keep all content at or above `KIT_V2_MAX_CONTENT_Y_MM`,
 * which leaves a 15 mm margin at the foot of the A4 page for the printer.
 * Everything drawn is listed here (shapes and texts), so the sheet component
 * is a plain renderer and a test can check every element.
 *
 * Pure. The detection side (which markers a photo shows, the homography from
 * any four or more of B's six) is in `findings.ts`.
 */
import {
  computeSheetLayout,
  type MarkerLayout,
  type Point,
} from "../../client/sheet/layout";
import { SHEET } from "../contracts/measurement";
import type { Line, Rect } from "./layout";
import type { KitV2Sheet } from "./session";

export const KIT_V2_PAGE_WIDTH_MM = 210;
export const KIT_V2_PAGE_HEIGHT_MM = 297;
/** 15 mm print margin at the foot of the A4 page. */
export const KIT_V2_MAX_CONTENT_Y_MM = 282;

/** B's marker size and the ids it uses: the project's own `ARUCO_MIP_36h12`, ids 0 to 5. */
export const KIT_V2_B_MARKER_IDS = [0, 1, 2, 3, 4, 5] as const;
const B_MARKER_SIZE_MM = 25;
/** Top-left corner of each of B's markers, by id. Ids 0 and 1 on top; 3, 4, 5, 2 along the bottom, left to right. */
const B_MARKER_TOP_LEFT: Readonly<Record<number, Point>> = {
  0: { x: 15, y: 15 },
  1: { x: 170, y: 15 },
  2: { x: 170, y: 257 },
  3: { x: 15, y: 257 },
  4: { x: 45.5, y: 257 },
  5: { x: 139.5, y: 257 },
};

/**
 * The participant card: one small card, one size for both sheets. The QR code
 * sits at its left (`qr` is its box including the quiet zone), the number is
 * set in 9 mm bold type to its right, so a photo names its participant to a
 * reader and to a person.
 */
export const KIT_V2_CARD = {
  widthMm: 60,
  heightMm: 30,
  qr: { x: 3, y: 3, w: 24, h: 24 },
  /** Left edge and baseline of the number, from the card's top-left corner. */
  number: { x: 31, y: 18.5, fontMm: 9 },
} as const;

export interface LayoutText {
  readonly text: string;
  readonly x: number;
  /** Baseline. */
  readonly y: number;
  readonly fontMm: number;
  readonly anchor: "start" | "middle" | "end";
  readonly bold: boolean;
  readonly tone: "ink" | "grey";
}

export interface KitV2Layout {
  readonly sheet: KitV2Sheet;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly markers: readonly MarkerLayout[];
  /** The 60 x 30 mm slot a participant card is placed in. */
  readonly cardSlot: Rect;
  /** Corner marks that show where the card's edges go. */
  readonly slotTicks: readonly Line[];
  /** Where the card's QR code lands, in sheet mm (the quiet zone is included). */
  readonly qr: Rect;
  /** Sheet A: the line the middle finger goes along. */
  readonly centreLine: Line | null;
  /** Sheet A: the wrist-crease line, with its two end ticks. */
  readonly wristLine: Line | null;
  /** Sheet B: the wrist-crease marks at the two paper edges. */
  readonly edgeTicks: readonly Line[];
  /** The print-scale check: its lines, the length they show, and which kind it is. */
  readonly check: {
    readonly kind: "ruler" | "marker-distance";
    readonly lengthMm: number;
    readonly lines: readonly Line[];
  };
  readonly texts: readonly LayoutText[];
}

/** The card slot's own box: the same on both sheets, at the top of the page. */
function slotRect(sheet: KitV2Sheet): Rect {
  return {
    x: sheet === "A" ? 15 : 75,
    y: 8,
    w: KIT_V2_CARD.widthMm,
    h: KIT_V2_CARD.heightMm,
  };
}

function ticksAround(box: Rect, armMm: number): Line[] {
  const { x, y, w, h } = box;
  const x2 = x + w;
  const y2 = y + h;
  const corner = (cx: number, cy: number, dx: number, dy: number): Line[] => [
    { start: { x: cx, y: cy }, end: { x: cx + dx * armMm, y: cy } },
    { start: { x: cx, y: cy }, end: { x: cx, y: cy + dy * armMm } },
  ];
  return [
    ...corner(x, y, 1, 1),
    ...corner(x2, y, -1, 1),
    ...corner(x, y2, 1, -1),
    ...corner(x2, y2, -1, -1),
  ];
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

const line = (x1: number, y1: number, x2: number, y2: number): Line => ({
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

/** Sheet A's four markers: the product sheet's own, taken from `computeSheetLayout()` unchanged. */
export function sheetAMarkers(): readonly MarkerLayout[] {
  const flat = SHEET.flatMarkerIds as readonly number[];
  return computeSheetLayout().markers.filter((m) => flat.includes(m.id));
}

/** Sheet B's six markers, ids 0 to 5, clockwise from the top-left for 0 to 3, then the two bottom-middle ones. */
export function sheetBMarkers(): readonly MarkerLayout[] {
  return KIT_V2_B_MARKER_IDS.map((id) => {
    const tl = B_MARKER_TOP_LEFT[id]!;
    const centre = {
      x: tl.x + B_MARKER_SIZE_MM / 2,
      y: tl.y + B_MARKER_SIZE_MM / 2,
    };
    return {
      id,
      centre,
      sizeMm: B_MARKER_SIZE_MM,
      corners: squareCorners(centre, B_MARKER_SIZE_MM),
    };
  });
}

const text = (
  t: string,
  x: number,
  y: number,
  fontMm: number,
  options: {
    anchor?: LayoutText["anchor"];
    bold?: boolean;
    tone?: LayoutText["tone"];
  } = {},
): LayoutText => ({
  text: t,
  x,
  y,
  fontMm,
  anchor: options.anchor ?? "start",
  bold: options.bold ?? false,
  tone: options.tone ?? "ink",
});

function layoutA(): KitV2Layout {
  const slot = slotRect("A");
  // The 100 mm check line: 10 mm graduations, the ends and the middle longer.
  const rulerY = 258;
  const ruler: Line[] = [line(55, rulerY, 155, rulerY)];
  for (let mm = 0; mm <= 100; mm += 10) {
    const long = mm === 0 || mm === 50 || mm === 100;
    ruler.push(line(55 + mm, long ? rulerY - 3 : rulerY - 2, 55 + mm, rulerY));
  }
  return {
    sheet: "A",
    widthMm: KIT_V2_PAGE_WIDTH_MM,
    heightMm: KIT_V2_PAGE_HEIGHT_MM,
    markers: sheetAMarkers(),
    cardSlot: slot,
    slotTicks: ticksAround(slot, 4),
    qr: {
      x: slot.x + KIT_V2_CARD.qr.x,
      y: slot.y + KIT_V2_CARD.qr.y,
      w: KIT_V2_CARD.qr.w,
      h: KIT_V2_CARD.qr.h,
    },
    // The same guides as the kit v1 top-down page (`computeTopDownKitLayout`).
    centreLine: line(105, 72, 105, 228),
    wristLine: line(70, 236, 140, 236),
    edgeTicks: [],
    check: { kind: "ruler", lengthMm: 100, lines: ruler },
    texts: [
      text("OPEN MOUSE · LEARN", 195, 14, 3.4, { anchor: "end", bold: true }),
      text("G02 ×3, then G04 ×2", 195, 19, 3.2, { anchor: "end" }),
      text("sheet A", 195, 24, 2.6, { anchor: "end", tone: "grey" }),
      text("participant card", slot.x + slot.w / 2, slot.y + slot.h + 4, 2.4, {
        anchor: "middle",
        tone: "grey",
      }),
      text("middle finger along this line", 107, 76, 2.6, { tone: "grey" }),
      text("wrist crease on this line", 142, 238, 2.6, { tone: "grey" }),
      text("100 mm: check with a ruler (print at 100%)", 105, 263, 2.8, {
        anchor: "middle",
      }),
      text("Keep all four paper corners visible", 105, 270, 2.8, {
        anchor: "middle",
        tone: "grey",
      }),
    ],
  };
}

function layoutB(): KitV2Layout {
  const slot = slotRect("B");
  const markers = sheetBMarkers();
  // The print-scale check is the distance between the outer edges of the two
  // top markers: 15 to 195 mm. Two end ticks and a short line at each end, so
  // the middle of the page, where a long hand reaches, stays blank.
  const top = markers.find((m) => m.id === 0)!;
  const topRight = markers.find((m) => m.id === 1)!;
  const left = top.corners[0].x;
  const right = topRight.corners[1].x;
  const checkY = 44;
  return {
    sheet: "B",
    widthMm: KIT_V2_PAGE_WIDTH_MM,
    heightMm: KIT_V2_PAGE_HEIGHT_MM,
    markers,
    cardSlot: slot,
    slotTicks: ticksAround(slot, 4),
    qr: {
      x: slot.x + KIT_V2_CARD.qr.x,
      y: slot.y + KIT_V2_CARD.qr.y,
      w: KIT_V2_CARD.qr.w,
      h: KIT_V2_CARD.qr.h,
    },
    centreLine: null,
    wristLine: null,
    // Outside the hand, at the two paper edges, level with the wrist crease.
    edgeTicks: [line(15, 252, 30, 252), line(180, 252, 195, 252)],
    check: {
      kind: "marker-distance",
      lengthMm: right - left,
      lines: [
        line(left, checkY - 3, left, checkY + 3),
        line(right, checkY - 3, right, checkY + 3),
        line(left, checkY, left + 30, checkY),
        line(right - 30, checkY, right, checkY),
      ],
    },
    texts: [
      text("G02 ×3", 44, 18, 3.2, { bold: true }),
      text("G04 ×2", 44, 23, 3.2, { bold: true }),
      text("OPEN MOUSE", 166, 18, 3.2, { anchor: "end", bold: true }),
      text("sheet B", 166, 23, 2.8, { anchor: "end", tone: "grey" }),
      text("wrist crease", 32, 251, 2.4, { tone: "grey" }),
      text("wrist crease", 178, 251, 2.4, { anchor: "end", tone: "grey" }),
      text("180 mm", left + 32, checkY + 1, 2.4, { tone: "grey" }),
      text("outer edge to outer edge", right - 32, checkY + 1, 2.4, {
        anchor: "end",
        tone: "grey",
      }),
    ],
  };
}

export function computeKitV2Layout(sheet: KitV2Sheet): KitV2Layout {
  return sheet === "A" ? layoutA() : layoutB();
}

/** Every line a layout draws, for geometry checks. */
export function layoutLines(layout: KitV2Layout): readonly Line[] {
  return [
    ...layout.slotTicks,
    ...(layout.centreLine ? [layout.centreLine] : []),
    ...(layout.wristLine
      ? [
          layout.wristLine,
          line(
            layout.wristLine.start.x,
            layout.wristLine.start.y - 3,
            layout.wristLine.start.x,
            layout.wristLine.start.y + 3,
          ),
          line(
            layout.wristLine.end.x,
            layout.wristLine.end.y - 3,
            layout.wristLine.end.x,
            layout.wristLine.end.y + 3,
          ),
        ]
      : []),
    ...layout.edgeTicks,
    ...layout.check.lines,
  ];
}

/** How far below a text's baseline its descenders reach, as a fraction of its font size. */
const DESCENDER = 0.25;

/**
 * The lowest y any drawn element reaches (shapes and the descenders of texts).
 * It must stay within `KIT_V2_MAX_CONTENT_Y_MM`.
 */
export function layoutBottomMm(layout: KitV2Layout): number {
  const ys: number[] = [
    layout.cardSlot.y + layout.cardSlot.h,
    layout.qr.y + layout.qr.h,
  ];
  for (const m of layout.markers) for (const c of m.corners) ys.push(c.y);
  for (const l of layoutLines(layout)) ys.push(l.start.y, l.end.y);
  for (const t of layout.texts) ys.push(t.y + t.fontMm * DESCENDER);
  return Math.max(...ys);
}

/** The card slot's QR rectangle as the QR reader should search it: the whole slot, since a card is placed by hand. */
export function cardSearchRects(layout: KitV2Layout): readonly Rect[] {
  return [layout.cardSlot];
}

// ── The participant cards, printed for cutting out ──────────────────────────

export const KIT_V2_CARD_COLUMNS = 3;
export const KIT_V2_CARD_ROWS = 8;
export const KIT_V2_CARDS_PER_PAGE = KIT_V2_CARD_COLUMNS * KIT_V2_CARD_ROWS;
const CARD_GAP_X_MM = 5;
const CARD_GAP_Y_MM = 4;
const CARD_TOP_MM = 8;

/**
 * Where the `index`-th card of a page (0-based, left to right, then down) is
 * drawn, as its top-left corner. The page is A4; the last row ends above
 * `KIT_V2_MAX_CONTENT_Y_MM`.
 */
export function cardOrigin(index: number): Point {
  if (!Number.isInteger(index) || index < 0 || index >= KIT_V2_CARDS_PER_PAGE) {
    throw new RangeError(
      `A card page holds ${KIT_V2_CARDS_PER_PAGE} cards; index ${index} is outside it.`,
    );
  }
  const col = index % KIT_V2_CARD_COLUMNS;
  const row = Math.floor(index / KIT_V2_CARD_COLUMNS);
  const usedWidth =
    KIT_V2_CARD_COLUMNS * KIT_V2_CARD.widthMm +
    (KIT_V2_CARD_COLUMNS - 1) * CARD_GAP_X_MM;
  const left = (KIT_V2_PAGE_WIDTH_MM - usedWidth) / 2;
  return {
    x: left + col * (KIT_V2_CARD.widthMm + CARD_GAP_X_MM),
    y: CARD_TOP_MM + row * (KIT_V2_CARD.heightMm + CARD_GAP_Y_MM),
  };
}
