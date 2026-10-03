import { describe, expect, it } from "vitest";
import { type Vec, distance } from "@/lib/particles/geometry";
import { mulberry32 } from "@/lib/particles/random";
import {
  type TargetPoint,
  resampleToCount,
  samplePolyline,
  sampleStrokes,
} from "@/lib/particles/sampling";

/** Distance from a point to the nearest point of a polyline (closed adds the closing edge). */
function distanceToPath(point: Vec, path: readonly Vec[], closed = false) {
  const edges: [Vec, Vec][] = [];
  for (let i = 1; i < path.length; i += 1) edges.push([path[i - 1]!, path[i]!]);
  if (closed) edges.push([path[path.length - 1]!, path[0]!]);
  return Math.min(
    ...edges.map(([a, b]) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
                  lengthSquared,
              ),
            );
      return distance(point, [a[0] + dx * t, a[1] + dy * t]);
    }),
  );
}

describe("mulberry32", () => {
  it("gives the same sequence for the same seed, and another for another seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    const c = mulberry32(8);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("samplePolyline", () => {
  it("starts and ends exactly on the ends of an open stroke, evenly spaced", () => {
    const points = samplePolyline(
      [
        [0, 0],
        [100, 0],
      ],
      2.6,
    );
    // 100 / 2.6 = 38.46, so 38 equal steps of about 2.63 px.
    expect(points).toHaveLength(39);
    expect(points[0]).toEqual([0, 0]);
    expect(points[points.length - 1]).toEqual([100, 0]);
    const gaps = points.slice(1).map((p, i) => distance(points[i]!, p));
    for (const gap of gaps) expect(gap).toBeCloseTo(100 / 38, 9);
  });

  it("keeps every sample on a bent stroke, including the corner's neighbours", () => {
    const stroke: Vec[] = [
      [0, 0],
      [30, 0],
      [30, 40],
      [70, 40],
    ];
    const points = samplePolyline(stroke, 2.6);
    expect(points[0]).toEqual([0, 0]);
    expect(points[points.length - 1]).toEqual([70, 40]);
    for (const point of points) {
      expect(distanceToPath(point, stroke)).toBeLessThan(1e-9);
    }
    // Total length 110, so the spacing along the path is 110 / round(110 / 2.6).
    const step = 110 / Math.round(110 / 2.6);
    expect(points).toHaveLength(Math.round(110 / 2.6) + 1);
    expect(distance(points[0]!, points[1]!)).toBeCloseTo(step, 9);
  });

  it("samples a closed stroke from its first point without repeating it", () => {
    const square: Vec[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const points = samplePolyline(square, 10, true);
    expect(points).toHaveLength(40);
    expect(points[0]).toEqual([0, 0]);
    expect(points.filter((p) => p[0] === 0 && p[1] === 0)).toHaveLength(1);
    for (const point of points) {
      expect(distanceToPath(point, square, true)).toBeLessThan(1e-9);
    }
  });

  it("returns the point itself for a stroke with no length, and nothing for no points", () => {
    expect(samplePolyline([[5, 5]], 2.6)).toEqual([[5, 5]]);
    expect(
      samplePolyline(
        [
          [5, 5],
          [5, 5],
        ],
        2.6,
      ),
    ).toEqual([[5, 5]]);
    expect(samplePolyline([], 2.6)).toEqual([]);
  });

  it("is the same every time and refuses a spacing that is not positive", () => {
    const stroke: Vec[] = [
      [0, 0],
      [13.7, 4.2],
      [40, 9],
    ];
    expect(samplePolyline(stroke, 2.6)).toEqual(samplePolyline(stroke, 2.6));
    expect(() => samplePolyline(stroke, 0)).toThrow(RangeError);
    expect(() => samplePolyline(stroke, -1)).toThrow(RangeError);
  });
});

describe("sampleStrokes", () => {
  const line = (length: number) => ({
    closed: false,
    points: [
      [0, 0],
      [length, 0],
    ] as Vec[],
  });

  it("samples bright strokes finer than dim ones and tags every point", () => {
    const points = sampleStrokes(
      [
        { polyline: line(100), tone: 1 },
        { polyline: line(100), tone: 0 },
      ],
      { brightSpacing: 2.6, dimSpacing: 4.2 },
    );
    const bright = points.filter((p) => p.tone === 1);
    const dim = points.filter((p) => p.tone === 0);
    expect(bright).toHaveLength(Math.round(100 / 2.6) + 1);
    expect(dim).toHaveLength(Math.round(100 / 4.2) + 1);
    expect(bright.length).toBeGreaterThan(dim.length);
  });
});

describe("resampleToCount", () => {
  const original: TargetPoint[] = Array.from({ length: 50 }, (_, i) => ({
    x: i * 3,
    y: (i % 7) * 2,
    tone: (i % 2) as 0 | 1,
  }));

  it("returns the same points when the count already matches", () => {
    expect(resampleToCount(original, 50, 1)).toEqual(original);
  });

  it("thins evenly, keeping the first and the last point exactly", () => {
    const result = resampleToCount(original, 12, 1);
    expect(result).toHaveLength(12);
    expect(result[0]).toBe(original[0]);
    expect(result[11]).toBe(original[49]);
    // Every kept point is one of the originals, in the original order.
    const indices = result.map((p) => original.indexOf(p));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  it("adds nudged copies when more points are wanted, still ending on the targets", () => {
    const result = resampleToCount(original, 130, 42, 1);
    expect(result).toHaveLength(130);
    expect(result[0]).toEqual(original[0]);
    expect(result[129]).toEqual(original[49]);
    // Nothing strays further than the jitter from an original point, and
    // every original point is still present exactly.
    for (const point of result) {
      const nearest = Math.min(
        ...original.map((o) => distance([o.x, o.y], [point.x, point.y])),
      );
      expect(nearest).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (const o of original.slice(0, 49)) {
      expect(result.some((p) => p.x === o.x && p.y === o.y)).toBe(true);
    }
  });

  it("keeps the tone of the point a copy comes from", () => {
    const result = resampleToCount(original, 130, 42, 1);
    let copies = 0;
    for (const point of result) {
      // The originals are 3 or more apart and a copy is at most 1 from its own
      // source, so the nearest original is that source.
      const [source, gap] = original
        .map((o) => [o, distance([o.x, o.y], [point.x, point.y])] as const)
        .sort((a, b) => a[1] - b[1])[0]!;
      expect(gap).toBeLessThanOrEqual(1 + 1e-9);
      expect(point.tone, `copy of x=${source.x}`).toBe(source.tone);
      if (gap > 0) copies += 1;
    }
    // 130 outputs from 50 points: most of them are nudged copies.
    expect(copies).toBeGreaterThan(60);
    expect(new Set(result.map((p) => p.tone))).toEqual(new Set([0, 1]));
  });

  it("with a single input point and a count of 2 or more: starts and ends on that point, the rest are nudged copies of it", () => {
    const only: TargetPoint = { x: 12, y: -7, tone: 1 };
    for (const count of [2, 3, 50]) {
      const result = resampleToCount([only], count, 9, 1);
      expect(result, `count ${count}`).toHaveLength(count);
      expect(result[0], `count ${count} first`).toEqual(only);
      expect(result[count - 1], `count ${count} last`).toEqual(only);
      for (const point of result) {
        expect(
          distance([point.x, point.y], [only.x, only.y]),
        ).toBeLessThanOrEqual(1 + 1e-9);
        expect(point.tone).toBe(1);
      }
    }
    // The middle ones are copies, not the same point repeated.
    const many = resampleToCount([only], 50, 9, 1);
    expect(
      many.slice(1, -1).some((p) => p.x !== only.x || p.y !== only.y),
    ).toBe(true);
    // Same seed, same copies.
    expect(resampleToCount([only], 50, 9, 1)).toEqual(many);
  });

  it("gives the same points for the same seed, and different copies for another seed", () => {
    const a = resampleToCount(original, 130, 42);
    expect(resampleToCount(original, 130, 42)).toEqual(a);
    expect(resampleToCount(original, 130, 43)).not.toEqual(a);
    // Thinning uses no randomness at all.
    expect(resampleToCount(original, 12, 1)).toEqual(
      resampleToCount(original, 12, 999),
    );
  });

  it("handles one point, none, and bad input", () => {
    expect(resampleToCount(original, 0, 1)).toEqual([]);
    expect(resampleToCount(original, 1, 1)).toEqual([original[0]]);
    expect(() => resampleToCount(original, 2.5, 1)).toThrow(RangeError);
    expect(() => resampleToCount(original, -1, 1)).toThrow(RangeError);
    expect(() => resampleToCount([], 5, 1)).toThrow(RangeError);
  });

  it("can fill a large budget from a small list", () => {
    const few = original.slice(0, 3);
    const result = resampleToCount(few, 900, 5);
    expect(result).toHaveLength(900);
    expect(result[0]).toEqual(few[0]);
    expect(result[899]).toEqual(few[2]);
  });
});
