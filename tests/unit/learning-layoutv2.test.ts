import { describe, expect, it } from "vitest";
import { computeSheetLayout } from "../../src/client/sheet/layout";
import { SHEET } from "../../src/lib/contracts/measurement";
import {
  LEARNING_KIT_VERSION,
  kitCodeToken,
  kitCodeUrl,
  parseKitCode,
  type KitCode,
} from "../../src/lib/learning/kit";
import {
  KIT_V2_B_MARKER_IDS,
  KIT_V2_CARD,
  KIT_V2_CARDS_PER_PAGE,
  KIT_V2_MAX_CONTENT_Y_MM,
  KIT_V2_PAGE_HEIGHT_MM,
  KIT_V2_PAGE_WIDTH_MM,
  cardOrigin,
  cardSearchRects,
  computeKitV2Layout,
  layoutBottomMm,
  layoutLines,
  sheetAMarkers,
  sheetBMarkers,
  type KitV2Layout,
} from "../../src/lib/learning/layoutv2";
import { QR_QUIET_MODULES, qrMatrix } from "../../src/lib/learning/qr";
import { decodeKitQr } from "../../src/lib/learning/qrread";
import { KIT_V2_SHEETS, type KitV2Sheet } from "../../src/lib/learning/session";
import { drawQr, whiteImage } from "./helpers/qr-raster";

const SHEETS: readonly KitV2Sheet[] = KIT_V2_SHEETS;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("kit v2 is the current kit", () => {
  it("is version 2", () => {
    expect(LEARNING_KIT_VERSION).toBe(2);
  });
});

describe("sheet A", () => {
  it("has exactly the product sheet's four markers, from computeSheetLayout()", () => {
    const product = computeSheetLayout().markers.filter((m) =>
      (SHEET.flatMarkerIds as readonly number[]).includes(m.id),
    );
    expect(product.map((m) => m.id)).toEqual([0, 1, 2, 3]);
    const a = computeKitV2Layout("A");
    // Same ids, same centres, same size, same corners, in the same order.
    expect(a.markers).toEqual(product);
    expect(sheetAMarkers()).toEqual(product);
    expect(a.markers).toHaveLength(4);
  });

  it("has the centre line, the wrist line, a 100 mm ruler and the card slot, and no edge ticks", () => {
    const a = computeKitV2Layout("A");
    expect(a.centreLine).not.toBeNull();
    expect(a.wristLine).not.toBeNull();
    expect(a.edgeTicks).toEqual([]);
    expect(a.check.kind).toBe("ruler");
    expect(a.check.lengthMm).toBe(100);
    // The long line of the ruler is exactly 100 mm.
    const ruler = a.check.lines[0]!;
    expect(distance(ruler.start, ruler.end)).toBe(100);
    expect(ruler.start.y).toBe(ruler.end.y);
  });

  it("puts the middle-finger line on the page's centre and the wrist line below it, both between the markers", () => {
    const a = computeKitV2Layout("A");
    const centre = a.centreLine!;
    const wrist = a.wristLine!;
    expect(centre.start.x).toBe(KIT_V2_PAGE_WIDTH_MM / 2);
    expect(centre.end.x).toBe(KIT_V2_PAGE_WIDTH_MM / 2);
    // Vertically inside the markers' span, horizontally between the left and right columns.
    const spanTop = Math.min(...a.markers.map((m) => m.corners[0].y));
    const spanBottom = Math.max(...a.markers.map((m) => m.corners[2].y));
    const innerLeft =
      Math.max(...a.markers.map((m) => m.corners[0].x).filter((x) => x < 100)) +
      25;
    const innerRight = Math.min(
      ...a.markers.map((m) => m.corners[0].x).filter((x) => x > 100),
    );
    for (const y of [centre.start.y, centre.end.y, wrist.start.y]) {
      expect(y).toBeGreaterThan(spanTop);
      expect(y).toBeLessThan(spanBottom);
    }
    expect(wrist.start.y).toBe(wrist.end.y);
    expect(wrist.start.y).toBeGreaterThan(centre.end.y);
    expect(Math.min(wrist.start.x, wrist.end.x)).toBeGreaterThan(innerLeft);
    expect(Math.max(wrist.start.x, wrist.end.x)).toBeLessThan(innerRight);
    // The wrist line is centred on the centre line.
    expect((wrist.start.x + wrist.end.x) / 2).toBe(centre.start.x);
  });
});

