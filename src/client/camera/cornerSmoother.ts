/**
 * Per-corner smoothing for the easy scan's four corner dots
 * (docs/design/scan-v2-2026-09-30/README.md, "Corner dots"). Before, the
 * detected position replaced the dot's position every sample and a corner
 * that was not found fell back to its guide position, so the dots swam and
 * snapped.
 *
 * - A found corner is low-pass filtered. Until 2026-10-28 that was a fixed
 *   exponential weight of 0.35 on each new sample. At Kirby's 7.1 samples a
 *   second that trails a sheet panned at a steady speed by (1 - 0.35) / 0.35
 *   = 1.86 samples, about 260 ms, and takes 6 samples (850 ms) to cover 90 %
 *   of a sudden move (Kirby's S25 test: "讓框線跟的速度，反應速度更快一些").
 *   It is now a speed-adaptive filter (the "1 euro filter", Casiez, Roussel
 *   and Vogel, CHI 2012): the weight comes from a cut-off frequency that
 *   rises with the corner's own filtered speed. A corner at rest is filtered
 *   about as hard as before (`minCutoffHz` gives a weight of about 0.35 at
 *   140 ms), so the detector's 1-3 px jitter is damped as before; a corner
 *   that moves is followed with a weight near 1. The weight is worked out
 *   from the time since the corner was last seen, so an uneven sample rate
 *   (the detector's time varies) no longer changes how hard it filters.
 * - A lost corner keeps its last position and is drawn hollow. It never
 *   snaps to the guide. Only after `returnToGuideAfterMs` lost does it head
 *   back to the guide (the dot's CSS transition eases the move).
 * - `foundCount` goes up when a corner is newly found, which is when the dot
 *   pops in with a pulse ring. A corner that comes back within
 *   `repopAfterLostMs` of being lost is the same corner blinking, not a new
 *   find, so it does not pop again.
 *
 * Pure: positions are in the stage's own pixels, time steps are passed in.
 */
import { CAMERA_CONSTANTS } from "./constants";
import { bestPartialShift, shiftFour, type Four } from "./labelShift";
import type { Point } from "./quad";

export interface CornerState {
  /**
   * Where the dot is drawn: the filtered position, or the last one while the
   * corner is lost. `null` = no position yet (never seen, or eased back to
   * the guide): draw it at the guide.
   */
  readonly point: Point | null;
  /** Found in the latest sample. */
  readonly found: boolean;
  /** Milliseconds since the corner was last found (0 while found). */
  readonly lostMs: number;
  /** How many times the corner has been newly found (drives the pop-in). */
  readonly foundCount: number;
  /**
   * The last observation itself (unfiltered), and the corner's filtered
   * velocity in px per second: what the speed-adaptive filter reads.
   * Absent / still before the corner was seen; the velocity is zeroed while
   * the corner is lost, and both go once it heads back to the guide.
   */
  readonly raw?: Point | null;
  readonly velocity?: Point;
}

export const INITIAL_CORNER_STATE: CornerState = {
  point: null,
  found: false,
  lostMs: 0,
  foundCount: 0,
};

export interface CornerOptions {
  /** Cut-off of a corner at rest, Hz. */
  readonly minCutoffHz: number;
  /** How much the cut-off rises with speed: Hz per picture diagonal per second. */
  readonly speedCutoffGain: number;
  /** Cut-off of the filter on the velocity itself, Hz. */
  readonly velocityCutoffHz: number;
  readonly returnToGuideAfterMs: number;
  readonly repopAfterLostMs: number;
}

const DEFAULT_OPTIONS: CornerOptions = CAMERA_CONSTANTS.corners;

/**
 * The diagonal a speed is measured against when none is given: a phone's
 * stage in CSS px (400 x 800). The camera passes the picture's own.
 */
export const DEFAULT_DIAGONAL_PX = Math.hypot(400, 800);

/**
 * The weight an exponential filter with this cut-off gives a new sample
 * `dtMs` after the last: 1 / (1 + tau / dt), tau = 1 / (2 pi fc). 0 for a
 * step or a cut-off that is not positive.
 */
export function smoothingWeight(cutoffHz: number, dtMs: number): number {
  if (!(dtMs > 0) || !(cutoffHz > 0)) return 0;
  const tauMs = 1000 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tauMs / dtMs);
}

const STILL: Point = { x: 0, y: 0 };

/**
 * The state after one sample: `observed` is the corner's position, or `null`
 * when it was not found. `diagonalPx` is the diagonal of the picture the
 * positions are in: speeds are measured against it.
 */
