/**
 * V3.2 F16 (Kirby's phone test of preview 6, 2026-10-23; candidate 未拍板):
 * hysteresis for the live viewfinder's outline, the four corner dots and the
 * edges between them. Kirby: "If the side lines conflict, it may cause
 * flickers". When the detector has two candidate lines for a side (the
 * paper's edge and, say, a shadow or the desk's edge beside it), consecutive
 * samples can alternate between two quads, or between four corners and two.
 * The corner smoother (`cornerSmoother.ts`) then drags every dot a fifth of
 * the gap back and forth each sample, and the found/lost flag (filled dot,
 * hollow dot, edges on or off) blinks.
 *
 * What is drawn now changes only on evidence that holds:
 *
 * - a sample whose corners are more than `jumpFraction` of the picture's
 *   diagonal away from the quad on screen (the furthest pair) is a JUMP, and a
 *   jump is followed only once `switchSamples` samples IN A ROW were jumps.
 *   Until then the quad on screen is given again. Two quads that alternate
 *   never make two jumps in a row, so the outline stays on one of them; a
 *   phone really moved makes every sample a jump and is followed one sample
 *   late. Movement under the threshold is passed through as it is (the corner
 *   smoother low-passes it as before);
 * - a corner that was on screen and is missing from a sample is kept, where
 *   it was, until it has been missing `lostSamples` samples in a row, so a
 *   corner that is found every other sample stays found.
 *
 * Display only: the detector, the paper gate, the cue code, the ring and the
 * shutter all read the raw sample, as before. Pure: positions in stage px.
 */
import { CAMERA_CONSTANTS } from "./constants";
import { bestPartialShift, shiftFour, type Four } from "./labelShift";
import type { Point } from "./quad";

export type OutlineObservation = Four<Point | null>;

export interface OutlineHysteresisState {
  /** The corners last passed on (what the dots follow); all `null` before the first sample. */
  readonly held: OutlineObservation;
  /** Samples in a row that were jumps from `held`. */
  readonly jumpStreak: number;
  /** Per corner: samples in a row it was missing while `held` still had it. */
  readonly missStreak: Four<number>;
}

export const INITIAL_OUTLINE_HYSTERESIS_STATE: OutlineHysteresisState = {
  held: [null, null, null, null],
  jumpStreak: 0,
  missStreak: [0, 0, 0, 0],
};

export interface OutlineHysteresisOptions {
  readonly jumpFraction: number;
  readonly switchSamples: number;
  readonly lostSamples: number;
}

const DEFAULT_OPTIONS: OutlineHysteresisOptions =
  CAMERA_CONSTANTS.outlineHysteresis;

/** The largest distance between a corner of `a` and the same corner of `b`, over the corners both have; `null` when none. */
export function largestCornerGap(
  a: OutlineObservation,
  b: OutlineObservation,
): number | null {
  let gap: number | null = null;
  for (let i = 0; i < 4; i++) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) continue;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (gap === null || d > gap) gap = d;
  }
  return gap;
}

/**
 * One sample: the state after it, and the corners to hand to the corner
 * smoother in its place (labelled like the quad on screen). `diagonalPx` is
 * the diagonal of the picture the corners are in.
 */
export function advanceOutline(
  state: OutlineHysteresisState,
  observed: OutlineObservation,
  diagonalPx: number,
  options: OutlineHysteresisOptions = DEFAULT_OPTIONS,
): {
  readonly state: OutlineHysteresisState;
  readonly shown: OutlineObservation;
} {
  const held = state.held;
  if (held.every((p) => p === null)) {
    const next: OutlineHysteresisState = {
      held: observed,
      jumpStreak: 0,
      missStreak: [0, 0, 0, 0],
    };
    return { state: next, shown: observed };
  }
  // The detector relabels its corners (labelShift.ts): match them to the
  // quad on screen first, so a relabel is not mistaken for a jump.
  const shift = bestPartialShift(held, observed);
  const matched =
    shift === null || shift === 0 ? observed : shiftFour(observed, shift);

  const gap = largestCornerGap(held, matched);
  const jump =
    gap !== null &&
    Number.isFinite(diagonalPx) &&
    diagonalPx > 0 &&
    gap > options.jumpFraction * diagonalPx;
  if (jump) {
    const jumpStreak = state.jumpStreak + 1;
    if (jumpStreak < options.switchSamples) {
      return { state: { ...state, jumpStreak }, shown: held };
    }
  }

  const missStreak = [0, 0, 0, 0];
  const shown: (Point | null)[] = [null, null, null, null];
  for (let i = 0; i < 4; i++) {
    const seen = matched[i];
    if (seen) {
      shown[i] = seen;
      continue;
    }
    const before = held[i];
    // After a jump the quad on screen is not where the paper is: nothing of it is kept.
    if (!before || jump) continue;
    missStreak[i] = state.missStreak[i] + 1;
    shown[i] = missStreak[i] < options.lostSamples ? before : null;
  }
  const out = shown as unknown as OutlineObservation;
  return {
    state: {
      held: out,
      jumpStreak: 0,
      missStreak: missStreak as unknown as Four<number>,
    },
    shown: out,
  };
}
