import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS, SKETCH_DIR } from "@/lib/particles/artifacts";
import { STROKE_SPREAD, densifyStrokes, shareOut } from "@/lib/particles/dense";
import { type Vec, distance } from "@/lib/particles/geometry";
import { parseTargets } from "@/lib/particles/load-targets";
import { logoStrokes } from "@/lib/particles/logo";
import {
  buildPairing,
  buildPairingInSlices,
  groupByRank,
  sortByX,
} from "@/lib/particles/pairing";
import { mulberry32 } from "@/lib/particles/random";
import {
  type StrokeRun,
  type TargetPoint,
  resampleToCount,
  sampleStrokeRuns,
} from "@/lib/particles/sampling";
import { SAMPLING, STAGE_WIDTH } from "@/lib/particles/targets";
import {
  createHandFiller,
  fillTemplateHand,
} from "@/lib/particles/template-hand";
import { parseSketchSvg } from "@/lib/particles/svg-path";

const committed = readFileSync(ARTIFACT_PATHS.targets, "utf8");
const targets = parseTargets(JSON.parse(committed));
const mice = ["g-pro-sketch", "g-pro-sketch", "g-pro-sketch"];

/** The distance from a point to the nearest part of a set of polylines. */
function distanceToPolylines(
  [x, y]: Vec,
  polylines: readonly { points: readonly Vec[]; closed: boolean }[],
): number {
  let best = Infinity;
  for (const { points, closed } of polylines) {
    const n = points.length;
    for (let i = 0; i < (closed ? n : n - 1); i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared),
            );
      best = Math.min(
        best,
        Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t)),
      );
    }
  }
  return best;
}

describe("shareOut", () => {
  it("gives every weight its share and always adds up to the count", () => {
    expect(shareOut([1, 1, 1], 9)).toEqual([3, 3, 3]);
    expect(shareOut([1, 3], 8)).toEqual([2, 6]);
    for (const [weights, count] of [
      [[3, 4, 5], 1000],
      [[1, 1, 1], 10],
      [[7, 1, 1, 1], 99],
      [[0.2, 0.5, 0.3], 7],
    ] as const) {
      const shares = shareOut(weights, count);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(count);
      shares.forEach((share, i) => {
        const exact =
          (weights[i]! * count) / weights.reduce((a, b) => a + b, 0);
        expect(Math.abs(share - exact)).toBeLessThan(1);
      });
    }
  });

  it("gives the extra ones to the biggest remainders, the earlier first on a tie", () => {
    expect(shareOut([1, 1, 1], 10)).toEqual([4, 3, 3]);
    expect(shareOut([5, 1], 4)).toEqual([3, 1]);
  });

  it("refuses to share between nothing", () => {
    expect(() => shareOut([], 5)).toThrow(RangeError);
    expect(() => shareOut([0, 0], 5)).toThrow(RangeError);
  });
});

