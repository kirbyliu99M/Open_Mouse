/**
 * The WebGL stage's guard against a phone that can not keep up (Home v3, the
 * WebGL stage). It only ever draws fewer particles, never more (until the
 * budget itself changes): the budget is the ceiling, and the guard steps down
 * from it when the frames come slowly.
 *
 * What it watches is the time between two consecutive animation frames of the
 * stage, not between two draws. A draw only happens when the picture changes,
 * so with sparse input (a mouse wheel clicking every 30 ms) or a reader who
 * scrolls, stops and scrolls again, the time between draws says nothing about
 * the screen. The stage therefore keeps its animation-frame loop running for a
 * short tail after the last scroll event: during a scroll every frame has a
 * callback, and the gap between two callbacks is the screen's own frame time,
 * however sparse the input. When the loop stops, the guard is told
 * (`breakChain`) and the first frame of the next scroll has no gap: the time
 * the reader stood still is never a slow frame. A long gap inside a running
 * loop is a real hitch and counts, as one slow frame (a single stall is one of
 * the eight it takes, so it can not step down alone).
 *
 * The screen's own refresh interval is estimated as the median of the first
 * `REFRESH_SAMPLES` gaps (the shimmer runs every frame, so those are the
 * screen's frames), and never as more than `MAX_REFRESH_MS`: a device that is
 * slow from the very first frame would otherwise take its own slow frames for
 * the screen's pace, and no frame would ever be slower than 1.7 times that. A
 * screen that really runs at 30 Hz (a phone in low-power mode) is therefore
 * stepped down too, which is acceptable.
 *
 * When at least `SLOW_COUNT` of the window's last `WINDOW` gaps are more than
 * `SLOW_RATIO` times the interval (8 of 60, about 13 % of the frames), the draw
 * count drops by `STEP`, down to `FLOOR` of the budget. After a step the window
 * starts empty and has to fill again, all 60 gaps, before the next step is
 * allowed: a cooldown, so one slow spell is answered once, and the new count is
 * judged on its own frames.
 *
 * The rule counts misses rather than reading a percentile on purpose. On a
 * 165 Hz screen a frame is 6.1 ms and one missed vsync is 12.2 ms, over the
 * 1.7 line; a device that is not struggling misses one now and then (a layout
 * pass, a garbage collection), and must not lose particles for it. A rule that
 * stepped down at 3 misses in 45 (6.7 %) did, so the bar is 8 in 60.
 *
 * The first few frames of a run are not judged either. After the loop has
 * stopped and the reader scrolls again, the first frames are slow for reasons
 * that have nothing to do with the device's steady speed: the page wakes from
 * idle (the browser's frame pipeline ramps up again, the first draw is cold).
 * Measured with the CPU throttled to 4 and 6 times (production build, scroll
 * bursts of 5 frames with 320 ms of rest between), the gap after the first,
 * second, third and fourth frame of a run was slow 35 to 90 % of the time, the
 * fifth 10 to 15 %, the sixth never; with no throttling none was. Counted, that
 * is four slow gaps in every burst, and a reader who scrolls in short bursts
 * would be stepped down for it. So `breakChain` starts a `RESTART_GRACE` of
 * gaps that are seen (they set the clock for the next) but not counted: a
 * device that is slow all the time is still slow in every gap after them.
 *
 * The window also starts empty once the interval is known: the first frames
 * after the layout switches on (the first one measures the page, the first
 * draw warms the GPU up) are slow on a phone, and they must not count either
 * (seen at 4x CPU throttle, where the screen had no trouble at all).
 *
 * All of the numbers are Claude's candidates (未拍板) until they are measured
 * on a real 60 Hz phone. Pure: no DOM, no clock.
 */
export const DEGRADE = {
  /** The screen is taken to run at 60 Hz at the least: the refresh interval estimate is never more than this (ms). */
  MAX_REFRESH_MS: 16.7,
  /** How many of the latest gaps the slow ones are counted in. */
  WINDOW: 60,
  /** How many of the first gaps give the screen's refresh interval. */
  REFRESH_SAMPLES: 40,
  /** A gap is slow when it is more than this many times the refresh interval. */
  SLOW_RATIO: 1.7,
  /** This many slow gaps in the window (of `WINDOW`) are enough to step down. */
  SLOW_COUNT: 8,
  /** A step takes this share off the draw count. */
  STEP: 0.25,
  /** The draw count never goes below this share of the budget. */
  FLOOR: 0.25,
  /** After the loop has stopped and started again, this many gaps are not counted (the restart transient, see above). */
  RESTART_GRACE: 5,
} as const;

/** How long the stage's animation-frame loop keeps running after the last scroll event (ms), so every frame of a scroll is observed. Not an idle loop: it ends by itself. */
export const SCROLL_TAIL_MS = 200;

/** Whether a gap between two frames (ms) is a time: more than nothing, and finite. */
export function isGap(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0;
}

/** The median of a list (the mean of the two middle values when it has an even length). NaN for an empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The screen's refresh interval (ms) from the first gaps between frames: the
 * median of the first `REFRESH_SAMPLES`, once there are that many (null
 * before), and at most `MAX_REFRESH_MS`.
 */