describe("sheet B", () => {
  const b = computeKitV2Layout("B");

  it("has six markers, ids 0 to 5, 25 mm, on the outer ring", () => {
    expect(b.markers.map((m) => m.id)).toEqual([...KIT_V2_B_MARKER_IDS]);
    expect(b.markers.map((m) => m.id)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const m of b.markers) {
      expect(m.sizeMm).toBe(25);
      const [tl, tr, br, bl] = m.corners;
      expect(distance(tl, tr)).toBe(25);
      expect(distance(tr, br)).toBe(25);
      expect(distance(br, bl)).toBe(25);
      expect(distance(bl, tl)).toBe(25);
      // Clockwise from the marker's own top-left, like the product sheet.
      expect(tl.x).toBeLessThan(tr.x);
      expect(tl.y).toBeLessThan(bl.y);
      // Each centre is the mean of its corners.
      expect(m.centre.x).toBeCloseTo((tl.x + br.x) / 2, 9);
      expect(m.centre.y).toBeCloseTo((tl.y + br.y) / 2, 9);
    }
    expect(sheetBMarkers()).toEqual(b.markers);
  });

  it("leaves the middle of the page blank: no marker, line or text between the two marker rows, bar the card slot's neighbours", () => {
    // The hand area is the strip between the top row's bottom edge and the
    // wrist-crease row. Nothing but the (outside-the-hand) check and edge marks
    // may sit in it.
    const topRowBottom = 40;
    const wristRow = 252;
    for (const m of b.markers) {
      const inStrip =
        m.corners[0].y > topRowBottom && m.corners[2].y < wristRow;
      expect(inStrip).toBe(false);
    }
    expect(b.centreLine).toBeNull();
    expect(b.wristLine).toBeNull();
    // Texts in the hand area: none between the check row and the wrist row.
    for (const t of b.texts) {
      expect(t.y <= 46 || t.y >= wristRow - 1).toBe(true);
    }
  });

  it("has edge ticks at both paper edges, level with each other, outside the hand", () => {
    expect(b.edgeTicks).toHaveLength(2);
    const [left, right] = b.edgeTicks;
    expect(left!.start.y).toBe(left!.end.y);
    expect(left!.start.y).toBe(right!.start.y);
    expect(Math.min(left!.start.x, left!.end.x)).toBe(15);
    expect(Math.max(right!.start.x, right!.end.x)).toBe(195);
  });

  it("checks print scale by the 180 mm between the outer edges of the two top markers", () => {
    expect(b.check.kind).toBe("marker-distance");
    expect(b.check.lengthMm).toBe(180);
    const m0 = b.markers.find((m) => m.id === 0)!;
    const m1 = b.markers.find((m) => m.id === 1)!;
    expect(m1.corners[1].x - m0.corners[0].x).toBe(180);
    // The two end ticks of the drawn check are on exactly those outer edges.
    const verticals = b.check.lines.filter((l) => l.start.x === l.end.x);
    expect(verticals.map((l) => l.start.x).sort((x, y) => x - y)).toEqual([
      m0.corners[0].x,
      m1.corners[1].x,
    ]);
  });
});