describe("densifyStrokes on a small shape", () => {
  // An open stroke of 3 points on a line, bright; a closed square of 4, dim.
  const points: TargetPoint[] = [
    { x: 0, y: 0, tone: 1 },
    { x: 10, y: 0, tone: 1 },
    { x: 20, y: 0, tone: 1 },
    { x: 0, y: 10, tone: 0 },
    { x: 10, y: 10, tone: 0 },
    { x: 10, y: 20, tone: 0 },
    { x: 0, y: 20, tone: 0 },
  ];
  const runs: StrokeRun[] = [
    { start: 0, count: 3, closed: false },
    { start: 3, count: 4, closed: true },
  ];
  const lines = [
    {
      points: points.slice(0, 3).map((p): Vec => [p.x, p.y]),
      closed: false,
    },
    {
      points: points.slice(3).map((p): Vec => [p.x, p.y]),
      closed: true,
    },
  ];
  const out = densifyStrokes(points, runs, 700, 5);

  it("makes exactly the count asked for, in proportion to the points of each stroke", () => {
    expect(out).toHaveLength(700);
    const bright = out.filter((p) => p.tone === 1).length;
    expect(bright).toBe(300);
    expect(out.length - bright).toBe(400);
  });

  it("starts an open stroke on its first point and ends it on its last, exactly", () => {
    const stroke = out.filter((p) => p.tone === 1);
    expect(stroke[0]).toEqual({ x: 0, y: 0, tone: 1 });
    expect(stroke[stroke.length - 1]).toEqual({ x: 20, y: 0, tone: 1 });
  });

  it("keeps every particle on its stroke, within a bell-shaped spread: never beyond 2.5 deviations", () => {
    const limit = STROKE_SPREAD * 2.5 + 1e-9;
    for (const p of out) {
      expect(distanceToPolylines([p.x, p.y], lines)).toBeLessThanOrEqual(limit);
    }
    // And it really spreads: they are not all on the line.
    const off = out.filter(
      (p) => distanceToPolylines([p.x, p.y], lines) > STROKE_SPREAD * 0.2,
    );
    expect(off.length).toBeGreaterThan(300);
  });

  it("spaces particles evenly along a stroke: no gap is more than three times the mean", () => {
    const along = out
      .filter((p) => p.tone === 1)
      .map((p) => p.x)
      .sort((a, b) => a - b);
    const gaps = along.slice(1).map((x, i) => x - along[i]!);
    const mean = 20 / along.length;
    expect(Math.max(...gaps)).toBeLessThan(mean * 3);
  });

  it("takes the whole of a closed stroke, the closing edge included", () => {
    const closing = out.filter(
      (p) => p.tone === 0 && p.x < 1 && p.y > 11 && p.y < 19,
    );
    // The edge from (0, 20) back to (0, 10): a fifth of the perimeter's worth of particles lies along it.
    expect(closing.length).toBeGreaterThan(40);
  });

  it("is the same for the same seed and different for another", () => {
    expect(densifyStrokes(points, runs, 700, 5)).toEqual(out);
    expect(densifyStrokes(points, runs, 700, 6)).not.toEqual(out);
  });

  it("thins instead when no more points are wanted than there are, exactly as resampleToCount does", () => {
    expect(densifyStrokes(points, runs, 5, 9)).toEqual(
      resampleToCount(points, 5, 9),
    );
    expect(densifyStrokes(points, runs, 7, 9)).toEqual(
      resampleToCount(points, 7, 9),
    );
  });

  it("refuses a count that is not a whole number", () => {
    expect(() => densifyStrokes(points, runs, -1, 1)).toThrow(RangeError);
    expect(() => densifyStrokes(points, runs, 2.5, 1)).toThrow(RangeError);
  });

  it("handles a stroke of one point", () => {
    const dot = densifyStrokes(
      [{ x: 5, y: 5, tone: 1 }],
      [{ start: 0, count: 1, closed: false }],
      20,
      3,
    );
    expect(dot).toHaveLength(20);
    expect(dot[0]).toEqual({ x: 5, y: 5, tone: 1 });
    for (const p of dot) {
      expect(distance([p.x, p.y], [5, 5])).toBeLessThanOrEqual(
        STROKE_SPREAD * 2.5 + 1e-9,
      );
    }
  });
});

