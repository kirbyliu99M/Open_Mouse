/**
 * When the photo pipeline asks the paper detector a second time, with what,
 * and whether it takes the second answer (V3.2 F17 and F19, candidate 未拍板).
 *
 * F19 review (2026-10-25): the pipeline finds the hand BEFORE the sheet, and
 * its first paper call already carries the hand's 21 landmarks
 * (`paperHandHint`, the same rule as the live viewfinder), so the live
 * preview and the photo are judged by one detection. Before, the first call
 * went without the hand and the masked one followed only when the first
 * failed; a first answer that passed with the arm's edge taken for the
 * sheet's (corners 32 mm off, 模擬) was then measured from, and a frame the
 * preview read curled was measured anyway. There is no masked second call any
 * more.
 *
 * - F17: when the palm is known and the sheet found does not hold it (or
 *   none was found), it looks again with the palm (`palmPointsPx`), and with
 *   the same hand landmarks as the first call (the live viewfinder sends both
 *   together), and takes that answer only when the detector chose another
 *   region because of the palm (`reason: "palm"`).
 * A photo with no hand, or whose sheet holds the palm, is never looked at
 * twice. Pure.
 */
import type { Point2 } from "../geometry/homography";

export interface SecondLookInput {
  /** The palm's five points (`palmPointsOf`), or `null`. */
  readonly palm: readonly Point2[] | null;
  /** The first sheet holds the palm (F17's test). */
  readonly holdsPalm: boolean;
  /** The hand landmarks the first call carried (`paperHandHint`), or `null`. */
  readonly hand: readonly Point2[] | null;
}

export interface SecondLookPlan {
  readonly palmPointsPx: readonly Point2[];
  readonly handLandmarksPx?: readonly Point2[];
}

/** The options of the second call, or `null` for no second call. */
export function planSecondLook(input: SecondLookInput): SecondLookPlan | null {
  if (!input.palm || input.holdsPalm) return null;
  return {
    palmPointsPx: input.palm,
    ...(input.hand ? { handLandmarksPx: input.hand } : {}),
  };
}

export interface AdoptInput {
  /** F17: the second answer chose its region because of the palm. */
  readonly palmChose: boolean;
}

/** Whether the second answer replaces the first (only a palm choice does). */
export function adoptSecondLook(input: AdoptInput): boolean {
  return input.palmChose;
}
