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
 * The carried sheet follows the paper (Kirby, the same day: the outline
 * did not keep up with it). A miss still has its rough quad
 * (`guessCorners`); the side the forearm or the desk cuts is off, the
 * other corners are where the sheet is now. When three of its
 * corners agree on one shift (within `followPx` of it), the
 * carried sheet is moved by it, so the outline moves with the paper and a
 * moving sheet is not steady (the ring waits). A rough quad that does not
 * agree (the phone tilted or came closer, or no quad) is not carried.
 *
 * Pure: the live loop keeps the state.
 */
import type { Point2 } from "../geometry/homography";
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
    /** How far apart the corners' shifts may be, px (`sheetCarryFollowFraction` of the diagonal). */
    readonly followPx: number;
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
  const shift =
    carry && state.detection.corners && detection.guessCorners
      ? sheetShift(state.detection.corners, detection.guessCorners, input.followPx)
      : null;
  if (!state || !shift) return { state, detection, carried: false };
  // The shift is kept in the state, its age is not: a carried sample never
  // makes the sheet newer.
  const moved = shiftDetection(state.detection, shift);
  return {
    state: { atMs: state.atMs, detection: moved },
    detection: moved,
    carried: true,
  };
}

/**
 * The one shift three of the rough quad's corners agree on best (their
 * mean; the fourth is the cut one, whichever it is), or null when even
 * those are more than `followPx` from it.
 */
export function sheetShift(
  carried: readonly Point2[],
  guess: readonly Point2[],
  followPx: number,
): Point2 | null {
  const offsets = carried.map((p, i) => ({
    x: guess[i].x - p.x,
    y: guess[i].y - p.y,
  }));
  let best: { shift: Point2; spread: number } | null = null;
  for (let left = 0; left < offsets.length; left++) {
    const three = offsets.filter((_, i) => i !== left);
    const shift = {
      x: three.reduce((s, o) => s + o.x, 0) / three.length,
      y: three.reduce((s, o) => s + o.y, 0) / three.length,
    };
    const spread = Math.max(
      ...three.map((o) => Math.hypot(o.x - shift.x, o.y - shift.y)),
    );
    if (!best || spread < best.spread) best = { shift, spread };
  }
  return best && best.spread <= followPx ? best.shift : null;
}

function shiftDetection(
  detection: SheetQuadDetection,
  shift: Point2,
): SheetQuadDetection {
  const move = (p: Point2): Point2 => ({ x: p.x + shift.x, y: p.y + shift.y });
  return {
    ...detection,
    corners: detection.corners
      ? (detection.corners.map(move) as unknown as SheetQuadDetection["corners"])
      : null,
    partialCorners: detection.partialCorners.map((p) =>
      p ? move(p) : null,
    ) as unknown as SheetQuadDetection["partialCorners"],
  };
}