export function estimateRefreshMs(firstGaps: readonly number[]): number | null {
  if (firstGaps.length < DEGRADE.REFRESH_SAMPLES) return null;
  return Math.min(
    median(firstGaps.slice(0, DEGRADE.REFRESH_SAMPLES)),
    DEGRADE.MAX_REFRESH_MS,
  );
}

/** The fewest particles the guard ever draws for a budget. */
export function minDrawCount(budget: number): number {
  return Math.max(1, Math.ceil(budget * DEGRADE.FLOOR));
}

export interface DegradeInput {
  /** How many particles are drawn now. */
  readonly current: number;
  /** The budget: the most that was ever drawn. */
  readonly budget: number;
  /** The latest gaps between frames (ms); only the last `WINDOW` are read. */
  readonly gaps: readonly number[];
  /** The screen's refresh interval (ms), or null while it is not known yet. */
  readonly refreshMs: number | null;
}

/** How many of `gaps` are slow: more than `SLOW_RATIO` times the refresh interval. */
export function slowGaps(gaps: readonly number[], refreshMs: number): number {
  const limit = DEGRADE.SLOW_RATIO * refreshMs;
  let slow = 0;
  for (const gap of gaps) if (gap > limit) slow += 1;
  return slow;
}

/**
 * How many particles to draw next. The same as `current` until the window is
 * full (60 gaps) and 8 or more of them are slow; then 25 % fewer, never below
 * a quarter of the budget, and never more than `current` (it only steps down).
 */
export function nextDrawCount({
  current,
  budget,
  gaps,
  refreshMs,
}: DegradeInput): number {
  const floor = minDrawCount(budget);
  if (current <= floor) return Math.min(current, budget);
  if (refreshMs === null || !(refreshMs > 0)) return current;
  if (gaps.length < DEGRADE.WINDOW) return current;
  if (slowGaps(gaps.slice(-DEGRADE.WINDOW), refreshMs) < DEGRADE.SLOW_COUNT) {
    return current;
  }
  return Math.max(floor, Math.round(current * (1 - DEGRADE.STEP)));
}

/** What the guard remembers between frames. Plain data: `observeFrame` returns the next one. */
export interface GuardState {
  /** When the last frame was observed (ms), or 0 before the first and after the loop has stopped. */
  readonly lastAt: number;
  /** The latest gaps, once the screen's interval is known (the window the slow ones are counted in). */
  readonly gaps: readonly number[];
  /** The first gaps, until there are enough to estimate the screen's interval from. */
  readonly firstGaps: readonly number[];
  readonly refreshMs: number | null;
  /** How many particles are drawn now. */
  readonly drawCount: number;
  /** How many of the next gaps are not counted: the restart transient after the loop has stopped. */
  readonly grace: number;
}

/** The guard at the start of a layout whose budget is `budget`, drawing all of them. */
export function newGuard(budget: number): GuardState {
  return {
    lastAt: 0,
    gaps: [],
    firstGaps: [],
    refreshMs: null,
    drawCount: budget,
    grace: 0,
  };
}

/**
 * The guard for a new budget (the layout crossed a breakpoint): everything is
 * drawn again, and what is known about the screen is kept.
 */
export function guardForBudget(state: GuardState, budget: number): GuardState {
  return { ...state, lastAt: 0, gaps: [], drawCount: budget };
}

/**
 * The stage's frame loop has stopped (the scroll ended, the tab was hidden, the
 * stage went off screen): the next frame has no gap to the last one, and the
 * first `RESTART_GRACE` gaps after it are not counted.
 */
export function breakChain(state: GuardState): GuardState {
  return { ...state, lastAt: 0, grace: DEGRADE.RESTART_GRACE };
}

/**
 * A frame of the loop ran at `now` (ms, the animation frame's timestamp).
 * Returns the guard after it: the gap since the last frame of the same run of
 * frames is kept (but not the first few after a restart), the screen's interval
 * is estimated from the first 40, and
 * once the window is full and slow the draw count steps down (and the window
 * starts again).
 */
export function observeFrame(
  state: GuardState,
  now: number,
  budget: number,
): GuardState {
  const gap = now - state.lastAt;
  if (!(state.lastAt > 0) || !isGap(gap)) return { ...state, lastAt: now };
  // The restart transient: seen, so the next gap is measured from this frame,
  // but in neither the window nor the screen's interval.
  if (state.grace > 0) {
    return { ...state, lastAt: now, grace: state.grace - 1 };
  }

  if (state.refreshMs === null) {
    const firstGaps = [...state.firstGaps, gap];
    const refreshMs = estimateRefreshMs(firstGaps);
    // Known now: the window starts empty, so the warm-up frames above are not in it.
    return { ...state, lastAt: now, firstGaps, refreshMs, gaps: [] };
  }

  const gaps = [...state.gaps, gap].slice(-DEGRADE.WINDOW);
  const next = nextDrawCount({
    current: state.drawCount,
    budget,
    gaps,
    refreshMs: state.refreshMs,
  });
  return {
    ...state,
    lastAt: now,
    gaps: next === state.drawCount ? gaps : [],
    drawCount: next,
  };
}
