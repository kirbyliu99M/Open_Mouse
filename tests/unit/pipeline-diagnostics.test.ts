import { describe, expect, it } from "vitest";
import { paperSizeFractions } from "../../src/client/photo/diagnostics";
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
