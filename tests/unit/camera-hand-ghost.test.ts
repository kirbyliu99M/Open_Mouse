import { describe, expect, it } from "vitest";
import { computeHandGhostGeometry } from "../../src/client/camera/handGhost";
import type { Quad } from "../../src/client/camera/quad";

const SQUARE: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 100, y: 0 },
  bottomRight: { x: 100, y: 100 },
  bottomLeft: { x: 0, y: 100 },
};

/** Pulls the numeric x/y pairs out of a Catmull-Rom "M x y C .. .. x y C .. .." path string. */
function extractPoints(d: string): { x: number; y: number }[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

describe("computeHandGhostGeometry", () => {
  it("builds a closed cubic-Bézier path (M ... C ... Z) with more than a handful of points", () => {
    const { outlineD } = computeHandGhostGeometry(SQUARE, "right");
    expect(outlineD.startsWith("M ")).toBe(true);
    expect(outlineD.trim().endsWith("Z")).toBe(true);
    expect(outlineD.match(/C /g)?.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps the outline roughly within the quad, with only the thumb tip allowed to overshoot slightly", () => {
    const { outlineD } = computeHandGhostGeometry(SQUARE, "right");
    const points = extractPoints(outlineD);
    const overshoots = points.filter(
      (p) => p.x < -15 || p.x > 115 || p.y < -15 || p.y > 115,
    );
    expect(overshoots.length).toBeLessThan(points.length * 0.15);
  });

  it("places the wrist near the bottom edge and the longest fingertip near the top", () => {
    const { outlineD } = computeHandGhostGeometry(SQUARE, "right");
    const points = extractPoints(outlineD);
    const maxY = Math.max(...points.map((p) => p.y));
    const minY = Math.min(...points.map((p) => p.y));
    expect(maxY).toBeGreaterThan(90);
    expect(minY).toBeLessThan(10);
  });

  it("mirrors left vs. right around the quad's horizontal centre", () => {
    const right = extractPoints(
      computeHandGhostGeometry(SQUARE, "right").outlineD,
    );
    const left = extractPoints(
      computeHandGhostGeometry(SQUARE, "left").outlineD,
    );
    expect(right.length).toBe(left.length);
    for (let i = 0; i < right.length; i++) {
      expect(left[i].x).toBeCloseTo(100 - right[i].x, 3);
      expect(left[i].y).toBeCloseTo(right[i].y, 3);
    }
  });

  it("is not a mirror no-op (thumb genuinely switches sides)", () => {
    const right = computeHandGhostGeometry(SQUARE, "right").outlineD;
    const left = computeHandGhostGeometry(SQUARE, "left").outlineD;
    expect(right).not.toEqual(left);
  });

  it("scales the hand's width to ~45% of its length, derived from the quad's own pixel size, not a fixed fraction of the quad", () => {
    // A tall, narrow quad: hand length spans most of a big height, so the
    // 45%-of-length width should be much narrower than the quad itself.
    const tall: Quad = {
      topLeft: { x: 480, y: 0 },
      topRight: { x: 520, y: 0 },
      bottomRight: { x: 520, y: 1000 },
      bottomLeft: { x: 480, y: 1000 },
    };
    const { outlineD } = computeHandGhostGeometry(tall, "right");
    const points = extractPoints(outlineD);
    const xs = points.map((p) => p.x);
    const spanX = Math.max(...xs) - Math.min(...xs);
    // Quad is only 40 units wide; the hand's real-proportioned width would
    // want to be ~0.45 * 0.93 * 1000 ≈ 419 units — clamped by
    // MAX_WIDTH_FRACTION, but still much wider than the 40-unit quad itself
    // (the hand overflows a narrow paper, which is realistic).
    expect(spanX).toBeGreaterThan(40);
  });

  it("returns 3 finger-gap hint line segments, each a [start, end] pair", () => {
    const { fingerGapLines } = computeHandGhostGeometry(SQUARE, "right");
    expect(fingerGapLines).toHaveLength(3);
    for (const [a, b] of fingerGapLines) {
      expect(typeof a.x).toBe("number");
      expect(typeof b.y).toBe("number");
    }
  });

  it("mirrors the finger-gap lines too", () => {
    const right = computeHandGhostGeometry(SQUARE, "right").fingerGapLines;
    const left = computeHandGhostGeometry(SQUARE, "left").fingerGapLines;
    for (let i = 0; i < right.length; i++) {
      expect(left[i][0].x).toBeCloseTo(100 - right[i][0].x, 3);
      expect(left[i][1].x).toBeCloseTo(100 - right[i][1].x, 3);
    }
  });

  it("follows a non-square tracked quad rather than the caller's raw coordinates", () => {
    const shifted: Quad = {
      topLeft: { x: 200, y: 200 },
      topRight: { x: 400, y: 210 },
      bottomRight: { x: 410, y: 500 },
      bottomLeft: { x: 190, y: 490 },
    };
    const { outlineD } = computeHandGhostGeometry(shifted, "right");
    const points = extractPoints(outlineD);
    for (const p of points) {
      expect(p.x).toBeGreaterThan(100);
      expect(p.x).toBeLessThan(500);
      expect(p.y).toBeGreaterThan(150);
      expect(p.y).toBeLessThan(550);
    }
  });
});
