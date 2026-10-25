import { describe, expect, it } from "vitest";
import {
  paperObservedAspect,
  paperSizeFractions,
  paperWorstSide,
} from "../../src/client/photo/diagnostics";
import { computeQuadWidthFraction } from "../../src/client/camera/quad";

const rect = (x: number, y: number, w: number, h: number) =>
  [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ] as const;

describe("paperSizeFractions", () => {
  it("is the sheet's width over the photo's width and its height over the photo's height", () => {
    // A4-shaped sheet, 2000 x 2828 px, in a 3000 x 4000 photo.
    const fractions = paperSizeFractions(
      rect(500, 600, 2000, 2828),
      3000,
      4000,
    );
    expect(fractions?.widthFraction).toBeCloseTo(2000 / 3000, 10);
    expect(fractions?.heightFraction).toBeCloseTo(2828 / 4000, 10);
  });

  it("a sheet that fills the photo's width is 1 and one at 65 % of that is 0.65", () => {
    expect(
      paperSizeFractions(rect(0, 0, 3000, 3500), 3000, 4000)?.widthFraction,
    ).toBe(1);
    const small = paperSizeFractions(rect(0, 0, 1950, 2275), 3000, 4000);
    expect(small?.widthFraction).toBeCloseTo(0.65, 10);
  });

  it("averages the two edges of each pair, so a sheet in perspective is its mean size", () => {
    const trapezoid = [
      { x: 100, y: 0 },
      { x: 900, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ] as const;
    const fractions = paperSizeFractions(trapezoid, 1000, 1000);
    // top 800, bottom 1000: mean 900.
    expect(fractions?.widthFraction).toBeCloseTo(0.9, 10);
  });

  it("is the same measure the live cue uses for the width (computeQuadWidthFraction)", () => {
    const corners = [
      { x: 120, y: 80 },
      { x: 880, y: 100 },
      { x: 900, y: 1000 },
      { x: 100, y: 960 },
    ] as const;
    const live = computeQuadWidthFraction(
      {
        topLeft: corners[0],
        topRight: corners[1],
        bottomRight: corners[2],
        bottomLeft: corners[3],
      },
      1000,
    );
    expect(paperSizeFractions(corners, 1000, 1400)?.widthFraction).toBeCloseTo(
      live,
      10,
    );
  });

  it("is null for a photo without a size", () => {
    expect(paperSizeFractions(rect(0, 0, 10, 10), 0, 100)).toBeNull();
    expect(paperSizeFractions(rect(0, 0, 10, 10), 100, -1)).toBeNull();
  });
});

describe("paperObservedAspect", () => {
  it("is the mean of the top and bottom edges over the mean of the left and right", () => {
    // A4-shaped sheet, 2000 x 2828 px.
    expect(paperObservedAspect(rect(500, 600, 2000, 2828))).toBeCloseTo(
      2000 / 2828,
      10,
    );
  });

  it("averages each pair of edges, so a sheet in perspective reads its mean shape", () => {
    const trapezoid = [
      { x: 100, y: 0 },
      { x: 900, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ] as const;
    // top 800, bottom 1000: mean 900; both sides are the same length.
    const side = Math.hypot(100, 1000);
    expect(paperObservedAspect(trapezoid)).toBeCloseTo(900 / side, 10);
  });

  it("equals the fractions times the photo's size, as the paperAspect bucket reads it", () => {
    const corners = [
      { x: 120, y: 80 },
      { x: 880, y: 100 },
      { x: 900, y: 1000 },
      { x: 100, y: 960 },
    ] as const;
    const f = paperSizeFractions(corners, 1024, 1920)!;
    expect(paperObservedAspect(corners)).toBeCloseTo(
      (f.widthFraction * 1024) / (f.heightFraction * 1920),
      10,
    );
  });

  it("is null for a collapsed or non-finite sheet", () => {
    expect(paperObservedAspect(rect(0, 0, 0, 0))).toBeNull();
    expect(paperObservedAspect(rect(0, 0, 10, 0))).toBeNull();
    expect(paperObservedAspect(rect(0, 0, Number.NaN, 10))).toBeNull();
  });
});

describe("paperWorstSide (the hidden edge, named as the person sees it)", () => {
  // The detector's side order: 0 = TL to TR, 1 = TR to BR, 2 = BR to BL, 3 = BL to TL.
  const corners = rect(100, 100, 600, 848);
  it.each([
    [[0.225, 1, 1, 1], "top"],
    [[1, 0.3, 1, 1], "right"],
    [[1, 1, 0.35, 1], "bottom"],
    [[1, 1, 1, 0.28], "left"],
    [[0.9, 0.6, 0.95, 0.99], "right"],
  ] as const)("%j -> %s", (coverages, name) => {
    expect(paperWorstSide(corners, coverages)).toBe(name);
  });

  it("is null on a tie for the lowest, with nothing hidden, or with no corners or no coverages", () => {
    expect(paperWorstSide(corners, [0.3, 0.3, 1, 1])).toBeNull();
    expect(paperWorstSide(corners, [1, 1, 1, 1])).toBeNull();
    expect(paperWorstSide(null, [0.3, 1, 1, 1])).toBeNull();
    expect(paperWorstSide(corners, null)).toBeNull();
    expect(paperWorstSide(corners, undefined)).toBeNull();
    expect(paperWorstSide(corners, [0.3, 1, 1])).toBeNull();
    expect(paperWorstSide(corners, [0.3, 1, 1, 1, 1])).toBeNull();
  });

  it("a sheet turned to the left in the picture still names the side on the screen", () => {
    // The sheet's own "top" side (TL to TR) now runs down the left of the frame.
    const turned = [
      { x: 100, y: 700 },
      { x: 100, y: 100 },
      { x: 948, y: 100 },
      { x: 948, y: 700 },
    ] as const;
    expect(paperWorstSide(turned, [0.3, 1, 1, 1])).toBe("left");
    expect(paperWorstSide(turned, [1, 0.3, 1, 1])).toBe("top");
  });

  it("a sheet seen corner-up has no plain name", () => {
    const diamond = [
      { x: 500, y: 100 },
      { x: 900, y: 500 },
      { x: 500, y: 900 },
      { x: 100, y: 500 },
    ] as const;
    expect(paperWorstSide(diamond, [0.3, 1, 1, 1])).toBeNull();
  });
});
