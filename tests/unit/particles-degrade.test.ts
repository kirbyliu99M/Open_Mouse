import { describe, expect, it } from "vitest";
import {
  DEGRADE,
  estimateRefreshMs,
  guardForBudget,
  isFrameGap,
  median,
  minDrawCount,
  newGuard,
  nextDrawCount,
  observeFrame,
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

describe("the guard frame by frame", () => {
  const budget = 12000;
  /** Feed a guard frames whose gaps are `gaps`, starting at time 1000. */
  const feed = (gaps: number[], from = newGuard(budget), startAt = 1000) => {
    let state = observeFrame(from, startAt, budget);
    let at = startAt;
    for (const gap of gaps) {
      at += gap;
      state = observeFrame(state, at, budget);
    }
    return { state, at };
  };

  it("starts drawing everything, knowing nothing about the screen", () => {
    const g = newGuard(budget);
    expect(g).toMatchObject({
      lastAt: 0,
      refreshMs: null,
      drawCount: budget,
    });
    expect(g.gaps).toEqual([]);
    expect(g.firstGaps).toEqual([]);
  });

  it("learns the refresh interval from the first 40 gaps, and not before", () => {
    expect(feed(flat(39, 6.1)).state.refreshMs).toBeNull();
    const { state } = feed(flat(40, 6.1));
    expect(state.refreshMs).toBeCloseTo(6.1, 9);
    expect(state.drawCount).toBe(budget);
  });

  it("is not moved by steady frames, however many", () => {
    const { state } = feed(flat(40 + 400, 6.1));
    expect(state.drawCount).toBe(budget);
  });

  it("is not moved by a few slow frames among the first ones: the warm-up is not in the window", () => {
    // Three hiccups in the first 40 (the first frame measures the page, the
    // first draw warms the GPU up), then steady. Three slow frames in a window
    // of 45 would take a quarter off; these are not in it.
    const warmUp = [24.2, 12.1, 18.3, ...flat(37, 6.1)];
    const { state } = feed([...warmUp, ...flat(200, 6.1)]);
    expect(state.refreshMs).toBeCloseTo(6.1, 9);
    expect(state.drawCount).toBe(budget);
  });

  it("is moved by the same three slow frames once the window is open: 3 in 45 is slow", () => {
    const { state: known } = feed(flat(40, 6.1));
    const { state } = feed([...flat(42, 6.1), 18, 18, 18], known, 5000);
    expect(state.drawCount).toBe(9000);
  });

  it("steps down a quarter at a time for frames that stay slow, and starts a new window after each step", () => {
    const { state: known } = feed(flat(40, 6.1));
    let at = 10000;
    let state = known;
    const counts: number[] = [];
    for (let i = 0; i < 4 * 45 + 1; i += 1) {
      at += 12.2;
      state = observeFrame(state, at, budget);
      if (counts.at(-1) !== state.drawCount) counts.push(state.drawCount);
    }
    expect(counts).toEqual([12000, 9000, 6750, 5063, 3797]);
    // The window was cleared at each step, so a step needs 45 fresh slow frames.
    expect(state.gaps.length).toBeLessThan(45);
  });

  it("does not count a pause: a gap over 50 ms only moves the clock", () => {
    const { state: known } = feed(flat(40, 6.1));
    const before = known.gaps.length;
    const paused = observeFrame(known, known.lastAt + 900, budget);
    expect(paused.gaps).toHaveLength(before);
    expect(paused.lastAt).toBe(known.lastAt + 900);
    expect(paused.drawCount).toBe(budget);
    // Many pauses never lower the count.
    const { state } = feed(flat(300, 400), known, 20000);
    expect(state.drawCount).toBe(budget);
  });

  it("never goes back up, and never under a quarter of the budget", () => {
    const { state: known } = feed(flat(40, 6.1));
    const { state: low, at } = feed(flat(45 * 20, 12.2), known, 10000);
    expect(low.drawCount).toBe(minDrawCount(budget));
    const { state: later } = feed(flat(500, 6.1), low, at + 6.1);
    expect(later.drawCount).toBe(minDrawCount(budget));
  });

  it("keeps what it knows about the screen when the budget changes, and draws everything again", () => {
    const { state: known } = feed(flat(40 + 45 + 3, 6.1));
    const next = guardForBudget({ ...known, drawCount: 5000 }, 6000);
    expect(next.refreshMs).toBe(known.refreshMs);
    expect(next.drawCount).toBe(6000);
    expect(next.gaps).toEqual([]);
    expect(next.lastAt).toBe(0);
  });

  it("does not change the state it is given", () => {
    const { state: known } = feed(flat(40, 6.1));
    const copy = JSON.stringify(known);
    observeFrame(known, known.lastAt + 6.1, budget);
    expect(JSON.stringify(known)).toBe(copy);
  });
});
