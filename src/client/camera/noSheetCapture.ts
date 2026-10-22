/**
 * V3.2 F14 (Kirby's phone test of preview 5, 2026-10-22, candidate 未拍板):
 * "On a lower contrast condition (bright colored table), it still need to
 * perform the auto scan, if it cannot identify, it has to automatically go
 * into adjustment mode."
 *
 * On a light table the live detector may never find the sheet, so the paper
 * ring (`autoCapture.ts`) never fills and nothing happens. This is the second
 * way the shutter fires by itself: while the sheet is NOT found but a hand is
 * seen, held still, in a sharp picture, for `waitMs` (about 4 s), the photo is
 * taken anyway. Its analysis then opens the adjustment screen when it fails on
 * the paper (`adjustOpensDirectly`, paperAdjustState.ts).
 *
 * Everything here is pure: the live loop gives it one sample at a time.
 *
 * - The wait only runs while every condition holds; a found sheet empties it
 *   at once (the paper ring is then the one that counts).
 * - One or two samples without a steady hand only pause it (as the paper
 *   ring, scan v2); `maxConsecutiveMisses` in a row empty it.
 * - Before the preview has settled (exposure, focus) nothing is counted.
 * - The hand is read by the live loop at most every `handSampleIntervalMs`
 *   (`shouldSampleHand`); a reading older than `handStaleMs` counts as no
 *   hand (`liveHandSignal`).
 */
import { CAMERA_CONSTANTS } from "./constants";
import type { Point } from "./quad";

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
  /** The detector found the sheet's four corners in this sample. */
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
  if (sample.sheetFound) return INITIAL_NO_SHEET_CAPTURE_STATE;
  if (!sample.settled) return state;
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
 * Whether the live loop reads the hand on this sample: only while the sheet
 * is not found (the paper ring needs no hand), only once the hand detector is
 * loaded, and at most every `handSampleIntervalMs`.
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
