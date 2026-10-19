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
 *   "perfect";
 * - a paper-gate cue (a covered edge, a paper that is not flat) is put on
 *   screen only after `confirmSamples` consecutive samples carried that SAME
 *   REASON. If those samples named different sides, the plain "an edge is
 *   covered" text goes up, not a side name, so a side that flips cannot keep
 *   the screen on an old cue. Another reason or any other cue in between
 *   starts the count again. The first sample with nothing on screen is held
 *   the same way.
 *
 * Pure: the caller keeps the state and passes the sample's code and the time.
 * It debounces the WORDS only; the ring reducer reads the raw sample.
 */
import { CAMERA_CONSTANTS } from "./constants";
import { paperGateReason, type CueCode, type PaperGateReason } from "./cues";

export interface CueDebounceState {
  /** The cue on screen; `null` before the first sample. */
  readonly shown: CueCode | null;
  /** When `shown` was put on screen (ms, the caller's clock). */
  readonly shownAtMs: number;
  /** While "perfect" is shown: consecutive non-perfect samples so far. */
  readonly offPerfectStreak: number;
  /** The paper-gate cue the latest samples keep carrying, `null` when the latest sample carried none. */
  readonly pending: CueCode | null;
  /** How many samples in a row carried `pending`. */
  readonly pendingCount: number;
}

export const INITIAL_CUE_DEBOUNCE_STATE: CueDebounceState = {
  shown: null,
  shownAtMs: 0,
  offPerfectStreak: 0,
  pending: null,
  pendingCount: 0,
};

export interface CueDebounceOptions {
  readonly leavePerfectSamples: number;
  readonly minTextChangeMs: number;
  /** Samples in a row a paper-gate cue must carry before it is shown; defaults to the constant. */
  readonly confirmSamples?: number;
}

const DEFAULT_OPTIONS: CueDebounceOptions = CAMERA_CONSTANTS.cueDebounce;

function adopt(code: CueCode, nowMs: number): CueDebounceState {
  return {
    shown: code,
    shownAtMs: nowMs,
    offPerfectStreak: 0,
    pending: null,
    pendingCount: 0,
  };
}

/** The one text that stands for a reason when the samples disagree on the side. */
const GENERIC_FOR_REASON: Record<PaperGateReason, CueCode> = {
  "edge-covered": "edge-covered",
  "paper-curled": "paper-curled",
};

/** The state after one sample whose (raw) cue code is `sample`. */
export function advanceCueDebounce(
  state: CueDebounceState,
  sample: CueCode,
  nowMs: number,
  options: CueDebounceOptions = DEFAULT_OPTIONS,
): CueDebounceState {
  // The run of paper-gate samples with the same REASON (anything else clears
  // it). If the samples of the run name different sides, the run stands for
  // the plain reason text: a side that flips is not a side to name.
  const reason = paperGateReason(sample);
  const continuingRun =
    reason !== null &&
    state.pending !== null &&
    paperGateReason(state.pending) === reason;
  const pending: CueCode | null =
    reason === null
      ? null
      : continuingRun && state.pending !== sample
        ? GENERIC_FOR_REASON[reason]
        : continuingRun
          ? state.pending
          : sample;
  const pendingCount =
    reason === null ? 0 : continuingRun ? state.pendingCount + 1 : 1;
  // What would go on screen if this sample is the one that lets it.
  const target: CueCode = pending ?? sample;
  const confirmSamples =
    options.confirmSamples ?? CAMERA_CONSTANTS.cueDebounce.confirmSamples;
  const unconfirmed = reason !== null && pendingCount < confirmSamples;

  if (state.shown === null) {
    return unconfirmed
      ? { ...state, pending, pendingCount }
      : adopt(target, nowMs);
  }
  if (target === state.shown && !continuingRun) {
    return state.offPerfectStreak === 0 &&
      state.pending === null &&
      state.pendingCount === 0
      ? state
      : { ...state, offPerfectStreak: 0, pending: null, pendingCount: 0 };
  }
  if (sample === "perfect") return adopt(sample, nowMs);

  // From here the sample is a non-perfect code that differs from what is shown
  // (or continues a paper-gate run whose text may differ from what is shown).
  let offPerfectStreak = state.offPerfectStreak;
  if (state.shown === "perfect") {
    offPerfectStreak += 1;
    if (offPerfectStreak < options.leavePerfectSamples) {
      return { ...state, offPerfectStreak, pending, pendingCount };
    }
  }
  if (unconfirmed) return { ...state, offPerfectStreak, pending, pendingCount };
  if (target === state.shown) {
    // The run settled on the text already on screen.
    return { ...state, offPerfectStreak: 0, pending: null, pendingCount: 0 };
  }
  if (nowMs - state.shownAtMs < options.minTextChangeMs) {
    return { ...state, offPerfectStreak, pending, pendingCount };
  }
  return adopt(target, nowMs);
}
