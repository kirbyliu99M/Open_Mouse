import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMatrix } from "@/lib/particles/geometry";
import {
  parsePathData,
  parseSketchSvg,
  parseTransform,
} from "@/lib/particles/svg-path";

describe("parsePathData", () => {
  it("reads absolute and relative lines, and closes a subpath", () => {
    const [shape] = parsePathData("M10 10l20 0 0 20H10V10z");
    expect(shape!.closed).toBe(true);
    expect(shape!.points).toEqual([
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
      [10, 10],
    ]);
  });

  it("treats the pairs after a moveto as linetos", () => {
    const [line] = parsePathData("M0 0 5 0 5 5");
    expect(line!.points).toEqual([
      [0, 0],
      [5, 0],
      [5, 5],
    ]);
  });

  it("flattens a relative cubic to its own end point and stays inside its control box", () => {
    const [curve] = parsePathData("M0 0c0 10 20 10 20 0");
    const points = curve!.points;
    expect(points[0]).toEqual([0, 0]);
    const end = points[points.length - 1]!;
    expect(end[0]).toBeCloseTo(20, 9);
    expect(end[1]).toBeCloseTo(0, 9);
    expect(points.length).toBeGreaterThan(8);
    // The curve bulges to y = 7.5 at its middle (3/4 of the control height).
    expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(7.5, 1);
  });

  it("reads numbers glued together by signs and by decimal points", () => {
    const [line] = parsePathData("M1.5.5l-2-3.25.75-1");
    expect(line!.points).toEqual([
      [1.5, 0.5],
      [-0.5, -2.75],
      [0.25, -3.75],
    ]);
  });

  it("starts a new subpath at each moveto", () => {
    const shapes = parsePathData("M0 0l1 1M5 5l1 1z");
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.closed).toBe(false);
    expect(shapes[1]!.closed).toBe(true);
  });

  it("refuses a command it does not handle instead of sampling the wrong shape", () => {
    expect(() => parsePathData("M0 0A5 5 0 0 1 10 0")).toThrow(/unsupported/);
    expect(() => parsePathData("M0 0Q5 5 10 0")).toThrow(/unsupported/);
  });
});

describe("parseTransform", () => {
  it("composes a transform list left to right, as SVG does", () => {
    // translate then scale: the scale applies to the point first.
    const matrix = parseTransform("translate(10 20) scale(2 3)");
    expect(applyMatrix(matrix, [1, 1])).toEqual([12, 23]);
  });

  it("defaults to the identity and refuses an unknown function", () => {
    expect(applyMatrix(parseTransform(undefined), [4, 5])).toEqual([4, 5]);
    expect(() => parseTransform("rotate(45)")).toThrow(/unsupported/);
  });
});

describe("parseSketchSvg", () => {
  const sketch = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50" fill="none">${body}</svg>`;

  it("applies each group's transform to its path and keeps the stroke colour", () => {
    const parsed = parseSketchSvg(
      sketch(
        `<g transform="translate(5 5) scale(2 2)"><path d="M0 0l10 0" stroke="#CFE0FF" stroke-width="1"></path></g>`,
      ),
    );
    expect(parsed.viewBox).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(parsed.strokes).toHaveLength(1);
    expect(parsed.strokes[0]!.stroke).toBe("#cfe0ff");
    expect(parsed.strokes[0]!.polyline.points).toEqual([
      [5, 5],
      [25, 5],
    ]);
  });

  it("refuses elements it does not read", () => {
    expect(() => parseSketchSvg(sketch(`<circle r="3"/>`))).toThrow(
      /unsupported <circle>/,
    );
    expect(() => parseSketchSvg(`<svg><g></g></svg>`)).toThrow(/viewBox/);
  });

  it("reads the real G Pro sketch: 38 strokes in the two stroke colours, inside its viewBox", () => {
    const svg = readFileSync("public/images/sketches/g-pro-sketch.svg", "utf8");
    const parsed = parseSketchSvg(svg);
    const colours = new Set(parsed.strokes.map((s) => s.stroke));
    expect(colours).toEqual(new Set(["#cfe0ff", "#6e9bf5"]));
    expect(parsed.strokes.length).toBeGreaterThanOrEqual(38);
    const { x, y, width, height } = parsed.viewBox;
    for (const { polyline } of parsed.strokes) {
      for (const [px, py] of polyline.points) {
        expect(px).toBeGreaterThan(x - 2);
        expect(px).toBeLessThan(x + width + 2);
        expect(py).toBeGreaterThan(y - 2);
        expect(py).toBeLessThan(y + height + 2);
      }
    }
  });
});
