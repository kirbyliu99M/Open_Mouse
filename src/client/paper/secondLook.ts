/**
 * When the photo pipeline asks the paper detector a second time, with what,
 * and whether it takes the second answer (V3.2 F17 and F19, candidate 未拍板).
 *
 * The pipeline runs the detector once without the hand, then finds the hand.
 * - F17: when the palm is known and the sheet found does not hold it (or
 *   none was found), it looks again with the palm (`palmPointsPx`), and takes
 *   that answer only when the detector chose another region because of the
 *   palm (`reason: "palm"`).
 * - F19: when the hand is known and the first answer failed a paper check
 *   (no four corners, or a paper gate refused it), it looks again with the
 *   hand's 21 landmarks (`handLandmarksPx`), so points under the hand and arm
 *   are left out and pieces the arm cut apart are joined. That answer is
 *   taken when it passes the paper checks, or when the first had no four
 *   corners and the second has.
 * Both go in one second call when both apply. A photo with no hand, or whose
 * sheet held the palm and passed, is never looked at twice, so its result is
 * exactly what it was. Pure.
 */
import type { Point2 } from "../geometry/homography";

export interface SecondLookInput {
  /** The first answer had all four corners. */
  readonly firstHasCorners: boolean;
  /** The first answer passed every paper check (found, corners, coverage, flat). */
  readonly firstOk: boolean;
  /** The palm's five points (`palmPointsOf`), or `null`. */
  readonly palm: readonly Point2[] | null;
  /** The first sheet holds the palm (F17's test). */
  readonly holdsPalm: boolean;
  /** The hand's 21 landmarks (`handLandmarksOf`), or `null`. */
  readonly hand: readonly Point2[] | null;
}

export interface SecondLookPlan {
  readonly palmPointsPx?: readonly Point2[];
  readonly handLandmarksPx?: readonly Point2[];
}

/** The options of the second call, or `null` for no second call. */
export function planSecondLook(input: SecondLookInput): SecondLookPlan | null {
  const palm = input.palm && !input.holdsPalm ? input.palm : null;
  const hand =
    input.hand && (!input.firstHasCorners || !input.firstOk)
      ? input.hand
      : null;
  if (!palm && !hand) return null;
  return {
    ...(palm ? { palmPointsPx: palm } : {}),
    ...(hand ? { handLandmarksPx: hand } : {}),
  };
}

export interface AdoptInput {
  readonly plan: SecondLookPlan;
  /** F17: the second answer chose its region because of the palm. */
  readonly palmChose: boolean;
  readonly firstHasCorners: boolean;
  readonly secondHasCorners: boolean;
  /** The second answer passed every paper check. */
  readonly secondOk: boolean;
}

/** Whether the second answer replaces the first. */
export function adoptSecondLook(input: AdoptInput): boolean {
  if (input.plan.palmPointsPx && input.palmChose) return true;
  if (!input.plan.handLandmarksPx) return false;
  if (input.secondOk) return true;
  return !input.firstHasCorners && input.secondHasCorners;
}
