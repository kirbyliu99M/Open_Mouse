import { describe, expect, it } from "vitest";
import type { Vec } from "@/lib/particles/geometry";
import {
  GOLDEN_ANGLE,
  clamp01,
  easeInOutQuad,
  interpolateAxis,
  interpolatePosition,
  legWeights,
  swirlDirection,
} from "@/lib/particles/interpolate";
import { mulberry32 } from "@/lib/particles/random";

describe("easeInOutQuad", () => {
  it("is 0 at 0, 1/2 at 1/2 and 1 at 1, with no overshoot", () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(0.5)).toBe(0.5);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.25)).toBeCloseTo(0.125, 12);
    expect(easeInOutQuad(0.75)).toBeCloseTo(0.875, 12);
  });

  it("only rises, and is symmetric about the middle", () => {
    let previous = 0;
    for (let i = 1; i <= 100; i += 1) {
      const t = i / 100;
      const e = easeInOutQuad(t);
      expect(e).toBeGreaterThanOrEqual(previous);
      expect(e + easeInOutQuad(1 - t)).toBeCloseTo(1, 12);
      previous = e;
    }
  });

  it("clamps its input to [0, 1] and treats NaN as 0", () => {
    expect(easeInOutQuad(-3)).toBe(0);
    expect(easeInOutQuad(7)).toBe(1);
    expect(easeInOutQuad(Number.NaN)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("swirlDirection", () => {
  it("is a unit vector, and neighbours are a golden angle apart", () => {
    expect(GOLDEN_ANGLE).toBeCloseTo((137.5077640500378 * Math.PI) / 180, 12);
    for (let i = 0; i < 50; i += 1) {
      const [x, y] = swirlDirection(i);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
      const [nx, ny] = swirlDirection(i + 1);
      // The angle between the two: the dot product is cos(golden angle).
      expect(x * nx + y * ny).toBeCloseTo(Math.cos(GOLDEN_ANGLE), 12);
    }
  });

  it("spreads evenly: no half of the circle is left empty", () => {
    const quadrants = [0, 0, 0, 0];
    for (let i = 0; i < 400; i += 1) {
      const [x, y] = swirlDirection(i);
      quadrants[(x >= 0 ? 0 : 1) + (y >= 0 ? 0 : 2)]! += 1;
    }
    for (const count of quadrants) expect(count).toBeGreaterThan(80);
  });

  it("an offset turns every direction by the same angle", () => {
    const [x, y] = swirlDirection(5);
    const [rx, ry] = swirlDirection(5, 1.9);
    expect(x * rx + y * ry).toBeCloseTo(Math.cos(1.9), 12);
  });
});

describe("interpolatePosition: pos = a + (b - a) * e(t) + sin(pi * e(t)) * A", () => {
  const random = mulberry32(3);
  const pairs = Array.from({ length: 200 }, (_, i) => ({
    a: [random() * 600 - 100, random() * 900 - 100] as Vec,
    b: [random() * 600 - 100, random() * 900 - 100] as Vec,
    direction: swirlDirection(i),
    amplitude: random() * 120,
  }));

  it("lands exactly on a at t = 0 and exactly on b at t = 1, whatever the swirl", () => {
    for (const { a, b, direction, amplitude } of pairs) {
      expect(interpolatePosition(a, b, 0, direction, amplitude)).toEqual(a);
      expect(interpolatePosition(a, b, 1, direction, amplitude)).toEqual(b);
      // And outside the range it stays on the endpoint instead of overshooting.
      expect(interpolatePosition(a, b, -0.5, direction, amplitude)).toEqual(a);
      expect(interpolatePosition(a, b, 1.5, direction, amplitude)).toEqual(b);
    }
  });

  it("at t = 1/2 sits at the midpoint plus the whole swirl", () => {
    for (const { a, b, direction, amplitude } of pairs) {
      const [x, y] = interpolatePosition(a, b, 0.5, direction, amplitude);
      expect(x).toBeCloseTo((a[0] + b[0]) / 2 + direction[0] * amplitude, 9);
      expect(y).toBeCloseTo((a[1] + b[1]) / 2 + direction[1] * amplitude, 9);
    }
  });

  it("with no swirl it is a straight, eased line from a to b", () => {
    const a: Vec = [10, 20];
    const b: Vec = [110, 220];
    for (const t of [0.1, 0.3, 0.5, 0.8]) {
      const e = easeInOutQuad(t);
      const [x, y] = interpolatePosition(a, b, t, [1, 0], 0);
      expect(x).toBeCloseTo(10 + 100 * e, 12);
      expect(y).toBeCloseTo(20 + 200 * e, 12);
    }
  });

  it("gives the same answer every time (no clock, no random)", () => {
    for (const { a, b, direction, amplitude } of pairs.slice(0, 20)) {
      expect(interpolatePosition(a, b, 0.37, direction, amplitude)).toEqual(
        interpolatePosition(a, b, 0.37, direction, amplitude),
      );
    }
  });
});

describe("legWeights and interpolateAxis, the shared implementation", () => {
  it("legWeights is (e, sin(pi * e)) inside the leg and (0, 0) and (1, 0) at its ends", () => {
    expect(legWeights(0)).toEqual({ e: 0, swing: 0 });
    expect(legWeights(-3)).toEqual({ e: 0, swing: 0 });
    expect(legWeights(Number.NaN)).toEqual({ e: 0, swing: 0 });
    expect(legWeights(1)).toEqual({ e: 1, swing: 0 });
    expect(legWeights(2)).toEqual({ e: 1, swing: 0 });
    for (const t of [0.1, 0.25, 0.5, 0.9]) {
      const { e, swing } = legWeights(t);
      expect(e).toBe(easeInOutQuad(t));
      expect(swing).toBe(Math.sin(Math.PI * e));
    }
    // The swing is greatest half way, where e is 1/2.
    expect(legWeights(0.5).swing).toBe(1);
  });

  it("interpolateAxis returns a and b themselves at the ends, and the formula between", () => {
    expect(interpolateAxis(0.1, 0.7, legWeights(0), 123)).toBe(0.1);
    expect(interpolateAxis(0.1, 0.7, legWeights(1), 123)).toBe(0.7);
    const w = legWeights(0.3);
    expect(interpolateAxis(10, 20, w, 5)).toBe(10 + 10 * w.e + 5 * w.swing);
  });

  it("interpolatePosition is exactly interpolateAxis on each axis", () => {
    const a: Vec = [3, 4];
    const b: Vec = [30, 41];
    for (const t of [0, 0.2, 0.5, 0.77, 1]) {
      const w = legWeights(t);
      expect(interpolatePosition(a, b, t, [0.6, -0.8], 12)).toEqual([
        interpolateAxis(3, 30, w, 0.6 * 12),
        interpolateAxis(4, 41, w, -0.8 * 12),
      ]);
    }
  });
});
