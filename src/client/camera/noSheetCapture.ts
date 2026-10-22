/**
 * V3.2 F14 (Kirby's phone test of preview 5, 2026-10-22, candidate 未拍板):
 * "On a lower contrast condition (bright colored table), it still need to
 * perform the auto scan, if it cannot identify, it has to automatically go
 * into adjustment mode."
 *
 * On a light table the live detector may never find the sheet, or find it
 * only now and then, or find a quad that does not pass the paper gate, so the
 * paper ring (`autoCapture.ts`) never fills and nothing happens. This is the
 * second way the shutter fires by itself: while the sheet is not found
 * (`sheetFoundByCue`) but a hand is seen, held still, in a sharp picture, for `waitMs` (about
 * 4 s), the photo is taken anyway. Its analysis then opens the adjustment
 * screen when it fails on the paper (`adjustOpensDirectly`,
 * paperAdjustState.ts).
 *
 * Everything here is pure: the live loop gives it one sample at a time.
 *
 * - The wait runs only while the sheet is not found (`sheetFoundByCue`): no
 *   corners, some corners, a detector stage cue, or a quad the paper gate
 *   turns back (covered edge, curled paper). A sheet that is found and only
 *   needs the phone moved (tilted, too far, too close, too dark, too bright,
 *   not still, out of focus) pauses it: the live cue tells the user what to
 *   do and the paper ring takes the photo once it is fixed. So does a sample
 *   on which every check passes (the ring fills on it); a sheet that keeps
 *   passing fires the ring first (800 ms against 4 s). The wait is never
 *   emptied by the sheet.
 * - Samples without a steady hand only pause it (as the paper ring, scan
 *   v2); `maxConsecutiveMisses` in a row empty it. One hand reading that
 *   missed the hand or saw it move costs at most two readings' worth of
 *   samples (`recordHandReading` keeps the last reading that found a hand to
 *   compare with), which is fewer than `maxConsecutiveMisses`.
 * - Before the preview has settled (exposure, focus) nothing is counted.
 * - The hand is read by the live loop at most every `handSampleIntervalMs`
 *   (`shouldSampleHand`); a reading older than `handStaleMs` counts as no
 *   hand (`liveHandSignal`).
 */
import { CAMERA_CONSTANTS } from "./constants";
import type { CueCode } from "./cues";
import type { Point } from "./quad";

/**
 * Per live cue (`pickCue`), whether the sheet counts as found for this wait.
 * `true`: the sheet is found and the cue asks only for the phone to be moved
 * or held (or every check passed), so the wait pauses and the live checks keep
 * guarding the shot. `false`: the sheet is not found, or the paper gate turns
 * the found quad back, so the wait runs. Every code is listed: a new cue
 * needs a decision here (candidate 未拍板, F14 review 2026-10-22).
 */
const SHEET_FOUND_BY_CUE: Readonly<Record<CueCode, boolean>> = {
  "place-paper": false,
  "no-corners": false,
  "some-corners": false,
  "stage-no-bright-region": false,
  "stage-region-split": false,
  "stage-aspect-mismatch": false,
  "stage-too-small": false,
  "edge-covered": false,
  "edge-covered-top": false,
  "edge-covered-bottom": false,
  "edge-covered-left": false,
  "edge-covered-right": false,
  "paper-curled": false,
  tilted: true,
  "too-far": true,
  "too-close": true,
  dark: true,
  bright: true,
  "hold-still": true,
  "out-of-focus": true,
  perfect: true,
};

/** Whether this live cue says the sheet is found, so the wait pauses (`SHEET_FOUND_BY_CUE`). */
export function sheetFoundByCue(code: CueCode): boolean {
  return SHEET_FOUND_BY_CUE[code];
}

export interface NoSheetCaptureState {
  /** Milliseconds of passing-sample time so far. */
  readonly waitedMs: number;
  /** Samples in a row without a steady hand (0 while passing). */
  readonly missStreak: number;
  /** True once the wait is over and the photo should be taken. Stays true until reset. */
  readonly fired: boolean;
}

export const INITIAL_NO_SHEET_CAPTURE_STATE: NoSheetCaptureState = {
  waitedMs: 0,
  missStreak: 0,
  fired: false,
};

/** What one live sample says. */
export interface NoSheetSample {
  /**
   * The sheet is found on this sample (`sheetFoundByCue` of the live cue):
   * every check passed, or only the phone needs moving or holding. The live
   * checks and the paper ring guard the shot then, and this wait pauses. No
   * sheet, a sheet found only now and then, or a quad the paper gate turns
   * back leaves this false and the wait on.
   */
  readonly sheetFound: boolean;
  /** A hand was read recently enough (`liveHandSignal`). */
  readonly handSeen: boolean;
  /** ...and it has not moved between the last two readings. */
  readonly handSteady: boolean;
  /** The picture is sharp enough (the live loop's own Laplacian floor). */
  readonly sharp: boolean;
  /** The preview has settled (exposure, focus). */
  readonly settled: boolean;
}

