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
  slowGaps,
} from "@/lib/particles/degrade";

/** `n` gaps of `ms` each. */
const flat = (n: number, ms: number) => Array.from({ length: n }, () => ms);

/** `n` gaps of `ms`, with `slowMs` in place of every gap whose index `isSlow` says so. */
const pattern = (
  n: number,
  ms: number,
  slowMs: number,
  isSlow: (i: number) => boolean,
) => Array.from({ length: n }, (_, i) => (isSlow(i) ? slowMs : ms));

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

describe("median", () => {
  it("takes the middle of a list, and the mean of the two middle values of an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it("does not change the list it is given", () => {
    const list = [3, 1, 2];
    median(list);
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

describe("the rule's numbers", () => {
  it("is 8 slow gaps in the last 60, a gap being slow over 1.7 times the interval; a step is 25 %, to at least a quarter", () => {
    expect(DEGRADE.WINDOW).toBe(60);
    expect(DEGRADE.SLOW_COUNT).toBe(8);
    expect(DEGRADE.SLOW_RATIO).toBe(1.7);
    expect(DEGRADE.STEP).toBe(0.25);
    expect(DEGRADE.FLOOR).toBe(0.25);
    // 8 of 60 is about 13 % of the frames.
    expect(DEGRADE.SLOW_COUNT / DEGRADE.WINDOW).toBeCloseTo(0.133, 3);
  });

  it("counts the gaps over 1.7 times the interval, and not those at it", () => {
    expect(slowGaps([6.1, 6.1, 12.2, 12.2, 10.37, 10.38], 6.1)).toBe(3);
    expect(slowGaps([], 6.1)).toBe(0);
    expect(slowGaps(flat(10, 6.1 * 1.7), 6.1)).toBe(0);
  });
});

describe("how many particles to draw next", () => {
  const budget = 12000;
  const refresh = 6.1;
  const missed = 12.2; // one vsync missed on a 165 Hz screen
  const fine = flat(60, 6.1);
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
    expect(draw({ gaps: flat(60, 6.5) })).toBe(budget);
    // Up to 1.7 times the interval is not slow, even if every frame is.
    expect(draw({ gaps: flat(60, 6.1 * 1.7) })).toBe(budget);
  });

  it("is not moved by an occasional miss: 1, 2 or up to 7 slow frames in 60", () => {
    for (const misses of [1, 2, 3, 5, 7]) {
      const gaps = pattern(60, 6.1, missed, (i) => i < misses);
      expect(draw({ gaps }), `${misses} misses`).toBe(budget);
    }
  });

  it("is moved by 8 slow frames in 60, wherever they fall, and takes a quarter off", () => {
    expect(draw({ gaps: pattern(60, 6.1, missed, (i) => i < 8) })).toBe(9000);
    expect(draw({ gaps: pattern(60, 6.1, missed, (i) => i >= 52) })).toBe(9000);
    expect(draw({ gaps: pattern(60, 6.1, missed, (i) => i % 7 === 0) })).toBe(
      9000,
    );
  });

  it("is moved by frames that are slow for good: every one, or 40 % of them", () => {
    expect(draw({ gaps: flat(60, missed) })).toBe(9000);
    // 2 of every 5 frames missed.
    expect(draw({ gaps: pattern(60, 6.1, missed, (i) => i % 5 < 2) })).toBe(
      9000,
    );
  });

  it("is not moved by one slow spell that is gone: only the last 60 gaps are read", () => {
    expect(draw({ gaps: [...flat(100, missed), ...fine] })).toBe(budget);
    expect(draw({ gaps: [...fine, ...flat(60, missed)] })).toBe(9000);
  });

  it("waits for a full window of 60 and a known interval", () => {
    expect(draw({ gaps: flat(59, missed) })).toBe(budget);
    expect(draw({ gaps: [] })).toBe(budget);
    expect(draw({ gaps: flat(60, missed), refreshMs: null })).toBe(budget);
    expect(draw({ gaps: flat(60, missed), refreshMs: 0 })).toBe(budget);
    expect(draw({ gaps: flat(60, missed), refreshMs: Number.NaN })).toBe(
      budget,
    );
  });

  it("steps down by a quarter of what it is drawing now, 12,000 to 9,000 to 6,750 to 5,063", () => {
    let count = budget;
    const steps: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      count = draw({ current: count, gaps: flat(60, missed) });
      steps.push(count);
    }
    expect(steps).toEqual([9000, 6750, 5063]);
  });

  it("never goes below a quarter of the budget", () => {
    expect(minDrawCount(budget)).toBe(3000);
    let count = budget;
    for (let i = 0; i < 20; i += 1) {
      count = draw({ current: count, gaps: flat(60, missed) });
    }
    expect(count).toBe(3000);
    expect(draw({ current: 3000, gaps: flat(60, missed) })).toBe(3000);
    // A step that would cross the floor lands on it.
    expect(draw({ current: 3500, gaps: flat(60, missed) })).toBe(3000);
    expect(minDrawCount(10)).toBe(3);
    expect(minDrawCount(1)).toBe(1);
  });

  it("only ever steps down: fast frames after slow ones do not bring particles back, and a count above the budget is not raised", () => {
    const lowered = draw({ gaps: flat(60, missed) });
    expect(lowered).toBeLessThan(budget);
    expect(draw({ current: lowered, gaps: flat(60, 6.1) })).toBe(lowered);
    expect(draw({ current: lowered, gaps: flat(60, 1) })).toBe(lowered);
    for (const gaps of [fine, flat(60, missed), [], flat(60, 1000)]) {
      expect(draw({ current: 7000, gaps })).toBeLessThanOrEqual(7000);
    }
  });

  it("is a pure function: the same input gives the same answer, and the input is not changed", () => {
    const gaps = flat(60, missed);
    expect(draw({ gaps })).toBe(draw({ gaps }));
    expect(gaps).toEqual(flat(60, missed));
  });
});

