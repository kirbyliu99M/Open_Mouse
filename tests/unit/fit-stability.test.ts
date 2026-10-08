import { describe, expect, it } from "vitest";
import type { FitResponse } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  PERTURBATIONS,
  compareRankings,
  foldMeasures,
  palmLengthSweep,
  perturbationRuns,
  type EngineFn,
} from "../../src/server/fit/stability";
import type { CatalogueMouse } from "../../src/server/fit/types";

type Ranked = Pick<FitResponse, "results">;

/** A ranking with only the fields the stability code reads. */
const ranked = (entries: [slug: string, total: number][]): Ranked =>
  ({
    results: entries.map(([slug, total], i) => ({
      rank: i + 1,
      total,
      mouse: { slug },
    })),
  }) as unknown as Ranked;

const NO_CATALOGUE: CatalogueMouse[] = [];
const base: HandMeasurements = {
  handLengthMm: 185,
  palmLengthMm: 104,
  palmWidthMm: 76,
};

describe("compareRankings", () => {
  const baseRanking = ranked([
    ["a", 90],
    ["b", 80],
    ["c", 70],
    ["d", 60],
    ["e", 50],
    ["f", 40],
  ]);

  it("identical rankings: top-1 kept, Jaccard 1, no change", () => {
    expect(compareRankings(baseRanking, baseRanking)).toEqual({
      top1Kept: true,
      top5Jaccard: 1,
      maxTotalChange: 0,
    });
  });

  it("Jaccard is intersection over union of the two top-5 sets (3/7 here)", () => {
    const perturbed = ranked([
      ["a", 90],
      ["b", 80],
      ["c", 70],
      ["x", 65],
      ["y", 55],
    ]);
    // top5 base {a,b,c,d,e}, perturbed {a,b,c,x,y}: 3 shared, 7 in the union.
    expect(compareRankings(baseRanking, perturbed).top5Jaccard).toBeCloseTo(
      3 / 7,
      12,
    );
  });

  it("disjoint top 5s have Jaccard 0; a mouse only at rank 6 does not count", () => {
    const disjoint = ranked([
      ["p", 99],
      ["q", 98],
      ["r", 97],
      ["s", 96],
      ["t", 95],
    ]);
    expect(compareRankings(baseRanking, disjoint).top5Jaccard).toBe(0);
    const rank6 = ranked([
      ["a", 90],
      ["b", 80],
      ["c", 70],
      ["d", 60],
      ["x", 55],
      ["e", 50],
    ]);
    // top5 {a,b,c,d,x} vs {a,b,c,d,e}: 4 shared, union 6.
    expect(compareRankings(baseRanking, rank6).top5Jaccard).toBeCloseTo(
      4 / 6,
      12,
    );
  });

  it("short rankings: only what exists is compared; two empty rankings are identical", () => {
    expect(
      compareRankings(ranked([["a", 90]]), ranked([["a", 90]])).top5Jaccard,
    ).toBe(1);
    expect(
      compareRankings(ranked([["a", 90]]), ranked([["b", 90]])).top5Jaccard,
    ).toBe(0);
    expect(compareRankings(ranked([]), ranked([])).top5Jaccard).toBe(1);
  });

  it("top-1 kept compares the first slug", () => {
    expect(
      compareRankings(
        baseRanking,
        ranked([
          ["b", 90],
          ["a", 80],
        ]),
      ).top1Kept,
    ).toBe(false);
    expect(
      compareRankings(
        baseRanking,
        ranked([
          ["a", 10],
          ["b", 9],
        ]),
      ).top1Kept,
    ).toBe(true);
  });

  it("max total change is the largest |change| over the base top 5, in either direction", () => {
    const perturbed = ranked([
      ["a", 88], // -2
      ["b", 85], // +5
      ["c", 62], // -8
      ["d", 61], // +1
      ["e", 50], // 0
      ["f", 0], // rank 6 in base: ignored
    ]);
    expect(compareRankings(baseRanking, perturbed).maxTotalChange).toBe(8);
  });

  it("a base top-5 mouse missing from the perturbed ranking is skipped", () => {
    const perturbed = ranked([
      ["a", 91],
      ["b", 80],
    ]);
    expect(compareRankings(baseRanking, perturbed).maxTotalChange).toBe(1);
  });
});