describe("densifyStrokes on the real shapes", () => {
  it("puts every logo particle within the spread of the logo's own strokes, and ends the ruler exactly", () => {
    const polylines = logoStrokes().map((s) => s.polyline);
    const out = densifyStrokes(
      targets.logo.points,
      targets.logo.runs,
      12000,
      20261003,
    );
    expect(out).toHaveLength(12000);
    // Across the stroke by the spread, plus the sampled points' own error: they
    // are rounded to 0.1 px in the JSON, and a chord between two of them cuts
    // the corner of a tight curve (the wheel's ellipse) by a fraction of a px.
    const limit = STROKE_SPREAD * 2.5 + 0.5;
    for (const p of out) {
      expect(distanceToPolylines([p.x, p.y], polylines)).toBeLessThan(limit);
    }
    expect(new Set(out.map((p) => p.tone))).toEqual(new Set([0, 1]));
  });

  const sketches = Object.fromEntries(
    readdirSync(SKETCH_DIR)
      .filter((file) => file.endsWith(".svg"))
      .map((file) => [
        basename(file, ".svg"),
        readFileSync(`${SKETCH_DIR}/${file}`, "utf8"),
      ]),
  );

  it.each(Object.keys(sketches))(
    "puts every %s particle on the sketch and keeps the ends of every open stroke",
    (name) => {
      const sketch = parseSketchSvg(sketches[name]!);
      const scale = STAGE_WIDTH / sketch.viewBox.width;
      const polylines = sketch.strokes.map(({ polyline }) => ({
        closed: polyline.closed,
        points: polyline.points.map(([x, y]): Vec => [
          (x - sketch.viewBox.x) * scale,
          (y - sketch.viewBox.y) * scale,
        ]),
      }));
      const target = targets.mice[name]!;
      const out = densifyStrokes(target.points, target.runs, 4000, 3);
      expect(out).toHaveLength(4000);
      // Across the stroke by the spread, and along a chord that cuts a curve's corner by a hair.
      const limit = STROKE_SPREAD * 2.5 + 0.3;
      for (const p of out) {
        expect(distanceToPolylines([p.x, p.y], polylines)).toBeLessThan(limit);
      }
      for (const run of target.runs.filter((r) => !r.closed)) {
        const first = target.points[run.start]!;
        const last = target.points[run.start + run.count - 1]!;
        for (const end of [first, last]) {
          expect(
            out.some((p) => p.x === end.x && p.y === end.y),
            `stroke end ${end.x}, ${end.y}`,
          ).toBe(true);
        }
      }
    },
  );

  it("is more even than copies nudged by a pixel: no stretch of a stroke is left bare", () => {
    // The longest run of the logo's outline: walk it and find the biggest gap between particles.
    const out = densifyStrokes(
      targets.logo.points,
      targets.logo.runs,
      12000,
      1,
    );
    const outline = logoStrokes()[0]!.polyline;
    const hits = outline.points.map(([x, y]) =>
      out.some((p) => Math.hypot(p.x - x, p.y - y) < 1.2),
    );
    expect(hits.every(Boolean)).toBe(true);
  });
});

describe("the sampled runs", () => {
  it("say which consecutive points belong to which stroke, with the closed ones marked", () => {
    const { points, runs } = sampleStrokeRuns(
      [
        {
          tone: 1,
          polyline: {
            points: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
            closed: true,
          },
        },
        {
          tone: 0,
          polyline: {
            points: [
              [20, 0],
              [30, 0],
            ],
            closed: false,
          },
        },
      ],
      SAMPLING,
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ start: 0, closed: true });
    expect(runs[1]).toMatchObject({ closed: false });
    expect(runs[0]!.count + runs[1]!.count).toBe(points.length);
    expect(runs[1]!.start).toBe(runs[0]!.count);
    expect(points.slice(0, runs[0]!.count).every((p) => p.tone === 1)).toBe(
      true,
    );
  });

  it("cover the committed logo and every mouse point exactly once, in order", () => {
    for (const shape of [targets.logo, ...Object.values(targets.mice)]) {
      let next = 0;
      for (const run of shape.runs) {
        expect(run.start).toBe(next);
        next += run.count;
      }
      expect(next).toBe(shape.points.length);
      for (const run of shape.runs) {
        const tones = new Set(
          shape.points
            .slice(run.start, run.start + run.count)
            .map((p) => p.tone),
        );
        expect(tones.size).toBe(1);
      }
    }
  });

  it("the file refuses runs that do not fit its points", () => {
    const raw = JSON.parse(committed);
    const bad = (runs: unknown) =>
      parseTargets({ ...raw, logo: { ...raw.logo, runs } });
    expect(() => bad(undefined)).toThrow(/runs/);
    expect(() => bad([])).toThrow(/runs/);
    expect(() => bad([[0, 5]])).toThrow(/runs/);
    expect(() => bad([[0, 5, 2]])).toThrow(/0 or 1/);
    expect(() => bad([[0.5, 5, 0]])).toThrow(/0 or 1/);
    expect(() => bad([[0, 999999, 0]])).toThrow(/outside/);
    expect(() =>
      bad([
        [0, 10, 0],
        [5, 10, 0],
      ]),
    ).toThrow(/overlaps/);
    expect(() => bad([[0, 0, 0]])).toThrow(/outside/);
  });
});

