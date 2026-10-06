import { describe, expect, it } from "vitest";
import {
  DEGRADE,
  SCROLL_TAIL_MS,
  armGuard,
  armOnScroll,
  breakChain,
  estimateRefreshMs,
  guardForBudget,
  isGap,
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

describe("which gaps count", () => {
  it("counts every gap between two frames of a run, a long one too: it is a real hitch, not the reader pausing (the loop ending is what tells the two apart)", () => {
    expect(isGap(6.1)).toBe(true);
    expect(isGap(50.01)).toBe(true);
    expect(isGap(900)).toBe(true);
  });

  it("drops what is not a time", () => {
    expect(isGap(0)).toBe(false);
    expect(isGap(-3)).toBe(false);
    expect(isGap(Number.NaN)).toBe(false);
    expect(isGap(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("keeps the frame loop running for 200 ms after the last scroll event, and no longer", () => {
    expect(SCROLL_TAIL_MS).toBe(200);
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
    expect(estimateRefreshMs(flat(40, 6.06))).toBeCloseTo(6.06, 9);
  });

  it("ignores everything after the first 40, and shrugs off a few slow frames among them", () => {
    const first = [...flat(37, 6.1), 30, 30, 30];
    expect(estimateRefreshMs([...first, ...flat(100, 50)])).toBeCloseTo(6.1, 9);
  });

  it("is never more than 16.7 ms: a device that is slow from its first frame does not make its own slow frames the screen's pace", () => {
    expect(DEGRADE.MAX_REFRESH_MS).toBe(16.7);
    for (const slow of [20, 33, 33.3, 45, 70, 400]) {
      expect(estimateRefreshMs(flat(40, slow)), `${slow} ms`).toBe(16.7);
    }
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
  /**
   * Feed a guard frames whose gaps are `gaps`, as a new run of frames starting
   * at time `startAt` (the guard is told the last run has stopped, so the time
   * since it is not a gap), after the restart transient and the first scroll:
   * every gap counts, the first too (the transient and the first scroll are
   * tested in their own describes below); returns the state after each.
   */
  const feed = (gaps: number[], from = newGuard(budget), startAt = 1000) => {
    let state = observeFrame(
      { ...breakChain(from), grace: 0, armed: true },
      startAt,
      budget,
    );
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

  it("counts a long gap inside a run as one slow frame: a single stall can not step down alone, and eight of them in 60 do", () => {
    const { state: known } = settled();
    // One 400 ms stall among steady frames: one of the eight it takes.
    const one = pattern(200, refresh, 400, (i) => i === 30);
    expect(feed(one, known, 5000).state.drawCount).toBe(budget);
    // Seven are not enough either; eight are.
    const seven = pattern(200, refresh, 400, (i) => i < 7);
    expect(feed(seven, known, 5000).state.drawCount).toBe(budget);
    const eight = pattern(200, refresh, 400, (i) => i < 8);
    expect(feed(eight, known, 5000).state.drawCount).toBe(9000);
  });

  it("does not count the time between two runs of frames: when the loop stops and starts again (the reader stood still), the first frame of the next run has no gap", () => {
    const { state: known } = settled();
    const before = known.gaps.length;
    const stopped = breakChain(known);
    expect(stopped.lastAt).toBe(0);
    expect(stopped.gaps).toHaveLength(before);
    expect(stopped.refreshMs).toBe(known.refreshMs);
    // The next frame, a second later, adds no gap.
    const restarted = observeFrame(stopped, known.lastAt + 1000, budget);
    expect(restarted.gaps).toHaveLength(before);
    expect(restarted.lastAt).toBe(known.lastAt + 1000);
    // Without the break the same second would be a slow frame.
    const unbroken = observeFrame(known, known.lastAt + 1000, budget);
    expect(unbroken.gaps.length).toBeGreaterThan(0);
    expect(unbroken.gaps.at(-1)).toBe(1000);
    // Stop and go for a long time, a handful of frames each: nothing is lost.
    let state = known;
    let at = known.lastAt;
    for (let burst = 0; burst < 100; burst += 1) {
      state = breakChain(state);
      at += 600; // the reader stood still
      for (let frame = 0; frame < 5; frame += 1) {
        at += refresh;
        state = observeFrame(state, at, budget);
      }
    }
    expect(state.drawCount).toBe(budget);
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

describe("the restart transient: the first frames after the loop has stopped and started again", () => {
  const budget = 12000;
  const refresh = 16.7;
  /** What a scroll restart looks like to the guard: a slow gap now and then at the start of a run (measured: the first four gaps of a run, 35 to 90 % of them slow at 4 to 6 times the CPU, the fifth 10 to 15 %). */
  const slow = 33.4;

  /** A guard that knows its screen, past the 40 gaps that tell it. */
  const known = () => {
    let state = observeFrame(
      { ...newGuard(budget), armed: true },
      1000,
      budget,
    );
    let at = 1000;
    for (let i = 0; i < DEGRADE.REFRESH_SAMPLES + DEGRADE.WINDOW; i += 1) {
      at += refresh;
      state = observeFrame(state, at, budget);
    }
    return { state, at };
  };

  /**
   * `bursts` runs of frames the way a reader who scrolls in short bursts makes
   * them: the loop stops (`breakChain`), the reader stands still for
   * `rest` ms, the next run's first frame has no gap, then `run` gaps follow
   * (the first `slowFirst` of them `slowMs`, the rest `refresh`). With `grace`
   * false the transient is not forgiven (the guard as it was before it).
   */
  const burstsOf = ({
    bursts,
    run,
    slowFirst,
    slowMs = slow,
    steadyMs = refresh,
    grace = true,
    from = known(),
  }: {
    bursts: number;
    run: number;
    slowFirst: number;
    slowMs?: number;
    steadyMs?: number;
    grace?: boolean;
    from?: ReturnType<typeof known>;
  }) => {
    let state = from.state;
    let at = from.at;
    let firstStep = -1;
    for (let burst = 0; burst < bursts; burst += 1) {
      state = breakChain(state);
      if (!grace) state = { ...state, grace: 0 };
      at += 600;
      state = observeFrame(state, at, budget);
      for (let i = 0; i < run; i += 1) {
        at += i < slowFirst ? slowMs : steadyMs;
        state = observeFrame(state, at, budget);
        if (firstStep < 0 && state.drawCount < budget) firstStep = burst;
      }
    }
    return { state, firstStep };
  };

  it("is a few gaps long: the five gaps after a restart, a candidate set from the measurement", () => {
    expect(DEGRADE.RESTART_GRACE).toBe(5);
  });

  it("is started by the loop stopping, and by nothing else", () => {
    const { state } = known();
    expect(state.grace).toBe(0);
    expect(breakChain(state).grace).toBe(DEGRADE.RESTART_GRACE);
    expect(newGuard(budget).grace).toBe(0);
    // A new budget keeps what the guard knows about the restart, and starts none.
    expect(guardForBudget(state, 6000).grace).toBe(0);
  });

  it("does not count the first gaps of a run: they are seen (the clock moves on) but not kept", () => {
    const { state: running, at } = known();
    let state = breakChain(running);
    const kept = running.gaps.length;
    state = observeFrame(state, at + 600, budget); // the run's first frame: no gap
    expect(state.grace).toBe(DEGRADE.RESTART_GRACE);
    let now = at + 600;
    for (let i = 1; i <= DEGRADE.RESTART_GRACE; i += 1) {
      now += 100; // however slow
      state = observeFrame(state, now, budget);
      expect(state.grace).toBe(DEGRADE.RESTART_GRACE - i);
      expect(state.gaps).toHaveLength(kept);
      expect(state.lastAt).toBe(now);
    }
    // The next gap is counted, from the frame before it.
    state = observeFrame(state, now + 100, budget);
    expect(state.gaps).toHaveLength(kept);
    expect(state.gaps.at(-1)).toBe(100);
    expect(state.drawCount).toBe(budget);
  });

  it("does not let the transient into the screen's interval either: a slow restart in the first 40 gaps does not move the estimate", () => {
    let state = observeFrame(newGuard(budget), 1000, budget);
    let at = 1000;
    const step = (ms: number) => {
      at += ms;
      state = observeFrame(state, at, budget);
    };
    for (let i = 0; i < 10; i += 1) step(8.33);
    state = breakChain(state);
    at += 400;
    state = observeFrame(state, at, budget);
    for (let i = 0; i < DEGRADE.RESTART_GRACE; i += 1) step(120);
    for (let i = 0; i < 30; i += 1) step(8.33);
    expect(state.firstGaps).toHaveLength(40);
    expect(state.refreshMs).toBeCloseTo(8.33, 9);
  });

  it("a reader who scrolls in bursts of 5 frames, the first 2 gaps of every burst 33 ms (a restart transient), is not stepped down, burst after burst", () => {
    const { state, firstStep } = burstsOf({
      bursts: 300,
      run: 5,
      slowFirst: 2,
    });
    expect(state.drawCount).toBe(budget);
    expect(firstStep).toBe(-1);
    // Without the grace the same reader loses particles: 2 slow gaps in every 5 is 40 %.
    const before = burstsOf({
      bursts: 300,
      run: 5,
      slowFirst: 2,
      grace: false,
    });
    expect(before.state.drawCount).toBeLessThan(budget);
  });

  it("the measured transient, 4 slow gaps at the start of every 17-frame burst (5 scroll frames and the loop's 200 ms tail), does not step down either, and 5 do not", () => {
    for (const slowFirst of [1, 2, 3, 4, 5]) {
      const { state } = burstsOf({ bursts: 300, run: 16, slowFirst });
      expect(state.drawCount, `${slowFirst} slow gaps`).toBe(budget);
    }
    // Without the grace, 4 or 5 slow gaps in 16 is over the 8 in 60.
    for (const slowFirst of [4, 5]) {
      const { state } = burstsOf({
        bursts: 300,
        run: 16,
        slowFirst,
        grace: false,
      });
      expect(state.drawCount, `${slowFirst} slow gaps, no grace`).toBeLessThan(
        budget,
      );
    }
  });

  it("a transient longer than the grace is counted past it: the slow gaps from the sixth on step down, so the grace is not a hole a slow device can hide in", () => {
    // 12 slow gaps at the start of a 16-gap burst: 7 are counted, a burst; two bursts are 14 in the window.
    const { state, firstStep } = burstsOf({
      bursts: 40,
      run: 16,
      slowFirst: 12,
    });
    expect(state.drawCount).toBeLessThan(budget);
    expect(firstStep).toBeGreaterThanOrEqual(0);
  });

  it("a device that is slow all the time still steps down, in bursts too: 33 ms, 70 ms and 30 Hz (33.3 ms) frames, 16 gaps to a burst, 5 of them forgiven", () => {
    for (const ms of [33, 70, 33.3]) {
      const { state } = burstsOf({
        bursts: 60,
        run: 16,
        slowFirst: 16,
        slowMs: ms,
      });
      expect(state.drawCount, `${ms} ms`).toBeLessThan(budget);
      expect(state.drawCount).toBeGreaterThanOrEqual(minDrawCount(budget));
    }
  });

  it("a steady 60 Hz and 165 Hz screen, scrolled in bursts, is not stepped down", () => {
    for (const ms of [16.67, 6.06]) {
      let state = observeFrame(
        { ...newGuard(budget), armed: true },
        1000,
        budget,
      );
      let at = 1000;
      for (let i = 0; i < DEGRADE.REFRESH_SAMPLES + 5; i += 1) {
        at += ms;
        state = observeFrame(state, at, budget);
      }
      const { state: end } = burstsOf({
        bursts: 300,
        run: 16,
        slowFirst: 0,
        steadyMs: ms,
        from: { state, at },
      });
      expect(end.drawCount, `${ms} ms`).toBe(budget);
    }
  });

  it("does not change what a long run does: after the grace every gap counts, so 8 slow in 60 steps down the same", () => {
    const { state: running, at } = known();
    let state = breakChain(running);
    let now = at + 600;
    state = observeFrame(state, now, budget);
    for (let i = 0; i < DEGRADE.RESTART_GRACE; i += 1) {
      now += refresh;
      state = observeFrame(state, now, budget);
    }
    let firstStep = -1;
    for (let i = 0; i < 30; i += 1) {
      now += 40;
      state = observeFrame(state, now, budget);
      if (firstStep < 0 && state.drawCount < budget) firstStep = i;
    }
    // Eight slow gaps, the eighth stepping down (index 7).
    expect(firstStep).toBe(7);
    expect(state.drawCount).toBeLessThan(budget);
  });
});

describe("before the first scroll: the page's own frames are not judged", () => {
  const budget = 12000;
  const refresh = 16.7;

  /** A guard fed `gaps` from the page's first frame, never scrolled. */
  const staticFrames = (gaps: number[]) => {
    let state = observeFrame(newGuard(budget), 1000, budget);
    let at = 1000;
    for (const gap of gaps) {
      at += gap;
      state = observeFrame(state, at, budget);
    }
    return { state, at };
  };

  it("starts unarmed, and arming is a restart that forgives the first gaps", () => {
    const g = newGuard(budget);
    expect(g.armed).toBe(false);
    const armed = armGuard(g);
    expect(armed.armed).toBe(true);
    expect(armed.grace).toBe(DEGRADE.RESTART_GRACE);
    expect(armed.lastAt).toBe(0);
    expect(armed.gaps).toEqual([]);
  });

  it("arming twice changes nothing: a guard that is running is not restarted by a second scroll", () => {
    const { state, at } = staticFrames(flat(100, refresh));
    const once = armGuard(state);
    let running = observeFrame(once, at + 600, budget);
    for (let i = 0; i < 10; i += 1) {
      running = observeFrame(running, at + 600 + (i + 1) * refresh, budget);
    }
    expect(armGuard(running)).toBe(running);
  });

  it("does not step down for slow frames before the first scroll, however many and however slow: 33 ms, 70 ms and 30 Hz frames from the first frame, 600 of them", () => {
    for (const ms of [33, 70, 33.3, 120]) {
      const { state } = staticFrames(flat(600, ms));
      expect(state.drawCount, `${ms} ms`).toBe(budget);
      expect(state.gaps, `${ms} ms`).toEqual([]);
    }
  });

  it("still learns the screen's interval from the static frames (the shimmer is the screen's own frames), capped at 16.7 ms", () => {
    expect(staticFrames(flat(40, 8.33)).state.refreshMs).toBeCloseTo(8.33, 9);
    expect(staticFrames(flat(40, 33)).state.refreshMs).toBe(16.7);
    expect(staticFrames(flat(39, 8.33)).state.refreshMs).toBeNull();
  });

  it("a machine that was busy while the page started is not stepped down by it: slow static frames, then the reader scrolls on a machine that has settled", () => {
    // A 33 ms frame every 6 during the shimmer (16 %: over the 8 in 60), then steady.
    const busy = pattern(300, refresh, 33.4, (i) => i % 6 === 0);
    const { state, at } = staticFrames(busy);
    expect(state.drawCount).toBe(budget);
    let scrolling = armGuard(state);
    let now = at + 900;
    scrolling = observeFrame(scrolling, now, budget);
    for (let i = 0; i < 600; i += 1) {
      now += refresh;
      scrolling = observeFrame(scrolling, now, budget);
    }
    expect(scrolling.drawCount).toBe(budget);
  });

  it("counts from the first scroll: a device that is slow all the time steps down once it is scrolled, after the grace and a full window (5 + 60 gaps)", () => {
    const { state, at } = staticFrames(flat(200, 33));
    let scrolling = armGuard(state);
    let now = at + 900;
    scrolling = observeFrame(scrolling, now, budget);
    let firstStep = -1;
    for (let i = 0; i < 300; i += 1) {
      now += 33;
      scrolling = observeFrame(scrolling, now, budget);
      if (firstStep < 0 && scrolling.drawCount < budget) firstStep = i + 1;
    }
    expect(firstStep).toBe(DEGRADE.RESTART_GRACE + DEGRADE.WINDOW);
    expect(scrolling.drawCount).toBeLessThan(budget);
  });

  it("the guard that was never armed and the same frames after arming differ only in whether they count (without the arming check, the 600 static frames above would step down)", () => {
    const { state } = staticFrames(flat(600, 33));
    // The same frames, armed from the start: the old behaviour.
    let armedFromStart = observeFrame(
      { ...newGuard(budget), armed: true },
      1000,
      budget,
    );
    let at = 1000;
    for (let i = 0; i < 600; i += 1) {
      at += 33;
      armedFromStart = observeFrame(armedFromStart, at, budget);
    }
    expect(state.drawCount).toBe(budget);
    expect(armedFromStart.drawCount).toBeLessThan(budget);
  });
});

describe("a scroll event arms the guard only when the page has moved off the top", () => {
  const budget = 12000;

  it("arms for a page that has scrolled (scrollY over 0), however little", () => {
    for (const y of [1, 0.5, 4, 600, 12345]) {
      const armed = armOnScroll(newGuard(budget), y);
      expect(armed.armed, `scrollY ${y}`).toBe(true);
      expect(armed.grace).toBe(DEGRADE.RESTART_GRACE);
    }
  });

  it("does nothing for a scroll event with the page at the top: scroll restoration, an overscroll bounce, an event sent by code", () => {
    const g = newGuard(budget);
    for (const y of [0, -0, -1, -40.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(armOnScroll(g, y), `scrollY ${y}`).toBe(g);
    }
  });

  it("is armGuard from then on: a guard that is armed already is not restarted", () => {
    const armed = armOnScroll(newGuard(budget), 10);
    expect(armOnScroll(armed, 20)).toBe(armed);
    expect(armOnScroll(armed, 0)).toBe(armed);
  });
});

describe("four devices, from the first frame to a long scroll", () => {
  const budget = 12000;
  /** A guard fed `gaps`, with the first frame at time 1000. */
  const live = (gaps: number[]) => {
    // A reader who has scrolled from the first frame: the guard is armed.
    let state = observeFrame(
      { ...newGuard(budget), armed: true },
      1000,
      budget,
    );
    let at = 1000;
    let firstStep = -1;
    gaps.forEach((gap, i) => {
      at += gap;
      state = observeFrame(state, at, budget);
      if (firstStep < 0 && state.drawCount < budget) firstStep = i + 1;
    });
    return { state, firstStep };
  };

  it("a steady 165 Hz screen (6.06 ms), 600 frames: nothing is taken", () => {
    const { state, firstStep } = live(flat(600, 6.06));
    expect(state.drawCount).toBe(budget);
    expect(firstStep).toBe(-1);
    expect(state.refreshMs).toBeCloseTo(6.06, 9);
  });

  it("a steady 144, 120 and 60 Hz screen: nothing is taken", () => {
    for (const ms of [6.94, 8.33, 16.67]) {
      expect(live(flat(600, ms)).state.drawCount, `${ms} ms`).toBe(budget);
    }
  });

  it("a 165 Hz screen that misses a vsync now and then (1 frame in 15, in 9): nothing is taken", () => {
    for (const every of [15, 9]) {
      const gaps = pattern(600, 6.06, 12.12, (i) => i % every === 0);
      expect(live(gaps).state.drawCount, `1 in ${every}`).toBe(budget);
    }
  });

  it("a device that runs at 33 ms from its first frame: the estimate is capped at 16.7, so its frames are slow, and it steps down (the first step once the window has filled: 40 + 60 frames in)", () => {
    const { state, firstStep } = live(flat(600, 33));
    expect(state.refreshMs).toBe(16.7);
    expect(firstStep).toBe(DEGRADE.REFRESH_SAMPLES + DEGRADE.WINDOW);
    expect(state.drawCount).toBeLessThan(budget);
    expect(state.drawCount).toBeGreaterThanOrEqual(minDrawCount(budget));
  });

  it("a device at 70 ms from its first frame (14 fps, gaps a rule that dropped the long ones never saw): it steps down too", () => {
    const { state, firstStep } = live(flat(600, 70));
    expect(firstStep).toBe(DEGRADE.REFRESH_SAMPLES + DEGRADE.WINDOW);
    expect(state.drawCount).toBeLessThan(budget);
  });

  it("a screen at 30 Hz (33.3 ms, a phone in low-power mode): it steps down, which is accepted", () => {
    const { state, firstStep } = live(flat(600, 33.3));
    expect(firstStep).toBe(DEGRADE.REFRESH_SAMPLES + DEGRADE.WINDOW);
    expect(state.drawCount).toBeLessThan(budget);
  });

  it("a device that starts well and then slows to 33 ms: it steps down (the first step at the 8th slow frame, the window being full)", () => {
    const { state, firstStep } = live([...flat(200, 16.7), ...flat(200, 33)]);
    expect(firstStep).toBe(200 + 8);
    expect(state.drawCount).toBeLessThan(budget);
  });

  it("sparse input does not change what the guard sees: the loop runs a frame at a time whether or not the picture changes (a wheel click every 30 ms is the same 16.7 ms frames), so nothing is taken", () => {
    // The guard is fed one gap per animation frame, not per draw: what the
    // input does between frames is not in it. Draws at every second frame
    // would have been 33 ms apart; the frames are 16.7 ms apart.
    const frames = flat(600, 16.7);
    expect(live(frames).state.drawCount).toBe(budget);
  });

  it("that is why it times frames and not draws: the same sparse scroll, timed between its draws (every second frame, 33.4 ms apart, what the first version of the guard saw), would take particles from a screen with nothing wrong", () => {
    const between = flat(300, 33.4);
    const { state, firstStep } = live(between);
    expect(state.drawCount).toBeLessThan(budget);
    expect(firstStep).toBeGreaterThan(0);
    // The 600 frames themselves are what the stage times now: nothing is taken.
    expect(live(flat(600, 16.7)).state.drawCount).toBe(budget);
  });
});