describe("foldMeasures", () => {
  it("counts runs, kept top-1s, averages Jaccard and takes the largest change", () => {
    const m = foldMeasures([
      { top1Kept: true, top5Jaccard: 1, maxTotalChange: 2 },
      { top1Kept: false, top5Jaccard: 0.5, maxTotalChange: 7 },
      { top1Kept: true, top5Jaccard: 0.6, maxTotalChange: 3 },
    ]);
    expect(m.runs).toBe(3);
    expect(m.top1Kept).toBe(2);
    expect(m.top5Jaccard).toBeCloseTo((1 + 0.5 + 0.6) / 3, 12);
    expect(m.maxTotalChange).toBe(7);
  });

  it("a single run is that run", () => {
    expect(
      foldMeasures([{ top1Kept: false, top5Jaccard: 0.25, maxTotalChange: 4 }]),
    ).toEqual({ runs: 1, top1Kept: 0, top5Jaccard: 0.25, maxTotalChange: 4 });
  });
});

describe("perturbationRuns", () => {
  /** Records every measurement it is called with; ranks "hi" first from hand length 185 up. */
  function spyEngine() {
    const calls: HandMeasurements[] = [];
    const engine: EngineFn = (m) => {
      calls.push(m);
      return {
        results: ranked(
          m.handLengthMm >= 185
            ? [
                ["hi", 90],
                ["lo", 80],
              ]
            : [
                ["lo", 85],
                ["hi", 70],
              ],
        ).results,
      } as unknown as ReturnType<EngineFn>;
    };
    return { engine, calls };
  }

  it("runs the base once, then one perturbed run per step, changing only the named measurement", () => {
    const { engine, calls } = spyEngine();
    const p = PERTURBATIONS.find((x) => x.label === "hand length ±5 mm")!;
    const runs = perturbationRuns(engine, NO_CATALOGUE, "right", base, p);
    expect(calls).toEqual([
      base,
      { ...base, handLengthMm: 190 },
      { ...base, handLengthMm: 180 },
    ]);
    expect(runs).toHaveLength(2);
    // +5 keeps "hi" first; -5 puts "lo" first. Base: hi 90, lo 80; -5: lo 85, hi 70.
    expect(runs[0]).toEqual({
      top1Kept: true,
      top5Jaccard: 1,
      maxTotalChange: 0,
    });
    expect(runs[1]).toEqual({
      top1Kept: false,
      top5Jaccard: 1,
      maxTotalChange: 20,
    });
  });

  it.each([
    ["palm length ±3 mm", { palmLengthMm: 107 }, { palmLengthMm: 101 }],
    ["palm width ±3 mm", { palmWidthMm: 79 }, { palmWidthMm: 73 }],
    ["hand length ±8 mm", { handLengthMm: 193 }, { handLengthMm: 177 }],
  ])("%s", (label, plus, minus) => {
    const { engine, calls } = spyEngine();
    const p = PERTURBATIONS.find((x) => x.label === label)!;
    perturbationRuns(engine, NO_CATALOGUE, "left", base, p);
    expect(calls.slice(1)).toEqual([
      { ...base, ...plus },
      { ...base, ...minus },
    ]);
  });

  it("passes the hand and preferences through", () => {
    const seen: unknown[] = [];
    const engine: EngineFn = (_m, _c, p, h) => {
      seen.push([p, h]);
      return { results: [] } as unknown as ReturnType<EngineFn>;
    };
    perturbationRuns(engine, NO_CATALOGUE, "left", base, PERTURBATIONS[0], {
      includeVertical: true,
    });
    expect(seen).toHaveLength(3);
    for (const s of seen) {
      expect(s).toEqual([{ includeVertical: true }, "left"]);
    }
  });
});

