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
 * Candidate (未拍板, Kirby approved the direction 2026-10-20): the width of one
 * fixed hand length cell, in millimetres. Cells sit on a grid anchored at 0 and
 * a cell holds the lengths from its lower edge up to, but not including, the
 * next one: 180 to 199 mm is one cell, 200 to 219 mm the next. The caller and
 * every contributor are put in the cell their own stored bin falls in, and only
 * people of the same cell are neighbours.
 *
 * Why fixed cells and not a window around each caller: windows that follow the
 * caller overlap, so a caller who picks their outline can ask twice, one bin
 * apart, and subtract the two answers to recover one person's rating. Within a
 * fixed cell every position gives the very same answer, and two different cells
 * share nobody, so two queries never differ by a single person.
 *
 * Why 20: it is the width of the window this replaced (+-10 mm), so the pool a
 * caller draws on stays about the same size. The scan's hand length range (100
 * to 280 mm) is wider than the palm width range (50 to 150 mm), so length gets
 * the wider cell. That is a judgement, not a number fitted to data. It must be
 * a positive multiple of `CONTRIBUTION_BIN_MM`, so that no bin straddles a
 * grid line.
 */
export const SIMILAR_HAND_LENGTH_CELL_MM = 4 * CONTRIBUTION_BIN_MM;

/**
 * Candidate (未拍板): the same for palm width, in millimetres, with the same
 * grid and the same lower-edge-in, upper-edge-out rule: 90 to 99 mm is one
 * cell. 10 is the width of the window this replaced (+-5 mm).
 */
export const SIMILAR_PALM_WIDTH_CELL_MM = 2 * CONTRIBUTION_BIN_MM;

/**
 * Candidate (未拍板): whether a neighbour must use the caller's grip.
 *
 * Off: the pool is small, and each extra filter takes people away from a count
 * that has a floor of `SIMILAR_MIN_PEOPLE` people. Turning it on is this one
 * flag. The response's `basis.gripStyle` is the caller's own grip either way, reported for context
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
 * what is shown. Everything that orders the list is an aggregate of
 * `SIMILAR_MIN_PEOPLE` or more neighbours.
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
 *     fall under a larger group's lower one. With m = 4, n = 5 raters at mean a
 *     against n = 20 raters at mean b, that is exactly when
 *     24 * (5a + 4g) < 9 * (20b + 4g), g being globalMean. For five 5s against
 *     sixteen 5s and four 4s (mean 4.8) it is when globalMean < 4.4. The tests
 *     work that pair: outranked at globalMean 4.2 (4.644 against 4.7), not at
 *     4.84 (4.929 against 4.807).
 *   - globalMean above both: the same pull works the other way, and a small
 *     group's lower mean can pass a larger group's higher one. With m = 4: 50
 *     raters (ten 5s and forty 4s, mean 4.2), five raters (five 4s, mean 4.0)
 *     and, as a third mouse that lifts the prior, 100 raters (ninety 5s and ten
 *     4s, mean 4.9). globalMean = 720 / 155 = 4.645; the 50 raters score 4.233
 *     and the five raters score 4.287, so the group with the lower mean is
 *     ahead. The tests work this example.
 * globalMean is a weighted mean of the plain means of the mice that clear the
 * floor, so it is between the lowest and highest of them: with exactly two such
 * mice it is between their two means and the order never reverses; a reversal
 * needs a third mouse.
 *
 * Why 4: it is a little under the floor of five, so a mouse that only just
 * clears the floor gets 4/9 of its weight from the prior and 5/9 from its own
 * neighbours, and a mouse with twenty raters gets five sixths from its own. It
 * is a taste for how fast to trust a small group, not a fitted value (and it
 * was picked when the floor was two; the floor of five was not a reason to
 * change it). It must be a positive number (not necessarily a whole one).
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