export function advanceNoSheetCapture(
  state: NoSheetCaptureState,
  sample: NoSheetSample,
  dtMs: number,
  waitMs: number = CAMERA_CONSTANTS.noSheetCapture.waitMs,
  maxConsecutiveMisses: number = CAMERA_CONSTANTS.noSheetCapture
    .maxConsecutiveMisses,
): NoSheetCaptureState {
  if (state.fired) return state;
  if (sample.sheetFound || !sample.settled) return state;
  if (!(sample.handSeen && sample.handSteady && sample.sharp)) {
    const missStreak = state.missStreak + 1;
    if (missStreak >= maxConsecutiveMisses)
      return INITIAL_NO_SHEET_CAPTURE_STATE;
    return { ...state, missStreak };
  }
  if (dtMs < 0) {
    throw new RangeError(`advanceNoSheetCapture needs dtMs >= 0, got ${dtMs}.`);
  }
  const waitedMs = state.waitedMs + dtMs;
  if (waitedMs >= waitMs)
    return { waitedMs: waitMs, missStreak: 0, fired: true };
  return { waitedMs, missStreak: 0, fired: false };
}

/** A reading of the hand in the live picture: when, and its landmarks (sample px), or `null` for none found. */
export interface LiveHandReading {
  readonly atMs: number;
  readonly points: readonly Point[] | null;
}

/**
 * Whether the live loop reads the hand on this sample: only when the sheet
 * is not found (the wait is paused otherwise, `sheetFoundByCue`), only once
 * the hand detector is loaded, and at most every `handSampleIntervalMs`.
 */
export function shouldSampleHand(input: {
  readonly sheetFound: boolean;
  readonly detectorReady: boolean;
  readonly lastReadingAtMs: number | null;
  readonly nowMs: number;
  readonly intervalMs?: number;
}): boolean {
  if (input.sheetFound || !input.detectorReady) return false;
  const interval =
    input.intervalMs ?? CAMERA_CONSTANTS.noSheetCapture.handSampleIntervalMs;
  return (
    input.lastReadingAtMs === null ||
    input.nowMs - input.lastReadingAtMs >= interval
  );
}

/** The two hand readings `liveHandSignal` goes by. */
export interface HandReadings {
  /** The last reading before `latest` that found a hand (never a `null` one). */
  readonly previous: LiveHandReading | null;
  readonly latest: LiveHandReading | null;
}

export const EMPTY_HAND_READINGS: HandReadings = {
  previous: null,
  latest: null,
};

/**
 * Adds a new reading. `previous` becomes the old `latest` only when that one
 * found a hand: a reading that missed the hand is not something to compare
 * with, so after one miss the next reading that finds the hand is compared
 * with the last one that did (`liveHandSignal`, within `handStaleMs`).
 */
export function recordHandReading(
  readings: HandReadings,
  reading: LiveHandReading,
): HandReadings {
  return {
    previous: readings.latest?.points ? readings.latest : readings.previous,
    latest: reading,
  };
}

/** The largest movement of any landmark between two readings of the same hand, in sample px. */
export function maxLandmarkMovement(
  previous: readonly Point[],
  current: readonly Point[],
): number {
  if (previous.length !== current.length || current.length === 0)
    return Number.POSITIVE_INFINITY;
  let most = 0;
  for (let i = 0; i < current.length; i++) {
    const d = Math.hypot(
      current[i].x - previous[i].x,
      current[i].y - previous[i].y,
    );
    if (!(d <= most)) most = d;
  }
  return most;
}

/**
 * What the two latest readings say about the hand: `seen` when the latest
 * found one no more than `handStaleMs` ago; `steady` when, as well, the
 * reading before it found one too, no more than `handStaleMs` before it, and
 * no landmark moved more than `maxHandMovementFraction` of the picture's
 * diagonal between them.
 */
export function liveHandSignal(input: {
  readonly previous: LiveHandReading | null;
  readonly latest: LiveHandReading | null;
  readonly nowMs: number;
  readonly frameDiagonal: number;
}): { readonly seen: boolean; readonly steady: boolean } {
  const C = CAMERA_CONSTANTS.noSheetCapture;
  const { previous, latest } = input;
  const seen =
    latest !== null &&
    latest.points !== null &&
    input.nowMs - latest.atMs <= C.handStaleMs;
  if (!seen || !previous?.points || !(input.frameDiagonal > 0))
    return { seen, steady: false };
  const gap = latest.atMs - previous.atMs;
  if (!(gap >= 0 && gap <= C.handStaleMs)) return { seen, steady: false };
  const moved = maxLandmarkMovement(previous.points, latest.points!);
  return {
    seen,
    steady: moved <= C.maxHandMovementFraction * input.frameDiagonal,
  };
}
