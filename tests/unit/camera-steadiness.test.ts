import { describe, expect, it } from "vitest";
import {
  computeMaxCornerMovement,
  isSteady,
} from "../../src/client/camera/steadiness";
import type { Quad } from "../../src/client/camera/quad";

const BASE: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 100, y: 0 },
  bottomRight: { x: 100, y: 100 },
  bottomLeft: { x: 0, y: 100 },
};

describe("computeMaxCornerMovement", () => {
  it("is zero for an identical quad", () => {
    expect(computeMaxCornerMovement(BASE, BASE)).toBe(0);
  });

  it("finds the single largest corner movement", () => {
    const moved: Quad = {
      ...BASE,
      topRight: { x: 105, y: 0 }, // moved 5
      bottomRight: { x: 100, y: 120 }, // moved 20 — the largest
    };
    expect(computeMaxCornerMovement(BASE, moved)).toBeCloseTo(20, 5);
  });
});

describe("isSteady", () => {
  const frameDiagonal = 1000; // 1.5% => 15 units

  it("is steady with no previous sample to compare against", () => {
    expect(isSteady(null, BASE, frameDiagonal)).toBe(true);
  });

  it("is steady when movement is within 1.5% of the frame diagonal", () => {
    const moved: Quad = { ...BASE, topLeft: { x: 10, y: 0 } }; // moved 10 < 15
    expect(isSteady(BASE, moved, frameDiagonal)).toBe(true);
  });

  it("is unsteady when movement exceeds 1.5% of the frame diagonal", () => {
    const moved: Quad = { ...BASE, topLeft: { x: 20, y: 0 } }; // moved 20 > 15
    expect(isSteady(BASE, moved, frameDiagonal)).toBe(false);
  });

  it("is steady exactly at the threshold", () => {
    const moved: Quad = { ...BASE, topLeft: { x: 15, y: 0 } }; // moved exactly 15
    expect(isSteady(BASE, moved, frameDiagonal)).toBe(true);
  });

  it("throws for a non-positive frame diagonal", () => {
    expect(() => isSteady(BASE, BASE, 0)).toThrow(RangeError);
  });
});
