/**
 * Per-corner smoothing for the easy scan's four corner dots
 * (docs/design/scan-v2-2026-09-30/README.md, "Corner dots"). Before, the
 * detected position replaced the dot's position every sample and a corner
 * that was not found fell back to its guide position, so the dots swam and
 * snapped.
 *
 * - A found corner is low-pass filtered: an exponential filter with weight
 *   `filterAlpha` on the new sample.
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
}

export const INITIAL_CORNER_STATE: CornerState = {
  point: null,
  found: false,
  lostMs: 0,
  foundCount: 0,
};

export interface CornerOptions {
  readonly filterAlpha: number;
  readonly returnToGuideAfterMs: number;
  readonly repopAfterLostMs: number;
}

const DEFAULT_OPTIONS: CornerOptions = CAMERA_CONSTANTS.corners;

/** The state after one sample: `observed` is the corner's position, or `null` when it was not found. */
export function advanceCorner(
  state: CornerState,
  observed: Point | null,
  dtMs: number,
  options: CornerOptions = DEFAULT_OPTIONS,
): CornerState {
  if (observed) {
    const point = state.point
      ? {
          x: state.point.x + options.filterAlpha * (observed.x - state.point.x),
          y: state.point.y + options.filterAlpha * (observed.y - state.point.y),
        }
      : observed;
    const isNew =
      !state.found &&
      (state.point === null || state.lostMs >= options.repopAfterLostMs);
    return {
      point,
      found: true,
      lostMs: 0,
      foundCount: isNew ? state.foundCount + 1 : state.foundCount,
    };
  }
  const lostMs = state.lostMs + Math.max(0, dtMs);
  return {
    // Kept as it was; only a long absence lets go of it.
    point: lostMs >= options.returnToGuideAfterMs ? null : state.point,
    found: false,
    lostMs,
    foundCount: state.foundCount,
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
): CornerStates {
  const matched = alignObservation(states, observed);
  return [
    advanceCorner(states[0], matched[0], dtMs, options),
    advanceCorner(states[1], matched[1], dtMs, options),
    advanceCorner(states[2], matched[2], dtMs, options),
    advanceCorner(states[3], matched[3], dtMs, options),
  ];
}
