import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PALMATE_MARK_DOT,
  PALMATE_MARK_INK,
  PALMATE_MARK_PATH,
  PALMATE_MARK_STROKE,
  PALMATE_MARK_STROKE_WIDTH,
  PALMATE_MARK_VIEWBOX,
  palmateMarkInkEdges,
} from "../../src/lib/brand/palmate-mark";

/**
 * The official mark is data copied from the Pencil frame "Logo · Palmate
 * (Official)" (m8WzTO, per PR #171). Pinned here so a stray edit fails a test
 * instead of changing the logo on every share card.
 */
describe("palmate-mark data", () => {
  it("is the official path, byte for byte", () => {
    expect(PALMATE_MARK_PATH).toHaveLength(261);
    expect(createHash("sha256").update(PALMATE_MARK_PATH).digest("hex")).toBe(
      "d2bd0d4abf18d7adb2c08a0e6da7395217a748d097dcf88f19053c356d246723",
    );
  });

  it("has the official viewBox, stroke and core dot", () => {
    expect(PALMATE_MARK_VIEWBOX).toEqual({ x: 10, y: 10, w: 70, h: 70 });
    expect(PALMATE_MARK_STROKE).toBe("#7FA8FF");
    expect(PALMATE_MARK_STROKE_WIDTH).toBe(1.4);
    expect(PALMATE_MARK_DOT).toMatchObject({
      cx: 45,
      cy: 53.5,
      outerRadius: 1.55,
      ringColor: "#2463EB",
      fillColor: "#CFE0FF",
    });
  });
});

/** The path's extremes by sampling its cubic segments (the path uses M, c and m only). */
function inkOf(d: string) {
  const tokens = d.match(/[MmCc]|-?\d+(?:\.\d+)?/g)!;
  let i = 0;
  let x = 0;
  let y = 0;
  let cmd = "";
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const num = () => parseFloat(tokens[i++]!);
  const add = (px: number, py: number) => {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  };
  while (i < tokens.length) {
    if (/[MmCc]/.test(tokens[i]!)) cmd = tokens[i++]!;
    if (cmd === "M" || cmd === "m") {
      const dx = num();
      const dy = num();
      x = cmd === "M" ? dx : x + dx;
      y = cmd === "M" ? dy : y + dy;
      add(x, y);
      cmd = cmd === "M" ? "L" : "l";
    } else if (cmd === "c") {
      const p = [num(), num(), num(), num(), num(), num()] as const;
      const [x1, y1, x2, y2, x3, y3] = [
        x + p[0],
        y + p[1],
        x + p[2],
        y + p[3],
        x + p[4],
        y + p[5],
      ];
      for (let t = 0; t <= 1; t += 1 / 2000) {
        const u = 1 - t;
        add(
          u * u * u * x +
            3 * u * u * t * x1 +
            3 * u * t * t * x2 +
            t * t * t * x3,
          u * u * u * y +
            3 * u * u * t * y1 +
            3 * u * t * t * y2 +
            t * t * t * y3,
        );
      }
      x = x3;
      y = y3;
    } else {
      throw new Error(`unexpected path command ${cmd}`);
    }
  }
  return { minX, minY, maxX, maxY };
}

describe("palmate-mark ink box", () => {
  it("is what the path paints: its extremes plus half the line width, rounded outward", () => {
    const e = inkOf(PALMATE_MARK_PATH);
    const half = PALMATE_MARK_STROKE_WIDTH / 2;
    expect(PALMATE_MARK_INK.x0).toBeLessThanOrEqual(e.minX - half + 1e-9);
    expect(PALMATE_MARK_INK.y0).toBeLessThanOrEqual(e.minY - half + 1e-9);
    expect(PALMATE_MARK_INK.x1).toBeGreaterThanOrEqual(e.maxX + half - 1e-9);
    expect(PALMATE_MARK_INK.y1).toBeGreaterThanOrEqual(e.maxY + half - 1e-9);
    // ... and no more than a hundredth of a unit outside it.
    expect(e.minX - half - PALMATE_MARK_INK.x0).toBeLessThan(0.01);
    expect(e.minY - half - PALMATE_MARK_INK.y0).toBeLessThan(0.01);
    expect(PALMATE_MARK_INK.x1 - (e.maxX + half)).toBeLessThan(0.01);
    expect(PALMATE_MARK_INK.y1 - (e.maxY + half)).toBeLessThan(0.01);
  });

  it("lies inside the viewBox, and the core dot lies inside the ink", () => {
    const vb = PALMATE_MARK_VIEWBOX;
    expect(PALMATE_MARK_INK.x0).toBeGreaterThanOrEqual(vb.x);
    expect(PALMATE_MARK_INK.y0).toBeGreaterThanOrEqual(vb.y);
    expect(PALMATE_MARK_INK.x1).toBeLessThanOrEqual(vb.x + vb.w);
    expect(PALMATE_MARK_INK.y1).toBeLessThanOrEqual(vb.y + vb.h);
    const d = PALMATE_MARK_DOT;
    expect(d.cx - d.outerRadius).toBeGreaterThan(PALMATE_MARK_INK.x0);
    expect(d.cx + d.outerRadius).toBeLessThan(PALMATE_MARK_INK.x1);
    expect(d.cy - d.outerRadius).toBeGreaterThan(PALMATE_MARK_INK.y0);
    expect(d.cy + d.outerRadius).toBeLessThan(PALMATE_MARK_INK.y1);
  });

  it("scales into a box: the ink edges follow the viewBox scale", () => {
    const box = { x: 100, y: 200, w: 140 };
    const edges = palmateMarkInkEdges(box);
    const scale = 140 / 70;
    expect(edges.left).toBeCloseTo(100 + (PALMATE_MARK_INK.x0 - 10) * scale, 9);
    expect(edges.bottom).toBeCloseTo(
      200 + (PALMATE_MARK_INK.y1 - 10) * scale,
      9,
    );
    expect(edges.right).toBeGreaterThan(edges.left);
    expect(edges.bottom).toBeGreaterThan(edges.top);
  });
});
