import { describe, expect, it } from "vitest";
import {
  SIGMA_INPUT_B_NO_EXIF,
  STABILITY_SAMPLES,
  STABILITY_SEED,
} from "../../src/server/fit/coefficients-v2";
import { computePriors } from "../../src/server/fit/priors";
import { kendallTau, topKOverlap } from "../../src/server/fit/rank-compare-v2";
import { scoreFitV2 } from "../../src/server/fit/score-v2";
import {
  percentile,
  rankingStabilityV2,
} from "../../src/server/fit/stability-v2";
import { goldenHands, seedCatalogue } from "./fit-v2-fixtures";

const prefs = { includeVertical: false } as const;
const priors = computePriors(seedCatalogue);
const hand = goldenHands.medium_claw;
const stab = (options: Parameters<typeof rankingStabilityV2>[5] = {}) =>
  rankingStabilityV2(
    hand.measurements,
    seedCatalogue,
    prefs,
    hand.hand,
    priors,
    options,
  );

describe("4. ranking stability under Sigma_input", () => {
  it("defaults to M = 200 and a fixed seed", () => {
    expect(STABILITY_SAMPLES).toBe(200);
    const s = stab();
    expect(s.samples).toBe(200);
    expect(s.seed).toBe(STABILITY_SEED);
  });

  it("is deterministic for a seed and changes with another", () => {
    const a = stab({ samples: 50 });
    const b = stab({ samples: 50 });
    const c = stab({ samples: 50, seed: 1 });
    expect(b).toEqual(a);
    expect(c.perMouse.map((m) => m.top5Prob)).not.toEqual(
      a.perMouse.map((m) => m.top5Prob),
    );
  });

  it("top-1 probabilities sum to 1 and top-5 probabilities to 5", () => {
    const s = stab({ params: { sigmaInput: SIGMA_INPUT_B_NO_EXIF } });
    const sum = (f: (m: (typeof s.perMouse)[number]) => number) =>
      s.perMouse.reduce((acc, m) => acc + f(m), 0);
    expect(sum((m) => m.top1Prob)).toBeCloseTo(1, 12);
    expect(sum((m) => m.top5Prob)).toBeCloseTo(5, 12);
    for (const m of s.perMouse) {
      expect(m.top1Prob).toBeLessThanOrEqual(m.top5Prob);
      expect(m.totalP10).toBeLessThanOrEqual(m.totalP50);
      expect(m.totalP50).toBeLessThanOrEqual(m.totalP90);
    }
  });

  it("covers exactly the ranked mice, in baseline order", () => {
    const s = stab({ samples: 10 });
    const base = scoreFitV2(
      hand.measurements,
      seedCatalogue,
      prefs,
      hand.hand,
      priors,
    );
    expect(s.perMouse.map((m) => m.slug)).toEqual(
      base.results.map((e) => e.mouse.slug),
    );
    expect(s.perMouse.map((m) => m.baselineRank)).toEqual(
      base.results.map((e) => e.rank),
    );
  });

  it("with no input uncertainty every draw is the point estimate", () => {
    const s = stab({
      samples: 20,
      params: {
        sigmaInput: [
          [0, 0],
          [0, 0],
        ],
      },
    });
    expect(s.perMouse[0].top1Prob).toBe(1);
    for (const m of s.perMouse) {
      expect(m.totalP10).toBeCloseTo(m.totalP90, 12);
      expect([0, 1]).toContain(m.top5Prob);
    }
  });

  it("more input uncertainty spreads the totals and leaves more mice with an uncertain top-5 place", () => {
    const tight = stab();
    const loose = stab({ params: { sigmaInput: SIGMA_INPUT_B_NO_EXIF } });
    const spread = (s: typeof tight) =>
      s.perMouse.reduce((acc, m) => acc + (m.totalP90 - m.totalP10), 0);
    const uncertain = (s: typeof tight) =>
      s.perMouse.filter((m) => m.top5Prob > 0 && m.top5Prob < 1).length;
    expect(spread(loose)).toBeGreaterThan(spread(tight));
    expect(uncertain(loose)).toBeGreaterThanOrEqual(uncertain(tight));
  });

  it("rejects a bad sample count", () => {
    expect(() => stab({ samples: 0 })).toThrow();
    expect(() => stab({ samples: 1.5 })).toThrow();
  });
});

describe("percentile", () => {
  it("interpolates linearly", () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
    expect(percentile([0, 10], 0.1)).toBeCloseTo(1, 12);
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe("rank comparison helpers", () => {
  it("kendallTau is 1 for the same order, -1 reversed, and ignores missing ids", () => {
    expect(kendallTau(["a", "b", "c", "d"], ["a", "b", "c", "d"])).toBe(1);
    expect(kendallTau(["a", "b", "c", "d"], ["d", "c", "b", "a"])).toBe(-1);
    // One swap out of six pairs: (5 - 1) / 6.
    expect(kendallTau(["a", "b", "c", "d"], ["b", "a", "c", "d"])).toBeCloseTo(
      4 / 6,
      12,
    );
    expect(kendallTau(["a", "b", "x"], ["a", "y", "b"])).toBe(1);
    expect(kendallTau(["a"], ["a"])).toBeNaN();
  });

  it("topKOverlap counts shared ids in the first k", () => {
    expect(topKOverlap(["a", "b", "c"], ["c", "b", "z"], 2)).toBe(1);
    expect(topKOverlap(["a", "b", "c"], ["c", "b", "a"], 3)).toBe(3);
  });
});
