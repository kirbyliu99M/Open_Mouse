/**
 * Pure helpers for the live camera loop's per-sample bookkeeping, split out
 * of `EasyScanCamera` so the two ways a paused loop can fire a capture on its
 * very first sample are unit-testable.
 *
 * The loop stops while the first-run tip is open and starts again when it
 * closes. Everything it carries between samples must start fresh then: a
 * stale last-sample time makes the first elapsed time as long as the pause,
 * and a stale ring timer or previous quad carries "hold still" credit from
 * before the pause into the new run.
 */
import { resetAutoCapture, type AutoCaptureState } from "./autoCapture";
import type { Quad } from "./quad";

export interface LiveLoopSampling {
  /** `performance.now()` of the previous sample; 0 = no sample yet. */
  readonly lastSampleAtMs: number;
  /** The previous sample's tracked quad, for the steadiness check. */
  readonly prevQuad: Quad | null;
  readonly autoCapture: AutoCaptureState;
}

/** The state a loop starts (or resumes) with. */
export function freshLiveLoopSampling(): LiveLoopSampling {
  return {
    lastSampleAtMs: 0,
    prevQuad: null,
    autoCapture: resetAutoCapture(),
  };
}

/**
 * Milliseconds of "continuous" time one sample may add to the auto-capture
 * ring. The first sample counts one nominal interval. A later gap is capped
 * at two intervals: a stall (a backgrounded tab, a long frame) is not time
 * the sheet was held still, so no single sample can fill the 800 ms ring.
 */
export function sampleElapsedMs(
  previousSampleAtMs: number,
  nowMs: number,
  minIntervalMs: number,
): number {
  if (previousSampleAtMs === 0) return minIntervalMs;
  return Math.min(Math.max(0, nowMs - previousSampleAtMs), 2 * minIntervalMs);
}
