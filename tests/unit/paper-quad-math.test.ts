import { describe, expect, it } from "vitest";
import {
  clamp,
  computeReportingStats,
  computeSideCoverage,
  convexHull,
  fitLineRansac,
  intersectLines,
  isConvexQuad,
  lineFromTwoPoints,
  mulberry32,
  orderQuadCorners,
  polygonArea,
  RANSAC_SEED,
  signedDistance,
  simplifyToQuad,
  totalLeastSquaresLine,
} from "../../src/client/paper/quad-math";
import type { Point2 } from "../../src/client/geometry/homography";

describe("clamp", () => {
  it("clamps below, within and above the range", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("convexHull", () => {
  it("returns the hull of a square with interior points removed", () => {
    const points: Point2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior — must not survive
      { x: 2, y: 2 },
    ];
    const hull = convexHull(points);
    expect(hull).toHaveLength(4);
    for (const p of hull) {
      expect(p.x === 0 || p.x === 10 || p.y === 0 || p.y === 10).toBe(true);
    }
  });

  it("ignores a concave notch cut into one side (occluder boundary)", () => {
    // A square's bottom edge with a notch pulled inward — the hull must
    // still be exactly the 4 outer corners, mirroring how a hand/wrist
    // occluder's boundary never survives into detect.ts's coarse hull.
    const points: Point2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 6, y: 10 },
      { x: 5, y: 6 }, // notch, pulled inward from the y=10 edge
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    const hull = convexHull(points);
    expect(hull.some((p) => p.x === 5 && p.y === 6)).toBe(false);
  });

  it("collapses duplicate points and returns them as-is under 3 distinct points", () => {
    const hull = convexHull([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    expect(hull.length).toBeLessThan(3);
  });
});

describe("simplifyToQuad", () => {
  it("returns a hexagon's 4 most significant vertices", () => {
    // A square with two extra vertices barely perturbing one side —
    // Visvalingam-Whyatt should drop the two low-area ones first.
    const hull: Point2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0.01 }, // negligible-area extra vertex
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 9.99 }, // negligible-area extra vertex
      { x: 0, y: 10 },
    ];
    const quad = simplifyToQuad(hull);
    expect(quad).not.toBeNull();
    expect(quad).toHaveLength(4);
    const xs = quad!.map((p) => p.x).sort((a, b) => a - b);
    const ys = quad!.map((p) => p.y).sort((a, b) => a - b);
    expect(xs).toEqual([0, 0, 10, 10]);
    expect(ys[0]).toBeCloseTo(0, 1);
    expect(ys[3]).toBeCloseTo(10, 1);
  });

  it("returns null for fewer than 4 points", () => {
    expect(
      simplifyToQuad([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ]),
    ).toBeNull();
  });

  it("returns the input unchanged when it is already exactly 4 points", () => {
    const quad: Point2[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(simplifyToQuad(quad)).toEqual(quad);
  });
});

describe("orderQuadCorners", () => {
  it("orders an axis-aligned square as TL, TR, BR, BL", () => {
    const shuffled: [Point2, Point2, Point2, Point2] = [
      { x: 10, y: 10 }, // BR
      { x: 0, y: 0 }, // TL
      { x: 0, y: 10 }, // BL
      { x: 10, y: 0 }, // TR
    ];
    const [tl, tr, br, bl] = orderQuadCorners(shuffled);
    expect(tl).toEqual({ x: 0, y: 0 });
    expect(tr).toEqual({ x: 10, y: 0 });
    expect(br).toEqual({ x: 10, y: 10 });
    expect(bl).toEqual({ x: 0, y: 10 });
  });

  it("orders a mildly rotated/perspective quad correctly", () => {
    const quad: [Point2, Point2, Point2, Point2] = [
      { x: 12, y: 8 }, // TL-ish
      { x: 110, y: 2 }, // TR-ish
      { x: 105, y: 95 }, // BR-ish
      { x: 8, y: 100 }, // BL-ish
    ];
    const shuffled: [Point2, Point2, Point2, Point2] = [
      quad[2],
      quad[0],
      quad[3],
      quad[1],
    ];
    expect(orderQuadCorners(shuffled)).toEqual(quad);
  });
});

describe("lineFromTwoPoints / signedDistance / intersectLines", () => {
  it("builds a unit-normal line and reports zero distance for points on it", () => {
    const line = lineFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 })!;
    expect(Math.hypot(line.nx, line.ny)).toBeCloseTo(1, 10);
    expect(signedDistance(line, { x: 5, y: 0 })).toBeCloseTo(0, 10);
    expect(Math.abs(signedDistance(line, { x: 5, y: 3 }))).toBeCloseTo(3, 10);
  });

  it("returns null for two coincident points", () => {
    expect(lineFromTwoPoints({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it("intersects a horizontal and a vertical line at the expected point", () => {
    const horizontal = lineFromTwoPoints({ x: 0, y: 5 }, { x: 10, y: 5 })!;
    const vertical = lineFromTwoPoints({ x: 3, y: 0 }, { x: 3, y: 10 })!;
    const p = intersectLines(horizontal, vertical);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(3, 9);
    expect(p!.y).toBeCloseTo(5, 9);
  });

  it("returns null for two parallel lines", () => {
    const a = lineFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 })!;
    const b = lineFromTwoPoints({ x: 0, y: 5 }, { x: 10, y: 5 })!;
    expect(intersectLines(a, b)).toBeNull();
  });
});

describe("totalLeastSquaresLine", () => {
  it("recovers an exact horizontal line with zero residual", () => {
    const points: Point2[] = [0, 1, 2, 3, 4].map((x) => ({ x, y: 7 }));
    const line = totalLeastSquaresLine(points);
    for (const p of points) {
      expect(Math.abs(signedDistance(line, p))).toBeCloseTo(0, 9);
    }
  });

  it("recovers a 45-degree line through the origin", () => {
    const points: Point2[] = [0, 1, 2, 3, 4].map((t) => ({ x: t, y: t }));
    const line = totalLeastSquaresLine(points);
    expect(Math.abs(signedDistance(line, { x: 5, y: 5 }))).toBeCloseTo(0, 9);
  });

  it("throws for fewer than 2 points", () => {
    expect(() => totalLeastSquaresLine([{ x: 0, y: 0 }])).toThrow();
  });

  it("fits the low-noise trend through points with small symmetric jitter", () => {
    const points: Point2[] = [];
    for (let x = 0; x <= 20; x++) {
      points.push({ x, y: 3 + (x % 2 === 0 ? 0.05 : -0.05) });
    }
    const line = totalLeastSquaresLine(points);
    expect(Math.abs(signedDistance(line, { x: 10, y: 3 }))).toBeLessThan(0.06);
  });
});

describe("fitLineRansac", () => {
  const seededRng = () => mulberry32(RANSAC_SEED);

  it("fits a clean horizontal line with all points as inliers", () => {
    const points: Point2[] = Array.from({ length: 30 }, (_, i) => ({
      x: i,
      y: 10,
    }));
    const fit = fitLineRansac(points, { rng: seededRng() });
    expect(fit).not.toBeNull();
    expect(fit!.inliers.length).toBe(30);
    expect(fit!.meanResidualPx).toBeCloseTo(0, 6);
  });

  it("rejects a cluster of gross outliers (occluder-like) and keeps the true line", () => {
    const points: Point2[] = [];
    for (let x = 0; x < 40; x++) points.push({ x, y: 10 });
    // A localized cluster of points ~40px off the line — like a hand
    // crossing this side.
    for (let x = 15; x < 25; x++) points.push({ x, y: 50 });
    const fit = fitLineRansac(points, { rng: seededRng() });
    expect(fit).not.toBeNull();
    expect(fit!.inliers.length).toBe(40);
    expect(fit!.meanResidualPx).toBeLessThan(0.5);
  });

  it("returns null when there are fewer points than minPoints", () => {
    const fit = fitLineRansac(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      { minPoints: 5, rng: seededRng() },
    );
    expect(fit).toBeNull();
  });

  it("is deterministic across repeated calls with the same fixed-seed RNG", () => {
    const points: Point2[] = Array.from({ length: 25 }, (_, i) => ({
      x: i,
      y: i % 3 === 0 ? 5.2 : 4.8,
    }));
    const a = fitLineRansac(points, { rng: mulberry32(RANSAC_SEED) });
    const b = fitLineRansac(points, { rng: mulberry32(RANSAC_SEED) });
    expect(a).toEqual(b);
  });
});

describe("computeSideCoverage", () => {
  it("reports full coverage for points spread across every bin", () => {
    const points: Point2[] = Array.from({ length: 50 }, (_, i) => ({
      x: i * 2,
      y: 0,
    }));
    const coverage = computeSideCoverage(
      points,
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      40,
    );
    expect(coverage).toBeCloseTo(1, 1);
  });

  it("reports a gap hidden in the middle, not full coverage from the span alone", () => {
    // Points only in the first and last quarter of the segment — a
    // min/max-span metric would (wrongly) read this as ~full coverage.
    const points: Point2[] = [];
    for (let x = 0; x < 20; x++) points.push({ x, y: 0 });
    for (let x = 80; x < 100; x++) points.push({ x, y: 0 });
    const coverage = computeSideCoverage(
      points,
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      40,
    );
    expect(coverage).toBeCloseTo(0.4, 1);
    expect(coverage).toBeLessThan(0.9);
  });

  it("returns 0 for a degenerate (zero-length) segment", () => {
    expect(
      computeSideCoverage([{ x: 0, y: 0 }], { x: 5, y: 5 }, { x: 5, y: 5 }),
    ).toBe(0);
  });
});

describe("computeReportingStats", () => {
  it("keeps only points within the threshold and reports their mean residual", () => {
    const line = lineFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 })!;
    const points: Point2[] = [
      { x: 1, y: 1 }, // distance 1
      { x: 2, y: 2 }, // distance 2
      { x: 3, y: 100 }, // gross outlier — must be excluded at threshold 5
    ];
    const stats = computeReportingStats(points, line, 5);
    expect(stats.points).toHaveLength(2);
    expect(stats.meanResidualPx).toBeCloseTo(1.5, 6);
  });

  it("returns zero residual when nothing survives the threshold", () => {
    const line = lineFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 })!;
    const stats = computeReportingStats([{ x: 5, y: 100 }], line, 1);
    expect(stats.points).toHaveLength(0);
    expect(stats.meanResidualPx).toBe(0);
  });
});

describe("polygonArea", () => {
  it("computes a 10x10 square's area as 100", () => {
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBeCloseTo(100, 9);
  });
});

describe("isConvexQuad", () => {
  it("accepts a square", () => {
    expect(
      isConvexQuad([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(true);
  });

  it("rejects a self-intersecting (bowtie) quad", () => {
    expect(
      isConvexQuad([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(false);
  });

  it("rejects a concave (arrow-shaped) quad", () => {
    expect(
      isConvexQuad([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 3 }, // pulled well inside the TL-TR-BL triangle — concave
        { x: 0, y: 10 },
      ]),
    ).toBe(false);
  });
});

describe("mulberry32", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
