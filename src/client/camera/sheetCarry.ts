/**
 * Carry the last sheet through the hand's misses (Kirby's S25 test,
 * 2026-10-27, candidate / 未拍板): with the wrist on the sheet's bottom
 * edge, the live detector found the sheet in about 3 of 20 samples (the
 * forearm across the edge: `aspect_mismatch`), while the photo's own
 * analysis found it every time with the wrist 1-2 mm from the edge. The cue
 * flipped between "move your wrist" and the scan, and the ring emptied
 * after each third miss, so only the shutter took the photo.
 *
 * A sample that misses the sheet at a stage the forearm causes
 * (`HAND_CUT_STAGES`) takes the last sample's sheet that had all four
 * corners, while that one is at most `carryMs` old and the hand is seen and
 * held still. A carried sample never makes the sheet newer, so a sheet that
 * stops being found stops being carried after `carryMs`. The shot's
 * analysis still finds the sheet on its own in the full-size photo.
 *
 * Pure: the live loop keeps the state.
 */
import type { PaperDetectionStage } from "../paper/detectionStage";
import type { SheetQuadDetection } from "../paper/detect";

/** The detector stages a forearm across the sheet ends in (detect.ts RETRY_STAGES). */
export const HAND_CUT_STAGES: readonly PaperDetectionStage[] = [
  "region_split",
  "aspect_mismatch",
];

export interface CarriedSheet {
  /** performance.now() of the sample that found the sheet. */
  readonly atMs: number;
  readonly detection: SheetQuadDetection;
}

export interface SheetCarryStep {
  readonly state: CarriedSheet | null;
  /** This sample's detection, or the carried one. */
  readonly detection: SheetQuadDetection;
  readonly carried: boolean;
}

export function carrySheet(
  state: CarriedSheet | null,
  input: {
    readonly nowMs: number;
    readonly detection: SheetQuadDetection;
    readonly handSeen: boolean;
    readonly handSteady: boolean;
    readonly carryMs: number;
  },
): SheetCarryStep {
  const { detection, nowMs } = input;
  if (detection.corners && detection.cornersSeen === 4)
    return {
      state: { atMs: nowMs, detection },
      detection,
      carried: false,
    };
  const age = state ? nowMs - state.atMs : Number.NaN;
  const carry =
    state !== null &&
    age >= 0 &&
    age <= input.carryMs &&
    input.handSeen &&
    input.handSteady &&
    detection.failureStage !== undefined &&
    HAND_CUT_STAGES.includes(detection.failureStage);
  return carry
    ? { state, detection: state.detection, carried: true }
    : { state, detection, carried: false };
}
