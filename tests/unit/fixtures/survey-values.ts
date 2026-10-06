/**
 * The answer values the survey tests send and expect, in one place.
 *
 * The value lists (main use, size feel, duration, pain points) are IMPORTED from
 * the contract and picked by position, never written out in a test, so a
 * contract change to a list does not touch the tests. Contract v3 narrowed
 * `MAIN_USES` and `SIZE_FEELS` to three values each, so the positions below must
 * stay within the first three: no test may assume a fourth value exists.
 *
 * The brands are slugs of the contract's `OTHER_MOUSE_BRANDS` (v3: a pick from a
 * list, not free text). They are written as literals that `satisfies` the
 * contract's type, so a list that drops one fails the typecheck on this file
 * and names what to change. Nothing here relies on a brand being matched
 * loosely: a slug is stored and compared exactly as given.
 */
import {
  MAIN_USES,
  PAIN_POINTS,
  SIZE_FEELS,
  USE_DURATIONS,
  type OtherMouseBrand,
} from "../../../src/lib/contracts/survey";

/** Two different main uses. */
export const USE_A = MAIN_USES[0];
export const USE_B = MAIN_USES[1];

/** The smallest, the middle and the largest size feel. */
export const FEEL_SMALL = SIZE_FEELS[0];
export const FEEL_RIGHT = SIZE_FEELS[Math.floor((SIZE_FEELS.length - 1) / 2)];
export const FEEL_LARGE = SIZE_FEELS[SIZE_FEELS.length - 1];

/** Two different durations. */
export const DURATION_A = USE_DURATIONS[3];
export const DURATION_B = USE_DURATIONS[USE_DURATIONS.length - 1];

/** Two different pain points. */
export const PAIN_A = PAIN_POINTS[3];
export const PAIN_B = PAIN_POINTS[4];

/** Brands of a mouse that is not in the catalogue (see the header). */
export const BRAND_A = "glorious" satisfies OtherMouseBrand;
export const BRAND_B = "finalmouse" satisfies OtherMouseBrand;
/** The catch-all slug: every brand that is not listed is this one. */
export const BRAND_OTHER = "other" satisfies OtherMouseBrand;
/**
 * A brand no catalogue seed or copy uses, with an underscore no sentence of
 * ours has, to prove it is never echoed or logged.
 */
export const BRAND_PRIVATE = "endgame_gear" satisfies OtherMouseBrand;