describe("palmLengthSweep", () => {
  /** An engine whose single mouse total is f(palm length). */
  const engineOf =
    (f: (palm: number) => number, visited?: number[]): EngineFn =>
    (m) => {
      visited?.push(m.palmLengthMm);
      return {
        results: ranked([["m", f(m.palmLengthMm)]]).results,
      } as unknown as ReturnType<EngineFn>;
    };

  it("reports a known jump and where it happens", () => {
    // Total is 50 below palm 100 and 60 from 100 up: the jump is 10, between 99.5 and 100.
    const sweep = palmLengthSweep(
      engineOf((p) => (p < 100 ? 50 : 60)),
      NO_CATALOGUE,
      "right",
      base,
    );
    expect(sweep).toEqual({
      maxJump: 10,
      slug: "m",
      fromPalmLengthMm: 99.5,
      toPalmLengthMm: 100,
    });
  });

  it("reports the largest of several jumps", () => {
    const sweep = palmLengthSweep(
      engineOf((p) => (p >= 100 ? 5 : 0) + (p >= 110 ? 12 : 0)),
      NO_CATALOGUE,
      "right",
      base,
    );
    expect(sweep.maxJump).toBe(12);
    expect(sweep.fromPalmLengthMm).toBe(109.5);
    expect(sweep.toPalmLengthMm).toBe(110);
  });

  it("a total that does not depend on palm length has no jump", () => {
    expect(
      palmLengthSweep(
        engineOf(() => 70),
        NO_CATALOGUE,
        "right",
        base,
      ).maxJump,
    ).toBe(0);
  });

  it("a gently sloping total reports the per-step change, not the total change", () => {
    // 0.4 points per mm of palm length: 0.2 per 0.5 mm step.
    const sweep = palmLengthSweep(
      engineOf((p) => 0.4 * p),
      NO_CATALOGUE,
      "right",
      base,
    );
    expect(sweep.maxJump).toBeCloseTo(0.2, 9);
  });

  it("steps palm length by 0.5 mm over r in [0.50, 0.62] of the fixed hand length", () => {
    const visited: number[] = [];
    palmLengthSweep(
      engineOf(() => 1, visited),
      NO_CATALOGUE,
      "right",
      base,
    );
    // 0.50 * 185 = 92.5; 0.62 * 185 = 114.7, so the last step on the grid is 114.5.
    expect(visited[0]).toBe(92.5);
    expect(visited[visited.length - 1]).toBe(114.5);
    expect(visited).toHaveLength(45);
    for (let i = 1; i < visited.length; i++) {
      expect(visited[i] - visited[i - 1]).toBe(0.5);
    }
  });

  it("honours the options and keeps the other measurements fixed", () => {
    const calls: HandMeasurements[] = [];
    const engine: EngineFn = (m) => {
      calls.push(m);
      return { results: [] } as unknown as ReturnType<EngineFn>;
    };
    palmLengthSweep(engine, NO_CATALOGUE, "left", base, {
      rMin: 0.55,
      rMax: 0.56,
      stepMm: 1,
    });
    // 0.55 * 185 = 101.75 → 102; 0.56 * 185 = 103.6 → 103.
    expect(calls.map((c) => c.palmLengthMm)).toEqual([102, 103]);
    expect(
      calls.every(
        (c) =>
          c.handLengthMm === base.handLengthMm &&
          c.palmWidthMm === base.palmWidthMm,
      ),
    ).toBe(true);
  });

  it("a mouse that is not in both neighbouring steps is not compared", () => {
    const engine: EngineFn = (m) =>
      ({
        results: ranked(m.palmLengthMm < 100 ? [["a", 10]] : [["b", 99]])
          .results,
      }) as unknown as ReturnType<EngineFn>;
    expect(palmLengthSweep(engine, NO_CATALOGUE, "right", base).maxJump).toBe(
      0,
    );
  });
});
