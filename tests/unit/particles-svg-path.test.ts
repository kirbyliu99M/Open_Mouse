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

  it("starts a new subpath at the closed one's start when a drawing command follows a closepath", () => {
    // SVG 1.1, 8.3.3: after Z the current point is the subpath's start, so an
    // l, h, v or c with no moveto begins there. The start point must not be lost.
    const afterL = parsePathData("M0 0l10 0 0 10zl-5 0");
    expect(afterL).toHaveLength(2);
    expect(afterL[0]!.closed).toBe(true);
    expect(afterL[1]!.closed).toBe(false);
    expect(afterL[1]!.points).toEqual([
      [0, 0],
      [-5, 0],
    ]);
    expect(parsePathData("M2 3l10 0 0 10zL7 9")[1]!.points).toEqual([
      [2, 3],
      [7, 9],
    ]);
    expect(parsePathData("M2 3l10 0 0 10zh4")[1]!.points).toEqual([
      [2, 3],
      [6, 3],
    ]);
    expect(parsePathData("M2 3l10 0 0 10zV9")[1]!.points).toEqual([
      [2, 3],
      [2, 9],
    ]);
    const afterC = parsePathData("M0 0l10 0 0 10zc0 5 5 5 5 0")[1]!.points;
    expect(afterC[0]).toEqual([0, 0]);
    expect(afterC[afterC.length - 1]![0]).toBeCloseTo(5, 9);
  });

  it("refuses a path that does not start with a moveto, instead of starting it at the origin", () => {
    expect(() => parsePathData("L5 5")).toThrow(/moveto/);
    expect(() => parsePathData("c0 0 1 1 2 2")).toThrow(/moveto/);
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

  it("reads a path at the top level, outside every group, as well as one inside a group", () => {
    const parsed = parseSketchSvg(
      sketch(
        `<path d="M0 0l10 0" stroke="#CFE0FF"></path>` +
          `<g transform="translate(5 5)"><path d="M0 0l10 0" stroke="#6E9BF5"></path></g>`,
      ),
    );
    expect(parsed.strokes.map((s) => s.stroke)).toEqual(["#cfe0ff", "#6e9bf5"]);
    expect(parsed.strokes[0]!.polyline.points).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(parsed.strokes[1]!.polyline.points).toEqual([
      [5, 5],
      [15, 5],
    ]);
  });

  it("composes the transforms of nested groups, outermost first, then the path's own", () => {
    const parsed = parseSketchSvg(
      sketch(
        `<g transform="translate(10 0)">` +
          `<g transform="scale(2 2)">` +
          `<path d="M1 1l1 0" stroke="#CFE0FF" transform="translate(0 3)"></path>` +
          `</g>` +
          // Back in the outer group only: the inner scale no longer applies.
          `<path d="M1 1l1 0" stroke="#CFE0FF"></path>` +
          `</g>`,
      ),
    );
    // (1, 1) +3 in y by the path, scaled by 2, then moved 10 in x.
    expect(parsed.strokes[0]!.polyline.points).toEqual([
      [12, 8],
      [14, 8],
    ]);
    expect(parsed.strokes[1]!.polyline.points).toEqual([
      [11, 1],
      [12, 1],
    ]);
  });

  it("refuses unbalanced groups and a nested <svg> instead of reading them wrongly", () => {
    expect(() =>
      parseSketchSvg(sketch(`<path d="M0 0l1 1" stroke="#CFE0FF"></path></g>`)),
    ).toThrow(/<\/g> with no <g>/);
    expect(() =>
      parseSketchSvg(sketch(`<g><path d="M0 0l1 1" stroke="#CFE0FF"></path>`)),
    ).toThrow(/never closed/);
    expect(() =>
      parseSketchSvg(
        sketch(
          `<svg viewBox="0 0 1 1"><path d="M0 0l1 1" stroke="#CFE0FF"></path></svg>`,
        ),
      ),
    ).toThrow(/nested <svg>/);
  });

  it("refuses a path with no stroke of its own (a stroke set on a group is not read)", () => {
    expect(() =>
      parseSketchSvg(
        sketch(`<g stroke="#CFE0FF"><path d="M0 0l1 1"></path></g>`),
      ),
    ).toThrow(/without d or stroke/);
  });

  it("reads single-quoted attributes: the viewBox, a group's transform, a path's d and stroke", () => {
    const parsed = parseSketchSvg(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='10 20 100 50'>` +
        `<g transform='translate(5 5) scale(2 2)'>` +
        `<path d='M0 0l10 0' stroke='#CFE0FF'></path></g></svg>`,
    );
    expect(parsed.viewBox).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(parsed.strokes[0]!.stroke).toBe("#cfe0ff");
    // translate(5 5) scale(2 2): (0,0) -> (5,5), (10,0) -> (25,5).
    expect(parsed.strokes[0]!.polyline.points).toEqual([
      [5, 5],
      [25, 5],
    ]);
  });

  it("reads attributes with white space around the equals sign, and mixed quotes", () => {
    const parsed = parseSketchSvg(
      `<svg viewBox = "0 0 8 8">` +
        `<g transform = 'translate(1 2)'>` +
        `<path d =\n  "M0 0l2 0"  stroke= '#6E9BF5' />` +
        `</g></svg>`,
    );
    expect(parsed.viewBox.width).toBe(8);
    expect(parsed.strokes[0]!.stroke).toBe("#6e9bf5");
    expect(parsed.strokes[0]!.polyline.points).toEqual([
      [1, 2],
      [3, 2],
    ]);
  });

  it("refuses a transform on the root <svg> instead of dropping it", () => {
    expect(() =>
      parseSketchSvg(
        `<svg viewBox="0 0 10 10" transform="scale(2)">` +
          `<path d="M0 0l1 1" stroke="#CFE0FF"></path></svg>`,
      ),
    ).toThrow(/transform on its root <svg>/);
    expect(() =>
      parseSketchSvg(
        `<svg viewBox='0 0 10 10' transform = 'translate(1 1)'>` +
          `<path d='M0 0l1 1' stroke='#CFE0FF'></path></svg>`,
      ),
    ).toThrow(/transform on its root <svg>/);
  });

  it("an attribute named like the end of another is not mistaken for it (data-d is not d)", () => {
    expect(() =>
      parseSketchSvg(
        `<svg viewBox="0 0 10 10"><path data-d="M0 0l1 1" stroke="#CFE0FF"></path></svg>`,
      ),
    ).toThrow(/without d or stroke/);
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
