/**
 * Debounce for the easy scan's one cue line
 * (docs/design/scan-v2-2026-09-30/README.md, "Cue"). The old throttle was
 * bypassed whenever the cue code changed, so the text flickered with every
 * noisy sample. Now:
 *
 * - a change TO "perfect" shows at once;
 * - a change away from "perfect" needs `leavePerfectSamples` consecutive
 *   non-perfect samples first (any non-perfect codes: the ring is reset by
 *   consecutive failures too, so the cue must not keep saying "perfect" while
 *   the samples keep failing);
 * - the text changes no more often than every `minTextChangeMs`, except into
 *   "perfect".
 *
 * Pure: the caller keeps the state and passes the sample's code and the time.
 * It debounces the WORDS only; the ring reducer reads the raw sample.
 */
import { CAMERA_CONSTANTS } from "./constants";
import type { CueCode } from "./cues";

export interface CueDebounceState {
  /** The cue on screen; `null` before the first sample. */
  readonly shown: CueCode | null;
  /** When `shown` was put on screen (ms, the caller's clock). */
  readonly shownAtMs: number;
  /** While "perfect" is shown: consecutive non-perfect samples so far. */
  readonly offPerfectStreak: number;
}

export const INITIAL_CUE_DEBOUNCE_STATE: CueDebounceState = {
  shown: null,
  shownAtMs: 0,
  offPerfectStreak: 0,
};

export interface CueDebounceOptions {
  readonly leavePerfectSamples: number;
  readonly minTextChangeMs: number;
}

const DEFAULT_OPTIONS: CueDebounceOptions = CAMERA_CONSTANTS.cueDebounce;

function adopt(code: CueCode, nowMs: number): CueDebounceState {
  return { shown: code, shownAtMs: nowMs, offPerfectStreak: 0 };
}

/** The state after one sample whose (raw) cue code is `sample`. */
export function advanceCueDebounce(
  state: CueDebounceState,
  sample: CueCode,
  nowMs: number,
  options: CueDebounceOptions = DEFAULT_OPTIONS,
): CueDebounceState {
  if (state.shown === null) return adopt(sample, nowMs);
  if (sample === state.shown) {
    return state.offPerfectStreak === 0
      ? state
      : { ...state, offPerfectStreak: 0 };
  }
  if (sample === "perfect") return adopt(sample, nowMs);

  // From here the sample is a non-perfect code that differs from what is shown.
  let offPerfectStreak = state.offPerfectStreak;
  if (state.shown === "perfect") {
    offPerfectStreak += 1;
    if (offPerfectStreak < options.leavePerfectSamples) {
      return { ...state, offPerfectStreak };
    }
  }
  if (nowMs - state.shownAtMs < options.minTextChangeMs) {
    return { ...state, offPerfectStreak };
  }
  return adopt(sample, nowMs);
}
