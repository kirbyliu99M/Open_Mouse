/**
 * The pose check for kit v2: from a photo's 21 hand landmarks in image space,
 * does the hand look like G02 (flat, fingers spread) or like G04 (claw:
 * fingertips curled towards the palm)?
 *
 * The pose of a kit v2 photo comes from the shooting order, not from this.
 * The check is a flag: it never moves a photo to another pose. Its one other
 * use is to decide where a participant's single extra shot goes (see
 * `sortv2.ts`), and when it cannot say it abstains (`null`), and the sorter
 * then sends that participant to review instead of guessing.
 *
 * It uses ratios only, never absolute pixels, so the distance of the phone, the
 * zoom, the image size and the hand's size and rotation in the frame do not
 * matter. The one measure is the reach of the four long fingers:
 *
 *     reach = mean over index, middle, ring, little finger of
 *             |fingertip - finger's MCP| / |wrist - middle finger's MCP|
 *
 * Seen from above, a flat hand shows each finger at nearly full length. In a
 * claw the knuckles are raised and the fingertips point down towards the palm,
 * so the same fingers are foreshortened and their tips sit much closer to
 * their knuckles. The spread of the fingers is not used: a flat hand with the
 * fingers together has the same reach as one with them spread, and is read as
 * flat (G02). The check separates flat from curled, not spread from together.
 *
 * MediaPipe landmark indices: 0 wrist; 5, 9, 13, 17 the MCP (knuckle) of the
 * index, middle, ring and little finger; 8, 12, 16, 20 their fingertips.
 *
 * Pure.
 */
import type { Point2 } from "../../client/geometry/homography";

/**
 * CANDIDATE thresholds, set from the proportions of an adult hand and not yet
 * from any photo. S0 (the pilot, P901 to P912) will check them against real
 * G02 and G04 photos before any run is trusted; until then a call is a flag,
 * never a fact. They live here and nowhere else, so S0 changes one place.
 *
 * Reasoning: an adult flat hand has a finger (MCP to tip) about 0.6 to 0.8 of
 * the palm length (wrist to middle MCP), a little finger the shortest, so the
 * mean over four fingers is near 0.7. A claw seen from above shortens each
 * finger to roughly 0.3 to 0.5 of that. The band between the two is where the
 * check abstains.
 */
export const POSE_CHECK_THRESHOLDS = {
  /** Mean reach at or above this reads as flat: G02. */
  flatReachMin: 0.62,
  /** Mean reach at or below this reads as curled: G04. */
  clawReachMax: 0.5,
  /** Above this the points cannot be one hand (a finger longer than the palm and a half): abstain. */
  maxPlausibleReach: 1.5,
} as const;

const WRIST = 0;
const MIDDLE_MCP = 9;
/** [MCP, fingertip] of the index, middle, ring and little finger. */
const FINGERS = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
] as const;
const LANDMARK_COUNT = 21;

export type PoseGuess = "G02" | "G04";

export type PoseCheckReason =
  /** Reach at or above `flatReachMin`. */
  | "flat"
  /** Reach at or below `clawReachMax`. */
  | "claw"
  /** Between the two thresholds: not sure, abstain. */
  | "between"
  /** No hand, or not 21 landmarks. */
  | "no-hand"
  /** A landmark is not a finite number, or the palm has no length. */
  | "degenerate"
  /** The ratio is beyond `maxPlausibleReach`. */
  | "implausible";

export interface PoseClassification {
  /** `null` when the check abstains. */
  readonly predicted: PoseGuess | null;
  /** The mean reach the call rests on; `null` when it could not be worked out. */
  readonly reach: number | null;
  readonly reason: PoseCheckReason;
}

const abstain = (
  reason: PoseCheckReason,
  reach: number | null = null,
): PoseClassification => ({ predicted: null, reach, reason });

const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Classify one photo's landmarks. Never throws; abstains when unsure or when there is no hand. */
export function classifyPose(
  landmarksPx: readonly Point2[] | null | undefined,
): PoseClassification {
  if (!landmarksPx || landmarksPx.length !== LANDMARK_COUNT) {
    return abstain("no-hand");
  }
  for (const p of landmarksPx) {
    if (
      !p ||
      typeof p.x !== "number" ||
      typeof p.y !== "number" ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    ) {
      return abstain("degenerate");
    }
  }
  const palm = dist(landmarksPx[WRIST]!, landmarksPx[MIDDLE_MCP]!);
  if (!(palm > 0)) return abstain("degenerate");

  let sum = 0;
  for (const [mcp, tip] of FINGERS) {
    sum += dist(landmarksPx[tip]!, landmarksPx[mcp]!) / palm;
  }
  const reach = sum / FINGERS.length;
  if (!Number.isFinite(reach)) return abstain("degenerate");
  if (reach > POSE_CHECK_THRESHOLDS.maxPlausibleReach) {
    return abstain("implausible", reach);
  }
  if (reach >= POSE_CHECK_THRESHOLDS.flatReachMin) {
    return { predicted: "G02", reach, reason: "flat" };
  }
  if (reach <= POSE_CHECK_THRESHOLDS.clawReachMax) {
    return { predicted: "G04", reach, reason: "claw" };
  }
  return abstain("between", reach);
}

/**
 * Does the check's call agree with the pose the shooting order gave this
 * photo? `null` when the check abstained or the order's pose is not one it
 * knows (only G02 and G04 are taken in kit v2).
 */
export function poseAgrees(
  predicted: PoseGuess | null,
  expected: string | null,
): boolean | null {
  if (predicted === null) return null;
  if (expected !== "G02" && expected !== "G04") return null;
  return predicted === expected;
}
