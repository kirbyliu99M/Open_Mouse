import { describe, expect, it } from "vitest";
import { SHEET } from "../../src/lib/contracts/measurement";
import { computeSheetLayout, type Point } from "../../src/client/sheet/layout";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const LETTER_WIDTH_MM = 215.9;
const LETTER_HEIGHT_MM = 279.4;
const MIN_MARGIN_MM = 10;

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function bboxOfPoints(points: readonly Point[]): Box {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  );
}

describe("computeSheetLayout", () => {
  const layout = computeSheetLayout();

  it("places exactly the 6 marker ids from the contract, each once", () => {
    const ids = layout.markers.map((m) => m.id).sort((a, b) => a - b);
    expect(ids).toEqual(
      [...SHEET.flatMarkerIds, ...SHEET.uprightMarkerIds].sort((a, b) => a - b),
    );
  });

  it.each(SHEET.flatMarkerIds)(
    "marker id %d has 4 corners sized markerSizeMm apart",
    (id) => {
      const marker = layout.markers.find((m) => m.id === id);
      expect(marker).toBeDefined();
      expect(marker!.sizeMm).toBe(SHEET.markerSizeMm);
      // top edge length == markerSizeMm
      const [tl, tr, , bl] = marker!.corners;
      expect(Math.hypot(tr.x - tl.x, tr.y - tl.y)).toBeCloseTo(
        SHEET.markerSizeMm,
        9,
      );
      expect(Math.hypot(bl.x - tl.x, bl.y - tl.y)).toBeCloseTo(
        SHEET.markerSizeMm,
        9,
      );
    },
  );

  it("flat-flap marker centres (ids 0-3) match the contract's 155 mm square", () => {
    const byId = new Map(layout.markers.map((m) => [m.id, m.centre]));
    const [id0, id1, id2, id3] = SHEET.flatMarkerIds;
    const c0 = byId.get(id0)!;
    const c1 = byId.get(id1)!;
    const c2 = byId.get(id2)!;
    const c3 = byId.get(id3)!;

    // Adjacent centres (clockwise square) are markerCentreSquareMm apart.
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y)).toBeCloseTo(
      SHEET.markerCentreSquareMm,
      9,
    );
    expect(Math.hypot(c2.x - c1.x, c2.y - c1.y)).toBeCloseTo(
      SHEET.markerCentreSquareMm,
      9,
    );
    expect(Math.hypot(c3.x - c2.x, c3.y - c2.y)).toBeCloseTo(
      SHEET.markerCentreSquareMm,
      9,
    );
    expect(Math.hypot(c0.x - c3.x, c0.y - c3.y)).toBeCloseTo(
      SHEET.markerCentreSquareMm,
      9,
    );
    // Diagonal.
    const diagonal = SHEET.markerCentreSquareMm * Math.SQRT2;
    expect(Math.hypot(c2.x - c0.x, c2.y - c0.y)).toBeCloseTo(diagonal, 9);
  });

  it("the flat markers' outer extent is markerLayoutOuterMm", () => {
    const flatMarkers = layout.markers.filter((m) =>
      (SHEET.flatMarkerIds as readonly number[]).includes(m.id),
    );
    const box = bboxOfPoints(flatMarkers.flatMap((m) => m.corners));
    expect(box.maxX - box.minX).toBeCloseTo(SHEET.markerLayoutOuterMm, 9);
    expect(box.maxY - box.minY).toBeCloseTo(SHEET.markerLayoutOuterMm, 9);
  });

  it.each([
    ["A4", A4_WIDTH_MM, A4_HEIGHT_MM],
    ["US Letter", LETTER_WIDTH_MM, LETTER_HEIGHT_MM],
  ])(
    "fits inside the printable area of %s with >= 10 mm margins",
    (_label, paperWidthMm, paperHeightMm) => {
      expect(layout.pageHeightMm).toBeLessThanOrEqual(
        paperHeightMm - MIN_MARGIN_MM,
      );
      // Content is centred horizontally on paper wider than its own width.
      const sideOffset = (paperWidthMm - layout.pageWidthMm) / 2;
      expect(sideOffset).toBeGreaterThanOrEqual(0);

      const allCorners = layout.markers.flatMap((m) => m.corners);
      const box = bboxOfPoints(allCorners);
      expect(box.minX + sideOffset).toBeGreaterThanOrEqual(MIN_MARGIN_MM);
      expect(paperWidthMm - (box.maxX + sideOffset)).toBeGreaterThanOrEqual(
        MIN_MARGIN_MM,
      );
      expect(box.minY).toBeGreaterThanOrEqual(MIN_MARGIN_MM);
      expect(paperHeightMm - box.maxY).toBeGreaterThanOrEqual(MIN_MARGIN_MM);
    },
  );

  it("no two markers overlap", () => {
    for (let i = 0; i < layout.markers.length; i++) {
      for (let j = i + 1; j < layout.markers.length; j++) {
        const a = bboxOfPoints(layout.markers[i].corners);
        const b = bboxOfPoints(layout.markers[j].corners);
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it("no marker overlaps the card outline", () => {
    const cardBox = bboxOfPoints(layout.cardOutline.corners);
    for (const marker of layout.markers) {
      const markerBox = bboxOfPoints(marker.corners);
      expect(overlaps(markerBox, cardBox)).toBe(false);
    }
  });

  it("the card outline is within the flat marker square's interior", () => {
    const flatMarkers = layout.markers.filter((m) =>
      (SHEET.flatMarkerIds as readonly number[]).includes(m.id),
    );
    const squareBox = bboxOfPoints(flatMarkers.flatMap((m) => m.corners));
    const cardBox = bboxOfPoints(layout.cardOutline.corners);
    expect(cardBox.minX).toBeGreaterThanOrEqual(squareBox.minX);
    expect(cardBox.maxX).toBeLessThanOrEqual(squareBox.maxX);
    expect(cardBox.minY).toBeGreaterThanOrEqual(squareBox.minY);
    expect(cardBox.maxY).toBeLessThanOrEqual(squareBox.maxY);
  });

  it("the ruler is exactly rulerMm long and doesn't overlap any marker", () => {
    const { start, end, lengthMm } = layout.ruler;
    expect(lengthMm).toBe(SHEET.rulerMm);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(
      SHEET.rulerMm,
      9,
    );

    const rulerBox: Box = {
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minY: start.y - 3,
      maxY: start.y + 3, // small allowance for tick marks either side of the line
    };
    for (const marker of layout.markers) {
      expect(overlaps(bboxOfPoints(marker.corners), rulerBox)).toBe(false);
    }
  });

  it("the fold line sits strictly between the upright and flat marker bands", () => {
    const uprightYs = layout.markers
      .filter((m) =>
        (SHEET.uprightMarkerIds as readonly number[]).includes(m.id),
      )
      .flatMap((m) => m.corners.map((c) => c.y));
    const flatYs = layout.markers
      .filter((m) => (SHEET.flatMarkerIds as readonly number[]).includes(m.id))
      .flatMap((m) => m.corners.map((c) => c.y));

    expect(Math.max(...uprightYs)).toBeLessThan(layout.foldLine.start.y);
    expect(layout.foldLine.start.y).toBeLessThan(Math.min(...flatYs));
    expect(layout.foldLine.start.y).toBe(layout.foldLine.end.y);
  });

  it("is a pure function: repeated calls return equal (not necessarily identical) layouts", () => {
    const a = computeSheetLayout();
    const b = computeSheetLayout();
    expect(a).toEqual(b);
  });
});
