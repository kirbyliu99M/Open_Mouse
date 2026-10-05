/**
 * The WebGL stage's guard against a phone that can not keep up (Home v3, the
 * WebGL stage). It only ever draws fewer particles, never more: the budget is
 * the ceiling, and the guard steps down from it when the frames come slowly.
 *
 * What it watches is the time between two consecutive draws. A draw happens
 * when the reader scrolls (and during the one-time shimmer), so a long gap
 * usually means the reader stopped and started again, not that the GPU was
 * slow: gaps over `MAX_GAP_MS` are thrown away. Of the rest, the last
 * `WINDOW` are kept; the screen's own refresh interval is estimated as the
 * median of the first `REFRESH_SAMPLES` of them (the shimmer draws every
 * frame, so those are the screen's frames); and when the 95th percentile of
 * the window is more than `SLOW_RATIO` times that interval, the draw count
 * drops by `STEP`, down to `FLOOR` of the budget. The window starts empty once
 * the interval is known: the first frames after the layout switches on (the
 * first one measures the page, the first draw warms the GPU up) are slow on a
 * phone, and three such frames in 45 would otherwise be enough to step down
 * for good (seen at 4x CPU throttle, where the screen had no trouble at all).
 *
 * All of the numbers are Claude's candidates (未拍板) until they are measured
 * on a real phone. Pure: no DOM, no clock.
 */
export const DEGRADE = {
  /** A gap between two draws longer than this (ms) is the reader pausing, not a slow frame. */
  MAX_GAP_MS: 50,
  /** How many of the latest gaps the 95th percentile is taken over. */
  WINDOW: 45,
  /** How many of the first gaps give the screen's refresh interval. */
  REFRESH_SAMPLES: 40,
  /** The window's 95th percentile must exceed the refresh interval by this factor to count as slow. */
  SLOW_RATIO: 1.7,
  /** A slow window takes this share off the draw count. */
  STEP: 0.25,
  /** The draw count never goes below this share of the budget. */
  FLOOR: 0.25,
} as const;

/** Whether a gap between two draws (ms) counts: more than nothing, and not a pause. */
export function isFrameGap(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0 && ms <= DEGRADE.MAX_GAP_MS;
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

/** The nearest-rank percentile (q from 0 to 1) of a list. NaN for an empty list. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(Math.min(Math.max(q, 0), 1) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

/**
 * The screen's refresh interval (ms) from the first gaps between draws: the
 * median of the first `REFRESH_SAMPLES`, once there are that many; null before.
 */
export function estimateRefreshMs(firstGaps: readonly number[]): number | null {
  if (firstGaps.length < DEGRADE.REFRESH_SAMPLES) return null;
  return median(firstGaps.slice(0, DEGRADE.REFRESH_SAMPLES));
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
  /** The latest gaps between draws (ms), already filtered with `isFrameGap`; only the last `WINDOW` are read. */
  readonly gaps: readonly number[];
  /** The screen's refresh interval (ms), or null while it is not known yet. */
  readonly refreshMs: number | null;
}

/**
 * How many particles to draw next. The same as `current` until the window is
 * full and slow; then 25 % fewer, never below a quarter of the budget, and
 * never more than `current` (it only steps down).
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
  const recent = gaps.slice(-DEGRADE.WINDOW);
  if (!(percentile(recent, 0.95) > DEGRADE.SLOW_RATIO * refreshMs)) {
    return current;
  }
  return Math.max(floor, Math.round(current * (1 - DEGRADE.STEP)));
}

/** What the guard remembers between frames. Plain data: `observeFrame` returns the next one. */
export interface GuardState {
  /** When the last frame was drawn (ms), or 0 before the first. */
  readonly lastAt: number;
  /** The latest gaps, once the screen's interval is known (the window the 95th percentile is taken over). */
  readonly gaps: readonly number[];
  /** The first gaps, until there are enough to estimate the screen's interval from. */
  readonly firstGaps: readonly number[];
  readonly refreshMs: number | null;
  /** How many particles are drawn now. */
  readonly drawCount: number;
}

/** The guard at the start of a layout whose budget is `budget`, drawing all of them. */
export function newGuard(budget: number): GuardState {
  return {
    lastAt: 0,
    gaps: [],
    firstGaps: [],
    refreshMs: null,
    drawCount: budget,
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
 * A frame was drawn at `now` (ms, the animation frame's timestamp). Returns the
 * guard after it: the gap since the last frame is kept if it counts, the
 * screen's interval is estimated from the first 40, and once the window is full
 * and slow the draw count steps down (and the window starts again).
 */
export function observeFrame(
  state: GuardState,
  now: number,
  budget: number,
): GuardState {
  const gap = now - state.lastAt;
  if (!(state.lastAt > 0) || !isFrameGap(gap)) return { ...state, lastAt: now };

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
