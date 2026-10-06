/**
 * The answer values the survey tests send and expect, in one place.
 *
 * The value lists (main use, size feel, duration, pain points) are IMPORTED from
 * the contract and picked by position, never written out in a test, so a
 * contract change to a list (Kirby's v3 narrows `MAIN_USES` to three values and
 * `SIZE_FEELS` to three) does not touch the tests. Positions are chosen to give
 * distinct values whether a list has the v2 length or the v3 one.
 *
 * The brands are the one thing the contract cannot supply yet: in v2 a brand is
 * free text (`otherMouse.brand`), in v3 it is a pick from a fixed list that
 * `survey.ts` will export. When v3 lands, change these four constants to
 * entries of that list and nothing else in the tests needs to move (the one v2
 * only case, a control character in the brand, is marked in
 * survey-service.test.ts).
 */
import {
  MAIN_USES,
  PAIN_POINTS,
  SIZE_FEELS,
  USE_DURATIONS,
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
export const BRAND_A = "Glorious";
export const BRAND_B = "Finalmouse";
export const BRAND_OTHER = "Other";
/** A brand no catalogue seed or copy uses, to prove it is never echoed or logged. */
export const BRAND_PRIVATE = "Zorbatron";