describe("the guard frame by frame", () => {
  const budget = 12000;
  const refresh = 6.1;
  const missed = 12.2;
  /** Feed a guard frames whose gaps are `gaps`, starting at time `startAt`; returns the state after each. */
  const feed = (gaps: number[], from = newGuard(budget), startAt = 1000) => {
    let state = observeFrame(from, startAt, budget);
    let at = startAt;
    const states: ReturnType<typeof observeFrame>[] = [];
    for (const gap of gaps) {
      at += gap;
      state = observeFrame(state, at, budget);
      states.push(state);
    }
    return { state, at, states };
  };
  /** A guard that knows the screen (40 steady frames), with a window full of steady frames. */
  const settled = () => feed(flat(40 + 60, refresh));

  it("starts drawing everything, knowing nothing about the screen", () => {
    const g = newGuard(budget);
    expect(g).toMatchObject({ lastAt: 0, refreshMs: null, drawCount: budget });
    expect(g.gaps).toEqual([]);
    expect(g.firstGaps).toEqual([]);
  });

  it("learns the refresh interval from the first 40 gaps, and not before", () => {
    expect(feed(flat(39, refresh)).state.refreshMs).toBeNull();
    const { state } = feed(flat(40, refresh));
    expect(state.refreshMs).toBeCloseTo(refresh, 9);
    expect(state.drawCount).toBe(budget);
  });

  it("is not moved by steady frames, however many", () => {
    expect(feed(flat(40 + 600, refresh)).state.drawCount).toBe(budget);
  });

  it("is not moved by a few slow frames among the first ones: the warm-up is not in the window", () => {
    // Three hiccups in the first 40 (the first frame measures the page, the
    // first draw warms the GPU up), then steady.
    const warmUp = [24.2, 12.1, 18.3, ...flat(37, refresh)];
    const { state } = feed([...warmUp, ...flat(300, refresh)]);
    expect(state.refreshMs).toBeCloseTo(refresh, 9);
    expect(state.drawCount).toBe(budget);
  });

  it("is not moved by an occasional miss, which a 165 Hz screen has now and then: 1 frame in 15 or in 9, over 600 frames", () => {
    const { state: known } = settled();
    for (const every of [15, 9]) {
      // 4 and 6 or 7 misses in any 60 frames: under 8.
      const gaps = pattern(600, refresh, missed, (i) => i % every === 0);
      const { state } = feed(gaps, known, 5000);
      expect(state.drawCount, `1 in ${every}`).toBe(budget);
    }
  });

  it("is not moved by one or two misses, whenever they come", () => {
    const { state: known } = settled();
    for (const at of [0, 10, 59, 100]) {
      const gaps = pattern(
        200,
        refresh,
        missed,
        (i) => i === at || i === at + 1,
      );
      expect(feed(gaps, known, 5000).state.drawCount, `at ${at}`).toBe(budget);
    }
  });

  it("steps down when 8 frames in 60 are missed, here the 8th slow frame after a window of steady ones", () => {
    const { state: known } = settled();
    const { states } = feed(flat(30, missed), known, 5000);
    const counts = states.map((s) => s.drawCount);
    expect(counts.indexOf(9000)).toBe(7);
    expect(counts[6]).toBe(budget);
  });

  it("steps down for frames that stay slow for good: 40 % of them", () => {
    const { state: known } = settled();
    // 2 frames in every 5.
    const gaps = pattern(300, refresh, missed, (i) => i % 5 < 2);
    const { state } = feed(gaps, known, 5000);
    expect(state.drawCount).toBeLessThan(budget);
    expect(state.drawCount).toBeGreaterThanOrEqual(minDrawCount(budget));
  });

  it("cools down after a step: the window starts empty, and the next step needs 60 fresh gaps", () => {
    const { state: known } = settled();
    const { states } = feed(flat(200, missed), known, 5000);
    const counts = states.map((s) => s.drawCount);
    const first = counts.indexOf(9000);
    const second = counts.indexOf(6750);
    expect(first).toBe(7);
    // 60 gaps after the first step: the 60th fresh slow frame is the next one that can step.
    expect(second).toBe(first + DEGRADE.WINDOW);
    // Straight after the step the window is empty, then it fills one gap at a time.
    expect(states[first]!.gaps).toEqual([]);
    expect(states[first + 1]!.gaps).toHaveLength(1);
    // And in between, nothing moves, however slow the frames are.
    for (let i = first; i < second; i += 1) expect(counts[i]).toBe(9000);
  });

  it("answers an occasional miss after a step in the new window only: the old misses are gone", () => {
    const { state: known } = settled();
    const { state: stepped, at } = feed(flat(8, missed), known, 5000);
    expect(stepped.drawCount).toBe(9000);
    // 7 misses in the next 60 do not step again.
    const gaps = pattern(
      300,
      refresh,
      missed,
      (i) => i < 7 || (i >= 60 && i < 66),
    );
    expect(feed(gaps, stepped, at + refresh).state.drawCount).toBe(9000);
  });

  it("does not count a pause: a gap over 50 ms only moves the clock", () => {
    const { state: known } = settled();
    const before = known.gaps.length;
    const paused = observeFrame(known, known.lastAt + 900, budget);
    expect(paused.gaps).toHaveLength(before);
    expect(paused.lastAt).toBe(known.lastAt + 900);
    expect(paused.drawCount).toBe(budget);
    // Many pauses never lower the count.
    expect(feed(flat(300, 400), known, 20000).state.drawCount).toBe(budget);
  });

  it("never goes back up, and never under a quarter of the budget", () => {
    const { state: known } = settled();
    const { state: low, at } = feed(flat(60 * 20, missed), known, 10000);
    expect(low.drawCount).toBe(minDrawCount(budget));
    const { state: later } = feed(flat(500, refresh), low, at + refresh);
    expect(later.drawCount).toBe(minDrawCount(budget));
  });

  it("keeps what it knows about the screen when the budget changes, and draws everything again", () => {
    const { state: known } = settled();
    const next = guardForBudget({ ...known, drawCount: 5000 }, 6000);
    expect(next.refreshMs).toBe(known.refreshMs);
    expect(next.drawCount).toBe(6000);
    expect(next.gaps).toEqual([]);
    expect(next.lastAt).toBe(0);
  });

  it("does not change the state it is given", () => {
    const { state: known } = settled();
    const copy = JSON.stringify(known);
    observeFrame(known, known.lastAt + refresh, budget);
    expect(JSON.stringify(known)).toBe(copy);
  });
});
