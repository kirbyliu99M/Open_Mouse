import { describe, expect, it } from "vitest";
import {
  computeQuadSkew,
  isQuadSkewed,
  computeQuadWidthFraction,
  computeQuadSizeStatus,
  computeContainRect,
  computeCoverRect,
  bilinearPointInQuad,
  mapMediaPointToContainer,
  buildTrackedQuad,
  type Quad,
} from "../../src/client/camera/quad";

const SQUARE: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 100, y: 0 },
  bottomRight: { x: 100, y: 100 },
  bottomLeft: { x: 0, y: 100 },
};

describe("computeQuadSkew / isQuadSkewed", () => {
  it("reports a perfect square as unskewed", () => {
    const skew = computeQuadSkew(SQUARE);
    expect(skew.topBottomRatio).toBeCloseTo(1, 5);
    expect(skew.leftRightRatio).toBeCloseTo(1, 5);
    expect(skew.maxAngleDeviationDeg).toBeCloseTo(0, 5);
    expect(isQuadSkewed(skew)).toBe(false);
  });

  it("flags a trapezoid whose top/bottom edge ratio exceeds 1.15", () => {
    const trapezoid: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 200, y: 0 }, // top edge 200
      bottomRight: { x: 100, y: 100 }, // bottom edge 100 -> ratio 2.0
      bottomLeft: { x: 0, y: 100 },
    };
    const skew = computeQuadSkew(trapezoid);
    expect(skew.topBottomRatio).toBeCloseTo(2, 5);
    expect(isQuadSkewed(skew)).toBe(true);
  });

  it("flags a parallelogram whose corner angles deviate from 90° by more than 12°", () => {
    // Shear the square so every corner angle is off 90° by more than 12°.
    const sheared: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 140, y: 100 },
      bottomLeft: { x: 40, y: 100 },
    };
    const skew = computeQuadSkew(sheared);
    expect(skew.maxAngleDeviationDeg).toBeGreaterThan(12);
    expect(isQuadSkewed(skew)).toBe(true);
  });

  it("passes a mild tilt within both thresholds", () => {
    const mild: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 2 },
      bottomRight: { x: 98, y: 100 },
      bottomLeft: { x: 2, y: 98 },
    };
    const skew = computeQuadSkew(mild);
    expect(isQuadSkewed(skew)).toBe(false);
  });
});

describe("computeQuadWidthFraction / computeQuadSizeStatus", () => {
  it("computes the quad's average width as a fraction of the frame", () => {
    expect(computeQuadWidthFraction(SQUARE, 200)).toBeCloseTo(0.5, 5);
  });

  it("throws for a non-positive frame width", () => {
    expect(() => computeQuadWidthFraction(SQUARE, 0)).toThrow(RangeError);
  });

  it("flags too-far below the min fraction", () => {
    expect(computeQuadSizeStatus(0.5)).toBe("too-far");
  });

  it("flags too-close above the max fraction", () => {
    expect(computeQuadSizeStatus(0.96)).toBe("too-close");
  });

  it("is ok within range", () => {
    expect(computeQuadSizeStatus(0.75)).toBe("ok");
  });

  it("is ok exactly at the boundaries", () => {
    expect(computeQuadSizeStatus(0.55)).toBe("ok");
    expect(computeQuadSizeStatus(0.95)).toBe("ok");
  });
});

