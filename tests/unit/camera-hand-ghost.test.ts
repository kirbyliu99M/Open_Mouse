import { describe, expect, it } from "vitest";
import {
  computeHandGhostPoints,
  handGhostPathD,
} from "../../src/client/camera/handGhost";
import type { Quad } from "../../src/client/camera/quad";

const SQUARE: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 100, y: 0 },
  bottomRight: { x: 100, y: 100 },
  bottomLeft: { x: 0, y: 100 },
};

describe("computeHandGhostPoints", () => {
  it("returns a closed outline entirely inside the quad (a placement hint, never touching the edges)", () => {
    const points = computeHandGhostPoints(SQUARE, "right");
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it("places the wrist near the bottom edge and fingertips near the top", () => {
    const points = computeHandGhostPoints(SQUARE, "right");
    const maxY = Math.max(...points.map((p) => p.y));
    const minY = Math.min(...points.map((p) => p.y));
    expect(maxY).toBeGreaterThan(90); // wrist, near the bottom
    expect(minY).toBeLessThan(15); // fingertips, near the top
  });

  it("mirrors left vs. right around the quad's horizontal centre", () => {
    const right = computeHandGhostPoints(SQUARE, "right");
    const left = computeHandGhostPoints(SQUARE, "left");
    for (let i = 0; i < right.length; i++) {
      expect(left[i].x).toBeCloseTo(100 - right[i].x, 5);
      expect(left[i].y).toBeCloseTo(right[i].y, 5);
    }
  });

  it("is not just a mirror no-op (thumb genuinely switches sides)", () => {
    const right = computeHandGhostPoints(SQUARE, "right");
    const left = computeHandGhostPoints(SQUARE, "left");
    expect(right).not.toEqual(left);
  });

  it("follows a non-square tracked quad rather than the caller's raw coordinates", () => {
    const shifted: Quad = {
      topLeft: { x: 200, y: 200 },
      topRight: { x: 400, y: 210 },
      bottomRight: { x: 410, y: 500 },
      bottomLeft: { x: 190, y: 490 },
    };
    const points = computeHandGhostPoints(shifted, "right");
    for (const p of points) {
      expect(p.x).toBeGreaterThan(150);
      expect(p.x).toBeLessThan(450);
      expect(p.y).toBeGreaterThan(150);
      expect(p.y).toBeLessThan(550);
    }
  });
});

describe("handGhostPathD", () => {
  it("builds a closed SVG path starting and implicitly closing at the first point", () => {
    const d = handGhostPathD([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(d).toBe("M 0 0 L 10 0 L 10 10 Z");
  });

  it("returns an empty string for no points", () => {
    expect(handGhostPathD([])).toBe("");
  });
});
