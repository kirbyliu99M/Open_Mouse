import { describe, expect, it } from "vitest";
import type { Polyline, Vec } from "@/lib/particles/geometry";
import { clipPolyline, clipPolylines } from "@/lib/particles/line-clip";
import { type Mask, dilateMask, maskAt } from "@/lib/particles/text-mask";

function mask(
  width: number,
  height: number,
  rects: readonly [number, number, number, number][] = [],
): Mask {
  const data = new Uint8Array(width * height);
  for (const [x, y, w, h] of rects) {
    for (let j = y; j < y + h; j += 1) {
      for (let i = x; i < x + w; i += 1) data[j * width + i] = 1;
    }
  }
  return { width, height, data };
}

const line = (points: Vec[], closed = false): Polyline => ({ points, closed });

describe("clipPolyline", () => {
  it("gives a line back exactly as it was when no letter is there", () => {
    const open = line([
      [1, 1],
      [30, 4.5],
      [12, 18],
    ]);
    expect(clipPolyline(open, mask(40, 20))).toEqual([open]);
    const closed = line(
      [
        [2, 2],
        [20, 2],
        [20, 15],
      ],
      true,
    );
    expect(clipPolyline(closed, mask(40, 20))).toEqual([closed]);
    // A letter elsewhere changes nothing either.
    expect(clipPolyline(open, mask(40, 20, [[35, 0, 5, 3]]))).toEqual([open]);
  });

  it("gives nothing for a line the letters cover completely", () => {
    expect(
      clipPolyline(
        line([
          [2, 2],
          [18, 8],
        ]),
        mask(20, 10, [[0, 0, 20, 10]]),
      ),
    ).toEqual([]);
    expect(clipPolyline(line([]), mask(4, 4))).toEqual([]);
  });

  it("cuts a line where it crosses a letter, to within a step, and keeps nothing inside it", () => {
    const bar = mask(40, 10, [[18, 0, 4, 10]]); // x 18 to 22
    const pieces = clipPolyline(
      line([
        [0, 5],
        [40, 5],
      ]),
      bar,
      0.5,
    );
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces;
    expect(left!.points[0]).toEqual([0, 5]);
    expect(right!.points[right!.points.length - 1]).toEqual([40, 5]);
    const leftEnd = left!.points[left!.points.length - 1]![0];
    const rightStart = right!.points[0]![0];
    expect(leftEnd).toBeLessThan(18);
    expect(leftEnd).toBeGreaterThanOrEqual(18 - 0.5);
    expect(rightStart).toBeGreaterThanOrEqual(22);
    expect(rightStart).toBeLessThanOrEqual(22 + 0.5);
    for (const piece of pieces) {
      expect(piece.closed).toBe(false);
      for (const [x, y] of piece.points) expect(maskAt(bar, x, y)).toBe(false);
    }
  });

  it("never steps further than `step`, even when the length is not a whole number of steps", () => {
    // A 10.5 px line walked at most 3 px apart: 4 steps of 2.625 (whole steps
    // of 3.5 would jump from x = 3.5 to 7 and miss columns 4-6).
    const bar = mask(12, 3, [[4, 0, 3, 3]]);
    const pieces = clipPolyline(
      line([
        [0, 1.5],
        [10.5, 1.5],
      ]),
      bar,
      3,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.points[pieces[0]!.points.length - 1]![0]).toBeCloseTo(
      2.625,
      12,
    );
    expect(pieces[1]!.points[0]![0]).toBeCloseTo(7.875, 12);
  });

  it("rounds the number of steps up, not to the nearest: 10.2 px at most 3 apart is 4 steps", () => {
    // 10.2 / 3 = 3.4: four steps of 2.55 put a point at x = 5.1 in the bar
    // (columns 4-6) and one at 7.65 after it. Three steps of 3.4 would keep
    // only x = 10.2 after the bar, a single point, which is dropped.
    const bar = mask(12, 3, [[4, 0, 3, 3]]);
    const pieces = clipPolyline(
      line([
        [0, 1.5],
        [10.2, 1.5],
      ]),
      bar,
      3,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]!.points[pieces[0]!.points.length - 1]![0]).toBeCloseTo(
      2.55,
      12,
    );
    expect(pieces[1]!.points[0]![0]).toBeCloseTo(7.65, 12);
  });

  it("keeps the line's own corners in a piece", () => {
    const pieces = clipPolyline(
      line([
        [0, 2],
        [10, 2],
        [10, 18],
        [30, 18],
      ]),
      mask(40, 20, [[20, 10, 4, 10]]),
    );
    expect(pieces[0]!.points).toContainEqual([10, 2]);
    expect(pieces[0]!.points).toContainEqual([10, 18]);
  });

  it("joins a closed line's two ends into one piece when it is cut away from its start", () => {
    // A square ring; the letter covers the middle of its right side.
    const ring = line(
      [
        [2, 2],
        [20, 2],
        [20, 20],
        [2, 20],
      ],
      true,
    );
    const pieces = clipPolyline(ring, mask(30, 30, [[18, 9, 5, 4]]));
    expect(pieces).toHaveLength(1);
    const piece = pieces[0]!.points;
    // It runs from below the letter, round through the start, to above it.
    expect(piece[0]![0]).toBe(20);
    expect(piece[0]![1]).toBeGreaterThanOrEqual(13);
    expect(piece[piece.length - 1]![0]).toBe(20);
    expect(piece[piece.length - 1]![1]).toBeLessThan(9);
    expect(piece.filter(([x, y]) => x === 2 && y === 2)).toHaveLength(1);
  });

  it("cuts more of a line the more the letters are grown (dilateMask)", () => {
    // A line 3 px above a letter: kept at a 2 px growth, cut at 4.
    const letter = mask(40, 20, [[15, 10, 10, 6]]);
    const passing = line([
      [0, 6.5],
      [40, 6.5],
    ]);
    expect(clipPolyline(passing, dilateMask(letter, 2))).toEqual([passing]);
    const cut = clipPolyline(passing, dilateMask(letter, 4));
    expect(cut).toHaveLength(2);
    const kept = (pieces: Polyline[]) =>
      pieces.reduce(
        (s, p) =>
          s + Math.abs(p.points[p.points.length - 1]![0] - p.points[0]![0]),
        0,
      );
    expect(kept(clipPolyline(passing, dilateMask(letter, 6)))).toBeLessThan(
      kept(cut),
    );
  });

  it("drops a piece too short to draw (a single free point between two letters)", () => {
    const pieces = clipPolyline(
      line([
        [0, 1.5],
        [9, 1.5],
      ]),
      mask(9, 3, [
        [0, 0, 4, 3],
        [5, 0, 4, 3],
      ]),
      1,
    );
    expect(pieces).toEqual([]);
  });

  it("refuses a step that is not a positive number", () => {
    const l = line([
      [0, 0],
      [5, 5],
    ]);
    expect(() => clipPolyline(l, mask(5, 5), 0)).toThrow(/step/);
    expect(() => clipPolyline(l, mask(5, 5), Number.NaN)).toThrow(/step/);
  });

  it("clips a list of lines into one list of pieces", () => {
    const m = mask(40, 10, [[18, 0, 4, 10]]);
    const lines = [
      line([
        [0, 5],
        [40, 5],
      ]),
      line([
        [0, 1],
        [10, 1],
      ]),
    ];
    expect(clipPolylines(lines, m)).toEqual([
      ...clipPolyline(lines[0]!, m),
      lines[1]!,
    ]);
  });
});
