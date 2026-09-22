import { describe, expect, it } from "vitest";
import {
  computeDownscaleSize,
  MAX_LONG_EDGE_PX,
} from "../../src/client/photo/decode";

describe("computeDownscaleSize", () => {
  it("leaves an image already within bounds unchanged", () => {
    expect(computeDownscaleSize(2000, 1500)).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  it("leaves an image exactly at the bound unchanged", () => {
    expect(computeDownscaleSize(MAX_LONG_EDGE_PX, 2000)).toEqual({
      width: MAX_LONG_EDGE_PX,
      height: 2000,
    });
  });

  it("downscales a landscape photo so the long (width) edge hits the max", () => {
    // A typical 12MP photo: 4000x3000, 4:3.
    const result = computeDownscaleSize(4000, 3000);
    expect(result.width).toBe(3000);
    expect(result.height).toBe(2250);
  });

  it("downscales a portrait photo so the long (height) edge hits the max", () => {
    const result = computeDownscaleSize(3000, 4000);
    expect(result.width).toBe(2250);
    expect(result.height).toBe(3000);
  });

  it("preserves aspect ratio within rounding", () => {
    const original = { width: 4032, height: 3024 }; // common 12MP phone photo
    const result = computeDownscaleSize(original.width, original.height);
    const originalRatio = original.width / original.height;
    const resultRatio = result.width / result.height;
    expect(Math.abs(originalRatio - resultRatio)).toBeLessThan(0.001);
  });

  it("respects a custom max long edge", () => {
    expect(computeDownscaleSize(2000, 1000, 1000)).toEqual({
      width: 1000,
      height: 500,
    });
  });

  it("throws for non-positive dimensions", () => {
    expect(() => computeDownscaleSize(0, 100)).toThrow(RangeError);
    expect(() => computeDownscaleSize(100, -1)).toThrow(RangeError);
  });
});
