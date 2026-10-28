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
 * 2026-10-28 (Kirby's S25 test: "讓框線跟的速度，反應速度更快一些"; candidate
 * 未拍板): the jump rule above made a phone that kept moving lag. Following a
 * jump reset the streak, so the next jump was held again: with every sample
 * a jump the outline moved only on every OTHER sample (3.5 times a second at
 * Kirby's 7.1), not "one sample late" as this comment used to say. Now a
 * jump that CONTINUES the motion on screen is followed at once: the outline
 * on screen and the one before it give a prediction (the same step again),
 * and a sample within `continueFraction` of the diagonal of that prediction
 * is the sheet still moving, not a second quad. Two quads that alternate
 * never fit it (the prediction of a still outline is where it is), and
 * neither does a shadow's quad that turns up during a move (it is not where
 * the move was heading): both still need `switchSamples` jumps in a row.
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
  /**
   * The corners passed on the sample before `held` (in `held`'s labels):
   * `held` minus this is the step the outline last made. All `null` when
   * the last sample was held back (no step to continue). Absent in a state
   * from before 2026-10-28: read as all `null`.
   */
  readonly previous?: OutlineObservation;
}

const NONE: OutlineObservation = [null, null, null, null];

export const INITIAL_OUTLINE_HYSTERESIS_STATE: OutlineHysteresisState = {
  held: NONE,
  jumpStreak: 0,
  missStreak: [0, 0, 0, 0],
  previous: NONE,
};

export interface OutlineHysteresisOptions {
  readonly jumpFraction: number;
  readonly switchSamples: number;
  readonly lostSamples: number;
  /** A jump within this share of the diagonal of where the last step leads is followed at once. */
  readonly continueFraction: number;
}

/**
 * Where the outline goes if it makes its last step again: `held` + (`held` -
 * `previous`), per corner that both have; `null` elsewhere.
 */
export function predictOutline(
  held: OutlineObservation,
  previous: OutlineObservation,
): OutlineObservation {
  const next = (i: number): Point | null => {
    const now = held[i];
    const before = previous[i];
    return now && before
      ? { x: 2 * now.x - before.x, y: 2 * now.y - before.y }
      : null;
  };
  return [next(0), next(1), next(2), next(3)];
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
      previous: NONE,
    };
    return { state: next, shown: observed };
  }
  // The detector relabels its corners (labelShift.ts): match them to the
  // quad on screen first, so a relabel is not mistaken for a jump.
  const shift = bestPartialShift(held, observed);
  const matched =
    shift === null || shift === 0 ? observed : shiftFour(observed, shift);

  const diagonalOk = Number.isFinite(diagonalPx) && diagonalPx > 0;
  const gap = largestCornerGap(held, matched);
  const jump =
    gap !== null && diagonalOk && gap > options.jumpFraction * diagonalPx;
  if (jump) {
    const jumpStreak = state.jumpStreak + 1;
    if (
      jumpStreak < options.switchSamples &&
      !continuesMotion(state, matched, diagonalPx, options)
    ) {
      // Held back: there is no step to continue from the next sample.
      return {
        state: { ...state, jumpStreak, previous: NONE },
        shown: held,
      };
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
      // The step per sample: a jump followed after `n - 1` samples held back
      // made n samples' worth of movement at once.
      previous: oneStepBack(held, out, jump ? state.jumpStreak + 1 : 1),
    },
    shown: out,
  };
}

/**
 * Where the outline was one sample's step before `now`, when it went from
 * `from` to `now` over `samples` samples (per corner both have; `null` else).
 */
export function oneStepBack(
  from: OutlineObservation,
  now: OutlineObservation,
  samples: number,
): OutlineObservation {
  const n = Math.max(1, samples);
  const back = (i: number): Point | null => {
    const a = from[i];
    const b = now[i];
    return a && b
      ? { x: b.x - (b.x - a.x) / n, y: b.y - (b.y - a.y) / n }
      : null;
  };
  return [back(0), back(1), back(2), back(3)];
}

/**
 * Whether a jump is the outline's last step made again (within
 * `continueFraction` of the diagonal, over at least two corners): the sheet
 * still moving. `continueFraction` must stay under `jumpFraction`: the
 * prediction of an outline that did not move is where it is, so no jump
 * from it can then fit (the F16 alternation stays held).
 */
export function continuesMotion(
  state: OutlineHysteresisState,
  matched: OutlineObservation,
  diagonalPx: number,
  options: OutlineHysteresisOptions = DEFAULT_OPTIONS,
): boolean {
  if (!(options.continueFraction < options.jumpFraction)) return false;
  const predicted = predictOutline(state.held, state.previous ?? NONE);
  let common = 0;
  for (let i = 0; i < 4; i++) if (predicted[i] && matched[i]) common += 1;
  if (common < 2) return false;
  const gap = largestCornerGap(predicted, matched);
  return gap !== null && gap <= options.continueFraction * diagonalPx;
}
