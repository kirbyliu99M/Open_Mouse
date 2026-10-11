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
 * that has a floor of two. Turning it on is this one flag. The response's
 * `basis.gripStyle` is the caller's own grip either way, reported for context
 * only, and the contract texts (`recommend.ts`, `survey.ts`) say the same: the
 * grip stored with a contribution is compared only if this flag is on. Whether
 * to turn it on is Kirby's decision (未拍板).
 */
export const SIMILAR_REQUIRE_SAME_GRIP = false;

/**
 * Candidate (未拍板): the weight `m` of the prior in the ranking score, in
 * "people". The score is a Bayesian average,
 *
 *   (n * neighbourMean + m * globalMean) / (n + m),
 *
 * where n is the neighbours who rated the mouse and globalMean is the mean of
 * every neighbour rating of every mouse that at least `SIMILAR_MIN_PEOPLE`
 * neighbours rated (whether or not it makes the top five). It is one number
 * for the whole list: a mean over ratings, not over per-mouse means, and not
 * the mean the same few neighbours gave this one mouse (that would leave a
 * small pool with no prior at all). A mouse with few neighbour raters is pulled
 * toward how the neighbours rate the mice that clear the floor.
 *
 * Why not every rating of every mouse by everyone: a mouse under the floor is
 * never shown, and a person who is not a neighbour is in no neighbour count, so
 * letting either move globalMean would let a hidden rating change the order of
 * what is shown. Everything that orders the list is an aggregate of two or more
 * neighbours.
 *
 * What the pull does to the order of two mice with plain means a > b. In
 * general, a score minus globalMean is n * (mean - globalMean) / (n + m), which
 * has the sign of (mean - globalMean): a score sits on the same side of
 * globalMean as its plain mean. When globalMean lies between b and a
 * (inclusive), the score of a is at or above it and the score of b at or below
 * it, so their order never changes, whatever the two group sizes. Otherwise
 * the order can reverse, and the direction depends on the side:
 *   - globalMean below both: the smaller group is pulled toward it harder (m /
 *     (n + m) of its score is the prior), so a small group's higher mean can
 *     fall under a larger group's lower one. With m = 4, n = 2 raters at mean a
 *     against n = 8 raters at mean b, that is exactly when a + globalMean < 2b
 *     (a = 5, b = 4.6: globalMean < 4.2). With n = 10 for the larger group
 *     instead (six 5s and four 4s, mean 4.6) against two 5s, it is when
 *     globalMean < 4.25. The tests work that pair: outranked at globalMean 3.0
 *     (3.667 against 4.143), not at 4.667 (4.778 against 4.619).
 *   - globalMean above both: the same pull works the other way, and a small
 *     group's lower mean can pass a larger group's higher one. With m = 4: 50
 *     raters (ten 5s and forty 4s, mean 4.2), two raters (two 4s, mean 4.0)
 *     and, as a third mouse that lifts the prior, 100 raters (ninety 5s and ten
 *     4s, mean 4.9). globalMean = 708 / 152 = 4.658; the 50 raters score 4.234
 *     and the two raters score 4.439, so the group with the lower mean is
 *     ahead. The tests work this example.
 * globalMean is a weighted mean of the plain means of the mice that clear the
 * floor, so it is between the lowest and highest of them: with exactly two such
 * mice it is between their two means and the order never reverses; a reversal
 * needs a third mouse.
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
