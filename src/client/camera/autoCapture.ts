/**
 * Auto-capture ring timer state machine
 * (docs/design/camera-capture-2026-09-25/README.md): "once every check
 * passes continuously, a progress ring fills around the shutter over
 * 800 ms; any failure resets it." Pure reducer — the caller (the live
 * capture loop) calls `advanceAutoCapture` once per sample with the
 * elapsed time and whether every check passed on that sample.
 */
import { CAMERA_CONSTANTS } from "./constants";

export interface AutoCaptureState {
  /** Milliseconds of continuous all-pass time accumulated so far. */
  readonly elapsedMs: number;
  /** True once the ring has completed and capture should fire. Stays true (a no-op state) until the caller resets it via `resetAutoCapture` after handling the capture. */
  readonly fired: boolean;
}

export const INITIAL_AUTO_CAPTURE_STATE: AutoCaptureState = {
  elapsedMs: 0,
  fired: false,
};

export function resetAutoCapture(): AutoCaptureState {
  return INITIAL_AUTO_CAPTURE_STATE;
}

/**
 * Advance the timer by `dtMs`. Any sample where `allChecksPass` is false
 * resets the ring to empty. Once `fired` becomes true, further calls are a
 * no-op until the caller explicitly resets (e.g. after handling the
 * capture and returning to the live viewfinder).
 */
export function advanceAutoCapture(
  state: AutoCaptureState,
  allChecksPass: boolean,
  dtMs: number,
  durationMs: number = CAMERA_CONSTANTS.autoCapture.durationMs,
): AutoCaptureState {
  if (state.fired) return state;
  if (!allChecksPass) return INITIAL_AUTO_CAPTURE_STATE;
  if (dtMs < 0) {
    throw new RangeError(`advanceAutoCapture needs dtMs >= 0, got ${dtMs}.`);
  }
  const elapsedMs = state.elapsedMs + dtMs;
  if (elapsedMs >= durationMs) {
    return { elapsedMs: durationMs, fired: true };
  }
  return { elapsedMs, fired: false };
}

/** 0..1 ring-fill fraction for the current state. */
export function autoCaptureRingFraction(
  state: AutoCaptureState,
  durationMs: number = CAMERA_CONSTANTS.autoCapture.durationMs,
): number {
  return Math.min(1, state.elapsedMs / durationMs);
}