describe("computeContainRect", () => {
  it("letterboxes a wider-than-container media (top/bottom bars)", () => {
    // Container is a 100x200 portrait box; media is 16:9 landscape.
    const rect = computeContainRect(100, 200, 1600, 900);
    expect(rect.width).toBeCloseTo(100, 5);
    expect(rect.height).toBeCloseTo(56.25, 2);
    expect(rect.x).toBeCloseTo(0, 5);
    expect(rect.y).toBeCloseTo((200 - 56.25) / 2, 2);
  });

  it("pillarboxes a taller-than-container media (left/right bars)", () => {
    // Container is a 400x200 landscape box; media is 9:16 portrait.
    const rect = computeContainRect(400, 200, 900, 1600);
    expect(rect.height).toBeCloseTo(200, 5);
    expect(rect.width).toBeCloseTo(112.5, 2);
    expect(rect.y).toBeCloseTo(0, 5);
    expect(rect.x).toBeCloseTo((400 - 112.5) / 2, 2);
  });

  it("fills exactly when aspect ratios match", () => {
    const rect = computeContainRect(200, 100, 800, 400);
    expect(rect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("throws for non-positive dimensions", () => {
    expect(() => computeContainRect(0, 100, 800, 400)).toThrow(RangeError);
  });
});

describe("buildTrackedQuad", () => {
  const square = (cx: number, cy: number) => [
    { x: cx - 5, y: cy - 5 },
    { x: cx + 5, y: cy - 5 },
    { x: cx + 5, y: cy + 5 },
    { x: cx - 5, y: cy + 5 },
  ];

  it("builds a quad from the four flat-flap marker centroids, ordered by id", () => {
    const markers = [
      { id: 2, corners: square(100, 100) }, // bottom-right
      { id: 0, corners: square(0, 0) }, // top-left
      { id: 3, corners: square(0, 100) }, // bottom-left
      { id: 1, corners: square(100, 0) }, // top-right
    ];
    const quad = buildTrackedQuad(markers);
    expect(quad).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    });
  });

  it("returns null when any of the four ids is missing", () => {
    const markers = [
      { id: 0, corners: square(0, 0) },
      { id: 1, corners: square(100, 0) },
      { id: 2, corners: square(100, 100) },
    ];
    expect(buildTrackedQuad(markers)).toBeNull();
  });

  it("returns null with no markers at all", () => {
    expect(buildTrackedQuad([])).toBeNull();
  });
});

describe("computeCoverRect", () => {
  it("crops the sides of a wider-than-container media (matches container height)", () => {
    // Container is a 100x200 portrait box; media is 16:9 landscape.
    const rect = computeCoverRect(100, 200, 1600, 900);
    expect(rect.height).toBeCloseTo(200, 5);
    expect(rect.width).toBeCloseTo(355.56, 1);
    expect(rect.y).toBeCloseTo(0, 5);
    expect(rect.x).toBeCloseTo((100 - 355.56) / 2, 1); // negative: cropped
  });

  it("crops the top/bottom of a taller-than-container media (matches container width)", () => {
    // Container is a 400x200 landscape box; media is 9:16 portrait.
    const rect = computeCoverRect(400, 200, 900, 1600);
    expect(rect.width).toBeCloseTo(400, 5);
    expect(rect.height).toBeCloseTo(711.11, 1);
    expect(rect.x).toBeCloseTo(0, 5);
    expect(rect.y).toBeCloseTo((200 - 711.11) / 2, 1); // negative: cropped
  });

  it("fills exactly when aspect ratios match", () => {
    const rect = computeCoverRect(200, 100, 800, 400);
    expect(rect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("throws for non-positive dimensions", () => {
    expect(() => computeCoverRect(0, 100, 800, 400)).toThrow(RangeError);
  });

  it("is the mirror image of computeContainRect (whichever axis contain shrinks, cover grows, and vice versa)", () => {
    const contain = computeContainRect(100, 200, 1600, 900);
    const cover = computeCoverRect(100, 200, 1600, 900);
    expect(cover.height).toBeCloseTo(contain.width > 0 ? 200 : 0, 5);
    expect(contain.width).toBeCloseTo(100, 5); // contain: fits width
    expect(cover.width).toBeGreaterThan(contain.width); // cover: overflows width
  });
});

describe("bilinearPointInQuad", () => {
  it("maps the four corners exactly", () => {
    expect(bilinearPointInQuad(0, 0, SQUARE)).toEqual(SQUARE.topLeft);
    expect(bilinearPointInQuad(1, 0, SQUARE)).toEqual(SQUARE.topRight);
    expect(bilinearPointInQuad(1, 1, SQUARE)).toEqual(SQUARE.bottomRight);
    expect(bilinearPointInQuad(0, 1, SQUARE)).toEqual(SQUARE.bottomLeft);
  });

  it("maps the centre to the quad's centroid for a square", () => {
    const centre = bilinearPointInQuad(0.5, 0.5, SQUARE);
    expect(centre.x).toBeCloseTo(50, 5);
    expect(centre.y).toBeCloseTo(50, 5);
  });

  it("interpolates along the top edge linearly", () => {
    const p = bilinearPointInQuad(0.25, 0, SQUARE);
    expect(p).toEqual({ x: 25, y: 0 });
  });

  it("follows a non-square (trapezoidal) quad's own geometry", () => {
    const trapezoid: Quad = {
      topLeft: { x: 20, y: 0 },
      topRight: { x: 80, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    // Bottom edge midpoint.
    expect(bilinearPointInQuad(0.5, 1, trapezoid)).toEqual({ x: 50, y: 100 });
    // Top edge midpoint.
    expect(bilinearPointInQuad(0.5, 0, trapezoid)).toEqual({ x: 50, y: 0 });
  });
});

describe("mapMediaPointToContainer", () => {
  it("maps a media-space point into the contain rect's coordinate space", () => {
    const rect = { x: 10, y: 0, width: 100, height: 100 };
    const mapped = mapMediaPointToContainer({ x: 320, y: 240 }, rect, 640, 480);
    expect(mapped.x).toBeCloseTo(10 + 0.5 * 100, 5);
    expect(mapped.y).toBeCloseTo(0 + 0.5 * 100, 5);
  });
});
