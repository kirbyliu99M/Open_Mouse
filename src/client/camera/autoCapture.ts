/**
 * Auto-capture ring timer state machine
 * (docs/design/camera-capture-2026-09-25/README.md): "once every check
 * passes continuously, a progress ring fills around the shutter over
 * 800 ms". Scan v2 (docs/design/scan-v2-2026-09-30/README.md) softens the
 * reset: the live loop samples at 8 Hz, so one noisy sample used to restart
 * the whole fill and the ring rarely completed. Now one or two failed
 * samples only pause the ring, and it empties after
 * `maxConsecutiveFailures` failures in a row. The fill time stays 800 ms of
 * passing samples.
 *
 * Pure reducer — the caller (the live capture loop) calls
 * `advanceAutoCapture` once per sample with the elapsed time and whether
 * every check passed on that sample.
 */
import { CAMERA_CONSTANTS } from "./constants";

export interface AutoCaptureState {
  /** Milliseconds of passing-sample time accumulated so far. */
  readonly elapsedMs: number;
  /** Failed samples in a row since the last passing one (0 while passing). */
  readonly failStreak: number;
  /** True once the ring has completed and capture should fire. Stays true (a no-op state) until the caller resets it via `resetAutoCapture` after handling the capture. */
  readonly fired: boolean;
}

export const INITIAL_AUTO_CAPTURE_STATE: AutoCaptureState = {
  elapsedMs: 0,
  failStreak: 0,
  fired: false,
};

export function resetAutoCapture(): AutoCaptureState {
  return INITIAL_AUTO_CAPTURE_STATE;
}

/**
 * Advance the timer by `dtMs`. A passing sample adds `dtMs` and clears the
 * failure streak. A failing sample adds nothing (the ring pauses) and counts
 * toward the streak; the sample that makes the streak reach
 * `maxConsecutiveFailures` resets the ring to empty. Once `fired` becomes
 * true, further calls are a no-op until the caller explicitly resets (e.g.
 * after handling the capture and returning to the live viewfinder).
 */
export function advanceAutoCapture(
  state: AutoCaptureState,
  allChecksPass: boolean,
  dtMs: number,
  durationMs: number = CAMERA_CONSTANTS.autoCapture.durationMs,
  maxConsecutiveFailures: number = CAMERA_CONSTANTS.autoCapture
    .maxConsecutiveFailures,
): AutoCaptureState {
  if (state.fired) return state;
  if (!allChecksPass) {
    const failStreak = state.failStreak + 1;
    if (failStreak >= maxConsecutiveFailures) return INITIAL_AUTO_CAPTURE_STATE;
    return { ...state, failStreak };
  }
  if (dtMs < 0) {
    throw new RangeError(`advanceAutoCapture needs dtMs >= 0, got ${dtMs}.`);
  }
  const elapsedMs = state.elapsedMs + dtMs;
  if (elapsedMs >= durationMs) {
    return { elapsedMs: durationMs, failStreak: 0, fired: true };
  }
  return { elapsedMs, failStreak: 0, fired: false };
}

/** 0..1 ring-fill fraction for the current state. */
export function autoCaptureRingFraction(
  state: AutoCaptureState,
  durationMs: number = CAMERA_CONSTANTS.autoCapture.durationMs,
): number {
  return Math.min(1, state.elapsedMs / durationMs);
}
