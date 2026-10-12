import { describe, expect, it } from "vitest";
import { SUBSCORES } from "../../src/lib/contracts/fit";
import { weightBars } from "../../src/lib/learn/weight-bars";
import { BASE_WEIGHTS } from "../../src/server/fit/coefficients";

describe("weightBars", () => {
  it("makes the bar length the weight relative to the heaviest (docs/fit-algorithm.md section 4)", () => {
    const bars = weightBars(BASE_WEIGHTS);
    expect(bars.map((b) => b.key)).toEqual([
      "length",
      "gripWidth",
      "heightHump",
      "frontFlare",
      "thumb",
      "weight",
    ]);
    const ratios = bars.map((b) => b.ratio);
    expect(ratios[0]).toBe(1);
    expect(ratios[1]).toBeCloseTo(0.25 / 0.3, 10);
    expect(ratios[2]).toBeCloseTo(0.2 / 0.3, 10);
    expect(ratios[3]).toBeCloseTo(0.1 / 0.3, 10);
    expect(ratios[4]).toBeCloseTo(0.1 / 0.3, 10);
    expect(ratios[5]).toBeCloseTo(0.05 / 0.3, 10);
  });

  it("covers every sub-score once, longest first, with every ratio in (0, 1]", () => {
    const bars = weightBars(BASE_WEIGHTS);
    expect([...bars.map((b) => b.key)].sort()).toEqual([...SUBSCORES].sort());
    for (let i = 0; i < bars.length; i++) {
      expect(bars[i].ratio).toBeGreaterThan(0);
      expect(bars[i].ratio).toBeLessThanOrEqual(1);
      if (i > 0) expect(bars[i].ratio).toBeLessThanOrEqual(bars[i - 1].ratio);
    }
  });

  it("follows the weights it is given: reordering them reorders the bars, equal weights keep the contract order", () => {
    const bars = weightBars({
      length: 0.1,
      gripWidth: 0.1,
      heightHump: 0.4,
      frontFlare: 0.1,
      thumb: 0.2,
      weight: 0.1,
    });
    expect(bars.map((b) => b.key)).toEqual([
      "heightHump",
      "thumb",
      "length",
      "gripWidth",
      "frontFlare",
      "weight",
    ]);
    expect(bars[0].ratio).toBe(1);
    expect(bars[1].ratio).toBe(0.5);
  });

  it("refuses a missing, zero, negative or non-finite weight instead of drawing a wrong bar", () => {
    for (const bad of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => weightBars({ ...BASE_WEIGHTS, weight: bad })).toThrow();
    }
  });
});