describe("both sheets", () => {
  it.each(SHEETS)(
    "sheet %s keeps every element within y <= 282 mm and on the page",
    (sheet) => {
      const layout = computeKitV2Layout(sheet);
      expect(KIT_V2_MAX_CONTENT_Y_MM).toBe(282);
      expect(layoutBottomMm(layout)).toBeLessThanOrEqual(282);
      expect(layout.widthMm).toBe(210);
      expect(layout.heightMm).toBe(297);
      // Each kind of element, so a test failing says which.
      for (const m of layout.markers)
        for (const c of m.corners) {
          expect(c.y).toBeLessThanOrEqual(282);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(210);
        }
      for (const l of layoutLines(layout))
        for (const p of [l.start, l.end]) {
          expect(p.y).toBeLessThanOrEqual(282);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(210);
        }
      for (const t of layout.texts) {
        expect(t.y + t.fontMm * 0.25).toBeLessThanOrEqual(282);
        expect(t.y).toBeGreaterThan(0);
      }
      expect(layout.cardSlot.y + layout.cardSlot.h).toBeLessThanOrEqual(282);
    },
  );

  it.each(SHEETS)(
    "sheet %s has a 60 x 30 mm card slot with a 24 mm QR box and a 9 mm number inside it, clear of every marker",
    (sheet) => {
      const layout = computeKitV2Layout(sheet);
      const { cardSlot: slot, qr } = layout;
      expect([slot.w, slot.h]).toEqual([60, 30]);
      expect([KIT_V2_CARD.widthMm, KIT_V2_CARD.heightMm]).toEqual([60, 30]);
      expect([qr.w, qr.h]).toEqual([24, 24]);
      expect(qr.x).toBeGreaterThanOrEqual(slot.x);
      expect(qr.y).toBeGreaterThanOrEqual(slot.y);
      expect(qr.x + qr.w).toBeLessThanOrEqual(slot.x + slot.w);
      expect(qr.y + qr.h).toBeLessThanOrEqual(slot.y + slot.h);
      expect(KIT_V2_CARD.number.fontMm).toBe(9);
      // Four digits' width at 9 mm bold stays on the card.
      expect(KIT_V2_CARD.number.x + 4 * 0.62 * 9).toBeLessThan(
        KIT_V2_CARD.widthMm,
      );
      expect(cardSearchRects(layout)).toEqual([slot]);
      for (const m of layout.markers) {
        const [tl, , br] = m.corners;
        const overlaps =
          tl.x < slot.x + slot.w &&
          br.x > slot.x &&
          tl.y < slot.y + slot.h &&
          br.y > slot.y;
        expect(overlaps).toBe(false);
      }
    },
  );

  it.each(SHEETS)("sheet %s has no marker overlapping another", (sheet) => {
    const { markers } = computeKitV2Layout(sheet);
    for (const [i, a] of markers.entries())
      for (const b of markers.slice(i + 1)) {
        const apart =
          a.corners[1].x <= b.corners[0].x ||
          b.corners[1].x <= a.corners[0].x ||
          a.corners[2].y <= b.corners[0].y ||
          b.corners[2].y <= a.corners[0].y;
        expect(apart).toBe(true);
      }
  });

  it("carries no pose QR: a layout has no QR box but the card's", () => {
    for (const sheet of SHEETS) {
      const layout = computeKitV2Layout(sheet) as KitV2Layout & {
        poseQr?: unknown;
      };
      expect(layout.poseQr).toBeUndefined();
    }
  });

  it("keeps the 100 mm line (A) and the 180 mm distance (B) as their own lengths", () => {
    expect(computeKitV2Layout("A").check.lengthMm).toBe(100);
    expect(computeKitV2Layout("B").check.lengthMm).toBe(180);
  });
});

describe("participant cards", () => {
  it("fit 24 to an A4 page, inside the page and above 282 mm, none overlapping", () => {
    expect(KIT_V2_CARDS_PER_PAGE).toBe(24);
    const boxes = Array.from({ length: KIT_V2_CARDS_PER_PAGE }, (_, i) => {
      const o = cardOrigin(i);
      return {
        x: o.x,
        y: o.y,
        w: KIT_V2_CARD.widthMm,
        h: KIT_V2_CARD.heightMm,
      };
    });
    for (const [i, a] of boxes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(KIT_V2_PAGE_WIDTH_MM);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y + a.h).toBeLessThanOrEqual(KIT_V2_MAX_CONTENT_Y_MM);
      expect(a.y + a.h).toBeLessThanOrEqual(KIT_V2_PAGE_HEIGHT_MM);
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("refuses an index outside the page", () => {
    expect(() => cardOrigin(-1)).toThrow(RangeError);
    expect(() => cardOrigin(24)).toThrow(RangeError);
    expect(() => cardOrigin(1.5)).toThrow(RangeError);
  });

  it.each([1, 7, 48, 901, 912, 999])(
    "P%s: the printed QR decodes back to its token at kit version 2, through the existing reader",
    (n) => {
      const participant = `P${String(n).padStart(3, "0")}`;
      const code: KitCode = {
        kind: "participant",
        version: LEARNING_KIT_VERSION,
        participant,
      };
      const url = kitCodeUrl(code);
      expect(url).toBe(`https://open-mouse.vercel.app/l/v2/${participant}`);
      expect(kitCodeToken(code)).toBe(participant);
      // The card's QR box, rasterised as a phone photo would show it.
      const image = whiteImage(400, 400);
      drawQr(image, url, 30, 30, 7);
      const read = decodeKitQr(image);
      expect(read).toBe(url);
      expect(parseKitCode(read!)).toEqual(code);
    },
  );

  it("prints each module at least 0.6 mm wide, so an ordinary printer holds it", () => {
    // The card's QR box (24 mm) holds the code plus its quiet zone.
    const { size } = qrMatrix(
      kitCodeUrl({ kind: "participant", version: 2, participant: "P999" }),
    );
    const moduleMm = KIT_V2_CARD.qr.w / (size + 2 * QR_QUIET_MODULES);
    expect(moduleMm).toBeGreaterThanOrEqual(0.6);
  });
});
