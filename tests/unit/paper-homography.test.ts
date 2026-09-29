import { describe, expect, it } from "vitest";
import {
  buildPaperHomography,
  localScaleMmPerPx,
  quadCentroid,
  PAPER_SIZES_MM as LOCAL_PAPER_SIZES_MM,
} from "../../src/client/paper/homography";
import { PAPER_ASPECT } from "../../src/client/paper/detect";
import { applyHomography } from "../../src/client/geometry/homography";
import { PAPER_SIZES_MM } from "../../src/lib/contracts/measurement";
import type { Point2 } from "../../src/client/geometry/homography";

describe("PAPER_SIZES_MM — duplication stays in sync with the contract", () => {
  it("matches src/lib/contracts/measurement.ts exactly", () => {
    expect(LOCAL_PAPER_SIZES_MM).toEqual(PAPER_SIZES_MM);
  });

  it("PAPER_ASPECT (detect.ts) matches the contract's width/height ratio", () => {
    expect(PAPER_ASPECT.a4).toBeCloseTo(
      PAPER_SIZES_MM.a4.height / PAPER_SIZES_MM.a4.width,
      9,
    );
    expect(PAPER_ASPECT.letter).toBeCloseTo(
      PAPER_SIZES_MM.letter.height / PAPER_SIZES_MM.letter.width,
      9,
    );
  });
});

describe("buildPaperHomography", () => {
  it("maps an axis-aligned rectangle's corners exactly onto A4's 4 corners", () => {
    const corners: [Point2, Point2, Point2, Point2] = [
      { x: 100, y: 50 },
      { x: 900, y: 50 },
      { x: 900, y: 650 },
      { x: 100, y: 650 },
    ];
    const homography = buildPaperHomography(corners, "a4");
    const expectedMm: Point2[] = [
      { x: 0, y: 0 },
      { x: 210, y: 0 },
      { x: 210, y: 297 },
      { x: 0, y: 297 },
    ];
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(homography, corners[i]);
      expect(mapped.x).toBeCloseTo(expectedMm[i].x, 6);
      expect(mapped.y).toBeCloseTo(expectedMm[i].y, 6);
    }
  });

  it("maps the centre of the quad close to the paper's own centre in mm", () => {
    const corners: [Point2, Point2, Point2, Point2] = [
      { x: 100, y: 50 },
      { x: 900, y: 50 },
      { x: 900, y: 650 },
      { x: 100, y: 650 },
    ];
    const homography = buildPaperHomography(corners, "a4");
    const centrePx = quadCentroid(corners);
    const mapped = applyHomography(homography, centrePx);
    expect(mapped.x).toBeCloseTo(105, 3);
    expect(mapped.y).toBeCloseTo(148.5, 3);
  });

  it("uses Letter's dimensions when paperSize is 'letter'", () => {
    const corners: [Point2, Point2, Point2, Point2] = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 700 },
      { x: 0, y: 700 },
    ];
    const homography = buildPaperHomography(corners, "letter");
    const mapped = applyHomography(homography, { x: 500, y: 700 });
    expect(mapped.x).toBeCloseTo(215.9, 6);
    expect(mapped.y).toBeCloseTo(279.4, 6);
  });
});

describe("localScaleMmPerPx", () => {
  it("matches the analytic scale for an axis-aligned, undistorted rectangle", () => {
    const corners: [Point2, Point2, Point2, Point2] = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1414.14 }, // A4 aspect (297/210) at 1000px wide
      { x: 0, y: 1414.14 },
    ];
    const homography = buildPaperHomography(corners, "a4");
    const scale = localScaleMmPerPx(homography, quadCentroid(corners));
    // 210mm across 1000px = 0.21 mm/px, uniformly (no perspective here).
    expect(scale).toBeCloseTo(0.21, 3);
  });

  it("is always positive for a well-formed quad", () => {
    const corners: [Point2, Point2, Point2, Point2] = [
      { x: 120, y: 80 },
      { x: 880, y: 60 },
      { x: 860, y: 700 },
      { x: 140, y: 720 },
    ];
    const homography = buildPaperHomography(corners, "a4");
    expect(
      localScaleMmPerPx(homography, quadCentroid(corners)),
    ).toBeGreaterThan(0);
  });
});

describe("quadCentroid", () => {
  it("averages the 4 corners", () => {
    const corners: [Point2, Point2, Point2, Point2] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(quadCentroid(corners)).toEqual({ x: 5, y: 10 });
  });
});
