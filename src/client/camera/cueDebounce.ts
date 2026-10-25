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
 *   the same way. The four detector-stage cues (scan S2) are one reason the
 *   same way; samples that name different stages put up "no-corners".
 * - V3.2 F16 (candidate): an ordinary cue (not a paper-gate one, not
 *   "perfect") replaces another cue on screen only after
 *   `switchConfirmSamples` consecutive samples carried that SAME code. Two
 *   conflicting detections that alternate sample by sample no longer swap the
 *   text every 500 ms. Nothing on screen yet, and leaving "perfect", keep
 *   their own rules.
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
  /**
   * The paper-gate cue the latest samples keep carrying (or, V3.2 F16, the
   * ordinary cue the latest samples repeat), `null` when there is none.
   */
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
  /** V3.2 F16: samples in a row an ordinary cue must repeat to replace another cue on screen; defaults to the constant. */
  readonly switchConfirmSamples?: number;
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
  // The detector-stage cues (scan S2): samples that name different stages
  // fall back to the plain no-paper text, as covered sides do to "edge-covered".
  "paper-stage": "no-corners",
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
  // V3.2 F16 (candidate): a detector stage that is on screen coming back ends
  // a run, so one stray stage in between (a far sheet read as too small, then
  // once as split) does not put up the plain text and then the stage again.
  // Covered sides keep their rule: a side that flips settles on the plain text.
  const backToShownStage = reason === "paper-stage" && sample === state.shown;
  const continuingRun =
    !backToShownStage &&
    reason !== null &&
    state.pending !== null &&
    paperGateReason(state.pending) === reason;
  // V3.2 F16: an ordinary cue counts its own repeats.
  const ordinary = reason === null && sample !== "perfect";
  const pending: CueCode | null =
    reason === null
      ? ordinary
        ? sample
        : null
      : continuingRun && state.pending !== sample
        ? GENERIC_FOR_REASON[reason]
        : continuingRun
          ? state.pending
          : sample;
  const pendingCount =
    reason === null
      ? ordinary
        ? state.pending === sample
          ? state.pendingCount + 1
          : 1
        : 0
      : continuingRun
        ? state.pendingCount + 1
        : 1;
  // What would go on screen if this sample is the one that lets it.
  const target: CueCode = pending ?? sample;
  const confirmSamples =
    options.confirmSamples ?? CAMERA_CONSTANTS.cueDebounce.confirmSamples;
  const switchConfirmSamples =
    options.switchConfirmSamples ??
    CAMERA_CONSTANTS.cueDebounce.switchConfirmSamples;
  const unconfirmed =
    (reason !== null && pendingCount < confirmSamples) ||
    // Replacing another cue (not "perfect", which has its own rule below).
    (ordinary &&
      state.shown !== null &&
      state.shown !== "perfect" &&
      pendingCount < switchConfirmSamples);

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
