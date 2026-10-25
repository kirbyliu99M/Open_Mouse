/**
 * SHADOW MODE (2026-10-19, 未拍板 candidate): how flat the four fingers of the
 * detected hand look in the photo, worked out from the 2D landmarks alone. It is
 * a pure function that nothing in the scan acts on: it blocks no photo, changes
 * no measurement, no gate and no submitted millimetre. Its only readers are the
 * local attempt log (`camera/attemptLog.ts`) and the coarse `handPose` bucket of
 * the anonymous scan events. The point is to find out, from real photos, how
 * wide the spread of ordinary flat hands is before any threshold is allowed to
 * refuse one (S4b, DESIGN-SCAN-v3).
 *
 * Two signals, both over the four fingers (thumb excluded, so a bent or spread
 * thumb changes nothing):
 *   - `reachMean`: the mean over the fingers of |knuckle to tip| / |wrist to
 *     middle knuckle|. Low: fingers curled or foreshortened by lifting; high:
 *     fingers raised or the knuckles arched.
 *   - `fingerStraightMin`: the smallest over the fingers of |knuckle to tip| /
 *     the length of the finger's own joint chain (knuckle, PIP, DIP, tip). Below
 *     1 when a finger bends sideways inside the picture.
 *
 * Both are ratios of distances in the same picture, so rotation, uniform scale
 * and a left-right mirror do not change them. Neither is a size: the
 * millimetres of a hand cannot be read back from them, and the anonymous events
 * carry only the grade, never these numbers.
 *
 * THE THRESHOLDS BELOW ARE SIMULATION CANDIDATES (R3, 2026-10-19), not a
 * population standard and not approved: they came from a synthetic hand model
 * with no real MediaPipe landmarks behind it. They move only with real photos
 * and Kirby's decision.
 */
import type { HAND_POSE_BUCKETS } from "@/lib/contracts/analytics";

export type HandPoseGrade = (typeof HAND_POSE_BUCKETS)[number];

/**
 * The cut-offs between the grades (R3 section 4.3, candidate). A value counts
 * as `extreme` only when strictly beyond an `extreme*` limit, `borderline` only
 * when strictly beyond a `borderline*` limit; a value exactly on a limit stays
 * on the milder side.
 */
export const HAND_FLATNESS_THRESHOLDS = {
  /** `extreme` below this (the candidate "would refuse" band). */
  extremeReachBelow: 0.5,
  /** `extreme` above this. */
  extremeReachAbove: 0.95,
  /** `extreme` when the least straight finger is below this. */
  extremeStraightBelow: 0.95,
  /** `borderline` below this (the candidate "would only remind" band). */
  borderlineReachBelow: 0.57,
  /** `borderline` above this. */
  borderlineReachAbove: 0.86,
  /** `borderline` when the least straight finger is below this. */
  borderlineStraightBelow: 0.98,
} as const;

export interface HandFlatness {
  readonly pose: HandPoseGrade;
  /** Mean finger reach over the palm length; `null` when `pose` is `unknown`. */
  readonly reachMean: number | null;
  /** The least straight finger's straightness, at most about 1; `null` when `pose` is `unknown`. */
  readonly fingerStraightMin: number | null;
}

interface Pt {
  readonly x: number;
  readonly y: number;
}

const UNKNOWN: HandFlatness = {
  pose: "unknown",
  reachMean: null,
  fingerStraightMin: null,
};

/** A smaller palm than this (px) is not a hand seen from above. */
const MIN_PALM_PX = 1e-6;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The grade for the two signals. Pure, so every limit can be tested on its own. */
export function gradeHandFlatness(
  reachMean: number,
  fingerStraightMin: number,
  t: typeof HAND_FLATNESS_THRESHOLDS = HAND_FLATNESS_THRESHOLDS,
): Exclude<HandPoseGrade, "unknown"> {
  if (
    reachMean < t.extremeReachBelow ||
    reachMean > t.extremeReachAbove ||
    fingerStraightMin < t.extremeStraightBelow
  ) {
    return "extreme";
  }
  if (
    reachMean < t.borderlineReachBelow ||
    reachMean > t.borderlineReachAbove ||
    fingerStraightMin < t.borderlineStraightBelow
  ) {
    return "borderline";
  }
  return "flat_like";
}

/**
 * The flatness reading of one hand's 21 landmarks in image pixels (MediaPipe's
 * order). Never throws: anything that is not 21 finite points, or a hand with no
 * palm or a finger with no length, is `unknown` with both numbers `null`.
 * Reads nothing but the landmarks it is given, so it adds no detector call.
 */
export function assessHandFlatness(
  landmarksPx: readonly Pt[] | null | undefined,
): HandFlatness {
  try {
    if (!Array.isArray(landmarksPx) || landmarksPx.length !== 21) {
      return UNKNOWN;
    }
    for (const p of landmarksPx) {
      if (
        !p ||
        typeof p.x !== "number" ||
        typeof p.y !== "number" ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y)
      ) {
        return UNKNOWN;
      }
    }
    const palm = dist(landmarksPx[0], landmarksPx[9]);
    if (!(palm > MIN_PALM_PX)) return UNKNOWN;

    let reachSum = 0;
    let straightMin = Infinity;
    for (let finger = 0; finger < 4; finger++) {
      const mcp = 5 + 4 * finger;
      const chain =
        dist(landmarksPx[mcp], landmarksPx[mcp + 1]) +
        dist(landmarksPx[mcp + 1], landmarksPx[mcp + 2]) +
        dist(landmarksPx[mcp + 2], landmarksPx[mcp + 3]);
      if (!(chain > MIN_PALM_PX)) return UNKNOWN;
      const direct = dist(landmarksPx[mcp], landmarksPx[mcp + 3]);
      reachSum += direct / palm;
      straightMin = Math.min(straightMin, direct / chain);
    }
    const reachMean = reachSum / 4;
    if (!Number.isFinite(reachMean) || !Number.isFinite(straightMin)) {
      return UNKNOWN;
    }
    return {
      pose: gradeHandFlatness(reachMean, straightMin),
      reachMean,
      fingerStraightMin: straightMin,
    };
  } catch {
    return UNKNOWN;
  }
}