describe("the hand's fill, grown in the browser", () => {
  it("goes on where the generator stopped: filling in slices gives the same points as filling at once", () => {
    const filler = createHandFiller(11);
    const sliced = [
      ...filler.next(100),
      ...filler.next(250),
      ...filler.next(1),
      ...filler.next(649),
    ];
    expect(sliced).toEqual(fillTemplateHand(1000, 11));
  });

  it("starts with the points the committed file holds (to the 0.1 px it is rounded to)", () => {
    const fill = fillTemplateHand(targets.hand.points.length, targets.seed);
    fill.forEach((p, i) => {
      const committedPoint = targets.hand.points[i]!;
      expect(Math.abs(p.x - committedPoint.x)).toBeLessThanOrEqual(0.05001);
      expect(Math.abs(p.y - committedPoint.y)).toBeLessThanOrEqual(0.05001);
      expect(p.tone).toBe(committedPoint.tone);
    });
  });
});

describe("sorting by packed keys", () => {
  /** Points on a coarse grid, so many tie on x and some on both. */
  const grid = (n: number, seed: number): TargetPoint[] => {
    const random = mulberry32(seed);
    return Array.from({ length: n }, () => ({
      x: Math.floor(random() * 40) / 2,
      y: Math.floor(random() * 40) / 2,
      tone: random() < 0.5 ? 0 : 1,
    }));
  };

  it("orders by x, then y, then input order, exactly like a comparator would, with many ties", () => {
    const points = grid(3000, 3);
    const reference = points
      .map((point, index) => ({ point, index }))
      .sort(
        (a, b) =>
          a.point.x - b.point.x || a.point.y - b.point.y || a.index - b.index,
      )
      .map(({ point }) => point);
    const sorted = sortByX(points);
    // Same objects, same order (identity, so ties are checked too).
    expect(sorted.every((p, i) => p === reference[i])).toBe(true);
  });

  it("ranks into groups exactly like a comparator would, by y and by x", () => {
    const points = grid(2999 + 1, 8);
    for (const axis of ["x", "y"] as const) {
      const other = axis === "x" ? "y" : "x";
      const ranked = points
        .map((point, index) => ({ point, index }))
        .sort(
          (a, b) =>
            a.point[axis] - b.point[axis] ||
            a.point[other] - b.point[other] ||
            a.index - b.index,
        );
      const expected = new Array<number>(points.length);
      ranked.forEach(({ index }, rank) => {
        expected[index] = Math.floor(rank / (points.length / 4));
      });
      expect(groupByRank(points, 4, axis)).toEqual(expected);
    }
  });

  it("copes with a list that is all one x, an empty list and a single point", () => {
    const column = Array.from({ length: 50 }, (_, i) => ({
      x: 3,
      y: 50 - i,
      tone: 0 as const,
    }));
    expect(sortByX(column).map((p) => p.y)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    expect(sortByX([])).toEqual([]);
    expect(sortByX([column[0]!])).toEqual([column[0]]);
  });
});

describe("pairing at a dense budget", () => {
  const options = {
    count: 6000,
    layout: "stacked",
    seed: 20261003,
    mice,
    density: "dense",
  } as const;
  const pairing = buildPairing(targets, options);

  it("has the budget's count in every list and a third of it in each mouse", () => {
    expect(pairing.count).toBe(6000);
    expect(pairing.logo).toHaveLength(6000);
    expect(pairing.hand).toHaveLength(6000);
    expect(pairing.mouse).toHaveLength(6000);
    const slots = [0, 0, 0];
    for (const s of pairing.slot) slots[s] = slots[s]! + 1;
    expect(slots).toEqual([2000, 2000, 2000]);
  });

  it("is reproducible: the same seed gives the same pairing, another seed a different one", () => {
    expect(buildPairing(targets, options)).toEqual(pairing);
    expect(buildPairing(targets, { ...options, seed: 1 })).not.toEqual(pairing);
  });

  it("pairs by x, as the sparse one does: both the logo and the hand come out sorted (to the sort's own resolution, far under a pixel)", () => {
    for (const list of [pairing.logo, pairing.hand]) {
      for (let i = 1; i < list.length; i += 1) {
        expect(list[i]!.x).toBeGreaterThanOrEqual(list[i - 1]!.x - 1e-3);
      }
    }
  });

  it("leaves the sparse pairing, the Canvas 2D fallback's, exactly as it was", () => {
    const sparse = buildPairing(targets, {
      ...options,
      count: 900,
      density: "sparse",
    });
    const implicit = buildPairing(targets, {
      ...options,
      count: 900,
      density: undefined,
    });
    expect(implicit).toEqual(sparse);
    expect(sparse.logo).toHaveLength(900);
  });

  it("falls back to thinning where a dense count is no more than the list has", () => {
    // 1,200 hand points are fewer than the 1,400 committed: no fill, an even pick.
    const small = buildPairing(targets, { ...options, count: 1200 });
    expect(small.hand).toHaveLength(1200);
  });

  it("can be built in slices, and gives the same pairing, with a pause between a good many of them", async () => {
    let pauses = 0;
    const sliced = await buildPairingInSlices(
      targets,
      { ...options, count: 12000 },
      async () => {
        pauses += 1;
      },
    );
    expect(sliced).toEqual(buildPairing(targets, { ...options, count: 12000 }));
    // A pause for the logo, five slices of the hand, and each mouse.
    expect(pauses).toBeGreaterThanOrEqual(8);
  });
});

describe("what the stage ships", () => {
  it("keeps the targets file small: its gzip is a fraction of the 100 KB the particle module may add", () => {
    const gzip = gzipSync(committed).length;
    expect(gzip).toBeLessThan(30_000);
  });
});

describe("the packed-key sort is exactly the comparator's order", () => {
  /** What `sortByX` was before the packed keys: a comparator sort by x, then y, then input order. */
  const byComparator = <T extends { x: number; y: number }>(points: T[]) =>
    points
      .map((point, index) => ({ point, index }))
      .sort(
        (a, b) =>
          a.point.x - b.point.x || a.point.y - b.point.y || a.index - b.index,
      )
      .map(({ point }) => point);

  it("on 12,000 jittered points, where many are closer than the keys' resolution, the objects come out in the same order", () => {
    const dense = densifyStrokes(
      targets.logo.points,
      targets.logo.runs,
      12000,
      3,
    );
    const sorted = sortByX(dense);
    const reference = byComparator(dense);
    expect(sorted.every((p, i) => p === reference[i])).toBe(true);
  });

  it("on points closer together than the resolution (the same x to 1e-9, y apart by 1e-4), it is still x, then y", () => {
    const random = mulberry32(5);
    const points: TargetPoint[] = Array.from({ length: 5000 }, () => ({
      x: 100 + Math.floor(random() * 4) * 1e-9,
      y: Math.floor(random() * 50) * 1e-4,
      tone: 0,
    }));
    const sorted = sortByX(points);
    const reference = byComparator(points);
    expect(sorted.every((p, i) => p === reference[i])).toBe(true);
  });

  it("the Canvas 2D fallback's pairing, at its budgets, is the one the comparator sorts made: particle for particle, as on main", () => {
    for (const [count, layout] of [
      [1299, "row"],
      [900, "stacked"],
      [648, "row"],
      [450, "stacked"],
    ] as const) {
      const seed = 20261003;
      const got = buildPairing(targets, { count, layout, seed, mice });
      // The same steps as before the packed keys, with comparator sorts.
      const perMouse = count / 3;
      const logo = byComparator(
        resampleToCount(targets.logo.points, count, seed),
      );
      const hand = byComparator(
        resampleToCount(targets.hand.points, count, seed + 1),
      );
      const miceSorted = mice.map((name, slot) =>
        byComparator(
          resampleToCount(
            targets.mice[name]!.points,
            perMouse,
            seed + 2 + slot,
          ),
        ),
      );
      const axis = layout === "stacked" ? "y" : "x";
      const other = axis === "x" ? "y" : "x";
      const ranked = hand
        .map((point, index) => ({ point, index }))
        .sort(
          (a, b) =>
            a.point[axis] - b.point[axis] ||
            a.point[other] - b.point[other] ||
            a.index - b.index,
        );
      const groupOf = new Array<number>(count);
      ranked.forEach(({ index }, rank) => {
        groupOf[index] = Math.floor(rank / perMouse);
      });
      const next = [0, 0, 0];
      const mouse: TargetPoint[] = [];
      const slot: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const g = groupOf[i]!;
        mouse.push(miceSorted[g]![next[g]!]!);
        slot.push(g);
        next[g] = next[g]! + 1;
      }
      expect(got.logo, `${count} ${layout}: logo`).toEqual(logo);
      expect(got.hand, `${count} ${layout}: hand`).toEqual(hand);
      expect(got.mouse, `${count} ${layout}: mouse`).toEqual(mouse);
      expect(got.slot, `${count} ${layout}: slot`).toEqual(slot);
    }
  });
});