export function advanceCorner(
  state: CornerState,
  observed: Point | null,
  dtMs: number,
  options: CornerOptions = DEFAULT_OPTIONS,
  diagonalPx: number = DEFAULT_DIAGONAL_PX,
): CornerState {
  if (observed) {
    const isNew =
      !state.found &&
      (state.point === null || state.lostMs >= options.repopAfterLostMs);
    const foundCount = isNew ? state.foundCount + 1 : state.foundCount;
    // The first sighting is taken as it is: there is nothing to filter against.
    if (!state.point)
      return {
        point: observed,
        found: true,
        lostMs: 0,
        foundCount,
        raw: observed,
        velocity: STILL,
      };
    // The time since the corner was last seen: this step, or a blink and it.
    const sinceMs = Math.max(0, state.lostMs) + Math.max(0, dtMs);
    const last = state.raw ?? state.point;
    const before = state.velocity ?? STILL;
    const velocityWeight = smoothingWeight(options.velocityCutoffHz, sinceMs);
    const velocity =
      sinceMs > 0
        ? {
            x:
              before.x +
              velocityWeight *
                (((observed.x - last.x) * 1000) / sinceMs - before.x),
            y:
              before.y +
              velocityWeight *
                (((observed.y - last.y) * 1000) / sinceMs - before.y),
          }
        : before;
    const diagonal =
      Number.isFinite(diagonalPx) && diagonalPx > 0
        ? diagonalPx
        : DEFAULT_DIAGONAL_PX;
    const speed = Math.hypot(velocity.x, velocity.y) / diagonal;
    const weight = smoothingWeight(
      options.minCutoffHz + options.speedCutoffGain * speed,
      sinceMs,
    );
    return {
      point: {
        x: state.point.x + weight * (observed.x - state.point.x),
        y: state.point.y + weight * (observed.y - state.point.y),
      },
      found: true,
      lostMs: 0,
      foundCount,
      raw: observed,
      velocity,
    };
  }
  const lostMs = state.lostMs + Math.max(0, dtMs);
  const gone = lostMs >= options.returnToGuideAfterMs;
  return {
    // Kept as it was; only a long absence lets go of it.
    point: gone ? null : state.point,
    found: false,
    lostMs,
    foundCount: state.foundCount,
    raw: gone ? null : (state.raw ?? null),
    // Out of sight it is not moving as far as the filter knows: found again,
    // it starts from rest (filtered hard) unless it really moves.
    velocity: STILL,
  };
}

/** Where to draw the corner: its own position, else its guide position. */
export function cornerDrawPoint(state: CornerState, guide: Point): Point {
  return state.point ?? guide;
}

/** Where each of the four dots is drawn, in the order of the states. */
export function cornerDrawPoints(
  states: CornerStates,
  guide: Four<Point>,
): Four<Point> {
  return [
    cornerDrawPoint(states[0], guide[0]),
    cornerDrawPoint(states[1], guide[1]),
    cornerDrawPoint(states[2], guide[2]),
    cornerDrawPoint(states[3], guide[3]),
  ];
}

/** True once a lost corner is on its way back to the guide (its dot uses the slower ease). */
export function isCornerReturning(
  state: CornerState,
  options: CornerOptions = DEFAULT_OPTIONS,
): boolean {
  return !state.found && state.lostMs >= options.returnToGuideAfterMs;
}

export type CornerStates = readonly [
  CornerState,
  CornerState,
  CornerState,
  CornerState,
];

export const INITIAL_CORNER_STATES: CornerStates = [
  INITIAL_CORNER_STATE,
  INITIAL_CORNER_STATE,
  INITIAL_CORNER_STATE,
  INITIAL_CORNER_STATE,
];

export type Observed = Four<Point | null>;

/**
 * Matches a new observation to the corners being followed. The detector
 * relabels its corners (a cyclic shift) when the paper is held sideways, so
 * the corner that arrives as "top-left" may be the one that was "bottom-right".
 * Taken at face value every dot would then glide across the paper to the
 * opposite corner. So the observation is shifted by whichever of the four
 * cyclic shifts puts it closest to where the dots are (labelShift.ts). The
 * match uses the pairs where the observation AND the dot both have a position,
 * and needs at least two: the detector reports 0, 2 or 4 corners (one hidden
 * edge hides two), and a relabel with only two visible must still be followed.
 * One pair, or none, is nothing safe to match on, and the observation is left
 * as it is. The shift is applied to the whole observation: a corner's
 * found/lost flag travels with its position, because a lost corner is simply
 * a null entry in the same array.
 */
export function alignObservation(
  states: CornerStates,
  observed: Observed,
): Observed {
  const tracked: Four<Point | null> = [
    states[0].point,
    states[1].point,
    states[2].point,
    states[3].point,
  ];
  const shift = bestPartialShift(tracked, observed);
  return shift === null || shift === 0 ? observed : shiftFour(observed, shift);
}

/** Advance all four corners (TL, TR, BR, BL) by one sample. */
export function advanceCorners(
  states: CornerStates,
  observed: Observed,
  dtMs: number,
  options: CornerOptions = DEFAULT_OPTIONS,
  diagonalPx: number = DEFAULT_DIAGONAL_PX,
): CornerStates {
  const matched = alignObservation(states, observed);
  return [
    advanceCorner(states[0], matched[0], dtMs, options, diagonalPx),
    advanceCorner(states[1], matched[1], dtMs, options, diagonalPx),
    advanceCorner(states[2], matched[2], dtMs, options, diagonalPx),
    advanceCorner(states[3], matched[3], dtMs, options, diagonalPx),
  ];
}
