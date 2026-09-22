import { describe, expect, it } from "vitest";
import {
  computeLaplacianVariance,
  rgbaToGrayscale,
} from "../../src/client/photo/sharpness";

describe("computeLaplacianVariance", () => {
  it("is exactly zero for a perfectly flat (uniformly grey) image", () => {
    const width = 10;
    const height = 10;
    const gray = new Float64Array(width * height).fill(128);
    expect(computeLaplacianVariance(gray, width, height)).toBe(0);
  });

  it("is much higher for a sharp checkerboard than a flat image", () => {
    const width = 10;
    const height = 10;
    const flat = new Float64Array(width * height).fill(128);

    const checkerboard = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        checkerboard[y * width + x] = (x + y) % 2 === 0 ? 0 : 255;
      }
    }

    const flatVariance = computeLaplacianVariance(flat, width, height);
    const sharpVariance = computeLaplacianVariance(checkerboard, width, height);
    expect(sharpVariance).toBeGreaterThan(flatVariance);
    expect(sharpVariance).toBeGreaterThan(1000);
  });

  it("is a linear gradient's Laplacian is exactly zero (ramps have no curvature)", () => {
    const width = 20;
    const height = 20;
    const gradient = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        gradient[y * width + x] = (x / width) * 255;
      }
    }
    expect(computeLaplacianVariance(gradient, width, height)).toBe(0);
  });

  it("ranks a low-contrast sine ripple between flat and a checkerboard", () => {
    const width = 20;
    const height = 20;
    const flat = new Float64Array(width * height).fill(128);

    const ripple = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        ripple[y * width + x] = 128 + 10 * Math.sin(x); // low-amplitude, non-linear (nonzero curvature)
      }
    }
    const checkerboard = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        checkerboard[y * width + x] = (x + y) % 2 === 0 ? 0 : 255;
      }
    }
    const flatVariance = computeLaplacianVariance(flat, width, height);
    const rippleVariance = computeLaplacianVariance(ripple, width, height);
    const checkerboardVariance = computeLaplacianVariance(
      checkerboard,
      width,
      height,
    );
    expect(rippleVariance).toBeGreaterThan(flatVariance);
    expect(rippleVariance).toBeLessThan(checkerboardVariance);
  });

  it("throws for images smaller than 3x3", () => {
    expect(() => computeLaplacianVariance(new Float64Array(4), 2, 2)).toThrow(
      RangeError,
    );
  });

  it("throws when the array length doesn't match width x height", () => {
    expect(() => computeLaplacianVariance(new Float64Array(8), 3, 3)).toThrow(
      RangeError,
    );
  });
});

describe("rgbaToGrayscale", () => {
  it("converts pure white RGBA pixels to 255", () => {
    const data = new Uint8ClampedArray([
      255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    const gray = rgbaToGrayscale(data, 2);
    expect(gray[0]).toBeCloseTo(255, 5);
    expect(gray[1]).toBeCloseTo(255, 5);
  });

  it("converts pure black RGBA pixels to 0", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255]);
    const gray = rgbaToGrayscale(data, 1);
    expect(gray[0]).toBe(0);
  });

  it("uses BT.601 luma weights", () => {
    const data = new Uint8ClampedArray([100, 0, 0, 255]); // pure red
    const gray = rgbaToGrayscale(data, 1);
    expect(gray[0]).toBeCloseTo(29.9, 1);
  });
});
