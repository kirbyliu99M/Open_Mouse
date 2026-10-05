import { describe, expect, it } from "vitest";
import {
  DEGRADE,
  estimateRefreshMs,
  isFrameGap,
  median,
  minDrawCount,
  nextDrawCount,
  percentile,
} from "@/lib/particles/degrade";

/** `n` gaps of `ms` each. */
const flat = (n: number, ms: number) => Array.from({ length: n }, () => ms);

describe("which gaps between draws count", () => {
  it("drops a pause: a gap over 50 ms is the reader stopping and starting again, not a slow frame", () => {
    expect(DEGRADE.MAX_GAP_MS).toBe(50);
    expect(isFrameGap(6.1)).toBe(true);
    expect(isFrameGap(50)).toBe(true);
    expect(isFrameGap(50.01)).toBe(false);
    expect(isFrameGap(900)).toBe(false);
  });

  it("drops what is not a time", () => {
    expect(isFrameGap(0)).toBe(false);
    expect(isFrameGap(-3)).toBe(false);
    expect(isFrameGap(Number.NaN)).toBe(false);
    expect(isFrameGap(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("median and percentile", () => {
  it("takes the middle of a list, and the mean of the two middle values of an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it("takes the nearest-rank percentile", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 0.95)).toBe(95);
    expect(percentile(hundred, 0.5)).toBe(50);
    expect(percentile(hundred, 1)).toBe(100);
    expect(percentile(hundred, 0)).toBe(1);
    expect(percentile([5, 1, 9], 0.95)).toBe(9);
    expect(Number.isNaN(percentile([], 0.95))).toBe(true);
  });

  it("does not change the list it is given", () => {
    const list = [3, 1, 2];
    median(list);
    percentile(list, 0.95);
    expect(list).toEqual([3, 1, 2]);
  });
});

describe("the screen's refresh interval", () => {
  it("is the median of the first 40 gaps, and unknown before there are 40", () => {
    expect(DEGRADE.REFRESH_SAMPLES).toBe(40);
    expect(estimateRefreshMs(flat(39, 16.7))).toBeNull();
    expect(estimateRefreshMs(flat(40, 16.7))).toBeCloseTo(16.7, 9);
  });

  it("ignores everything after the first 40, and shrugs off a few slow frames among them", () => {
    const first = [...flat(37, 6.1), 30, 30, 30];
    expect(estimateRefreshMs([...first, ...flat(100, 50)])).toBeCloseTo(6.1, 9);
  });
});

describe("how many particles to draw next", () => {
  const budget = 12000;
  const refresh = 6.1;
  const slow = flat(45, 12.2); // twice the interval: every frame missed one
  const fine = flat(45, 6.1);
  const draw = (over: Partial<Parameters<typeof nextDrawCount>[0]> = {}) =>
    nextDrawCount({
      current: budget,
      budget,
      gaps: fine,
      refreshMs: refresh,
      ...over,
    });

  it("keeps the count while the frames keep up", () => {
    expect(draw()).toBe(budget);
    expect(draw({ gaps: flat(45, 6.5) })).toBe(budget);
    // Up to 1.7 times the interval is not slow.
    expect(draw({ gaps: flat(45, 6.1 * 1.7) })).toBe(budget);
  });

  it("takes 25 % off when the 95th percentile of the last 45 gaps is over 1.7 times the interval", () => {
    expect(DEGRADE.WINDOW).toBe(45);
    expect(DEGRADE.SLOW_RATIO).toBe(1.7);
    expect(draw({ gaps: slow })).toBe(9000);
    expect(draw({ gaps: flat(45, 6.1 * 1.7 + 0.1) })).toBe(9000);
  });

  it("looks at the 95th percentile, not the worst frame: two slow frames in 45 are not enough, three are", () => {
    const two = [...flat(43, 6.1), 40, 40];
    const three = [...flat(42, 6.1), 40, 40, 40];
    expect(draw({ gaps: two })).toBe(budget);
    expect(draw({ gaps: three })).toBe(9000);
  });

  it("only reads the last 45 gaps", () => {
    expect(draw({ gaps: [...flat(100, 40), ...fine] })).toBe(budget);
    expect(draw({ gaps: [...fine, ...flat(45, 40)] })).toBe(9000);
  });

  it("waits for a full window and a known interval", () => {
    expect(draw({ gaps: flat(44, 40) })).toBe(budget);
    expect(draw({ gaps: [] })).toBe(budget);
    expect(draw({ gaps: slow, refreshMs: null })).toBe(budget);
    expect(draw({ gaps: slow, refreshMs: 0 })).toBe(budget);
    expect(draw({ gaps: slow, refreshMs: Number.NaN })).toBe(budget);
  });

  it("steps down by a quarter of what it is drawing now, 12,000 to 9,000 to 6,750 to 5,063", () => {
    let count = budget;
    const steps: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      count = draw({ current: count, gaps: slow });
      steps.push(count);
    }
    expect(steps).toEqual([9000, 6750, 5063]);
  });

  it("never goes below a quarter of the budget", () => {
    expect(DEGRADE.FLOOR).toBe(0.25);
    expect(minDrawCount(budget)).toBe(3000);
    let count = budget;
    for (let i = 0; i < 20; i += 1) {
      count = draw({ current: count, gaps: slow });
    }
    expect(count).toBe(3000);
    expect(draw({ current: 3000, gaps: slow })).toBe(3000);
    // A step that would cross the floor lands on it.
    expect(draw({ current: 3500, gaps: slow })).toBe(3000);
    expect(minDrawCount(10)).toBe(3);
    expect(minDrawCount(1)).toBe(1);
  });

  it("only ever steps down: fast frames after slow ones do not bring particles back, and a count above the budget is not raised", () => {
    const lowered = draw({ gaps: slow });
    expect(lowered).toBeLessThan(budget);
    expect(draw({ current: lowered, gaps: flat(45, 6.1) })).toBe(lowered);
    expect(draw({ current: lowered, gaps: flat(45, 1) })).toBe(lowered);
    for (const gaps of [fine, slow, [], flat(45, 1000)]) {
      expect(draw({ current: 7000, gaps })).toBeLessThanOrEqual(7000);
    }
  });

  it("is a pure function: the same input gives the same answer, and the input is not changed", () => {
    const gaps = [...slow];
    expect(draw({ gaps })).toBe(draw({ gaps }));
    expect(gaps).toEqual(slow);
  });
});
