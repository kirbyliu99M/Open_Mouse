/**
 * Tunable numbers of the similar-hand engine (`neighbours.ts`). Every one is a
 * candidate (未拍板): none was decided in a formal meeting, and Kirby may change
 * any of them. They live here, and nowhere else, so a change is one line.
 *
 * Not in this file on purpose: the floor on how many people stand behind a
 * count or a mean (`SIMILAR_MIN_PEOPLE`) and the cap on the mice listed
 * (`MAX_SIMILAR_MICE`). They are part of the contract's shape
 * (`src/lib/contracts/recommend.ts`), and the response schema rejects a
 * response that goes under the floor. Whether the floor stays is Kirby's
 * decision (未拍板) and a contract PR; this file must not carry a second copy
 * of it that could drift.
 */
import { CONTRIBUTION_BIN_MM } from "../../lib/contracts/survey";

/**
 * Candidate (未拍板): how far a contributor's hand length may be from the
 * caller's, in bins, to count as a neighbour. 2 bins = 10 mm.
 *
 * Why: the scan's hand length range (100 to 280 mm) is wider than the palm
 * width range (50 to 150 mm), so length gets the wider radius. That is a
 * judgement, not a number measured from contributions: there is no data yet to
 * fit one against. With little data, a radius this wide also keeps the pool big
 * enough to reach the floor of people.
 */
export const SIMILAR_HAND_LENGTH_RADIUS_BINS = 2;

/**
 * Candidate (未拍板): the same for palm width, in bins. 1 bin = 5 mm. The
 * narrower of the two radii, with the same caveat: it is a judgement, not
 * something fitted to data.
 */
export const SIMILAR_PALM_WIDTH_RADIUS_BINS = 1;

/** The two radii in millimetres: what the engine compares a difference with. */
export const SIMILAR_HAND_LENGTH_RADIUS_MM =
  SIMILAR_HAND_LENGTH_RADIUS_BINS * CONTRIBUTION_BIN_MM;
export const SIMILAR_PALM_WIDTH_RADIUS_MM =
  SIMILAR_PALM_WIDTH_RADIUS_BINS * CONTRIBUTION_BIN_MM;

/**
 * Candidate (未拍板): whether a neighbour must use the caller's grip.
 *
 * Off: the pool is small, and each extra filter takes people away from a count
 * that has a floor of two. Turning it on is this one flag. Note that the
 * response's `basis.gripStyle` is the caller's grip either way, and that
 * `survey.ts` says the grip "is what the similar-hand answer matches on", which
 * reads as if the grip were a filter. If it stays off, one of the two texts
 * should change (a contract PR, Kirby's call).
 */
export const SIMILAR_REQUIRE_SAME_GRIP = false;

/**
 * Candidate (未拍板): the weight `m` of the prior in the ranking score, in
 * "people". The score is a Bayesian average,
 *
 *   (n * neighbourMean + m * everyoneMean) / (n + m),
 *
 * where n is the neighbours who rated the mouse and everyoneMean is the mean of
 * every contributor's rating of it. A mouse with few neighbour raters is pulled
 * toward what everyone said, so two 5s do not outrank eight 4.6s.
 *
 * Why 4: it is twice the floor of two, so a mouse that only just clears the
 * floor gets one third of its weight from its own neighbours, and a mouse with
 * eight raters gets two thirds. It is a taste for how fast to trust a small
 * group, not a fitted value. It must be a positive number (not necessarily a
 * whole one).
 *
 * The score only orders the list. The mean a visitor sees is always the plain
 * mean of the neighbours' ratings, never this score.
 */
export const SIMILAR_PRIOR_WEIGHT = 4;

/**
 * Not a candidate, a numerical guard: two ranking scores closer than this are a
 * tie, so that two scores that are equal on paper but differ in the last bit of
 * a float do not decide the order. A tie falls through to more raters, then to
 * the slug.
 */
export const SIMILAR_SCORE_TIE_EPSILON = 1e-9;
