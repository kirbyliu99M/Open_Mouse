import { describe, expect, it } from "vitest";
import {
  computeMeanLuma,
  computeClippedFraction,
  computeLightStatus,
} from "../../src/client/camera/light";

describe("computeMeanLuma", () => {
  it("averages a flat array", () => {
    expect(computeMeanLuma([0, 100, 200])).toBeCloseTo(100, 5);
  });

  it("throws on empty input", () => {
    expect(() => computeMeanLuma([])).toThrow(RangeError);
  });
});

describe("computeClippedFraction", () => {
  it("counts samples at/above the threshold", () => {
    expect(computeClippedFraction([0, 250, 255, 100], 250)).toBeCloseTo(
      0.5,
      5,
    );
  });

  it("is zero when nothing clips", () => {
    expect(computeClippedFraction([0, 10, 20], 250)).toBe(0);
  });

  it("throws on empty input", () => {
    expect(() => computeClippedFraction([])).toThrow(RangeError);
  });
});

describe("computeLightStatus", () => {
  const thresholds = { minMeanLuma: 70, maxClippedFraction: 0.05 };

  it("is dark below the mean-luma floor", () => {
    expect(computeLightStatus(50, 0, thresholds)).toBe("dark");
  });

  it("is bright above the clipped-fraction ceiling", () => {
    expect(computeLightStatus(150, 0.2, thresholds)).toBe("bright");
  });

  it("is ok in between", () => {
    expect(computeLightStatus(120, 0.01, thresholds)).toBe("ok");
  });

  it("checks darkness before clipping", () => {
    // Dark AND (hypothetically) clipped — dark wins per priority.
    expect(computeLightStatus(10, 0.2, thresholds)).toBe("dark");
  });
});
