/**
 * Similar-hand engine: how people whose hand is close to the caller's rated the
 * mice. A pure function of its two arguments: no I/O, no clock, no randomness,
 * and the pool's order does not change the answer. Every number is made here
 * (AGENTS.md hard rule 2); the response shape is `similarResponseSchema`
 * (`src/lib/contracts/recommend.ts`).
 *
 * Rules, all candidates (未拍板) unless the contract fixes them; the tunable
 * numbers are in `constants.ts`:
 *   1. The hand space is cut into fixed cells: hand length every
 *      `SIMILAR_HAND_LENGTH_CELL_MM` (20 mm) and palm width every
 *      `SIMILAR_PALM_WIDTH_CELL_MM` (10 mm), on a grid anchored at 0. A cell
 *      includes its lower edge and excludes its upper one (hand lengths 180 to
 *      199 mm are one cell, 200 to 219 mm the next), so each stored bin is in
 *      exactly one. A neighbour is a contributor, not the caller (any id in
 *      `ownContributionIds`), whose stored hand length bin and palm width bin
 *      fall in the same cells as the caller's own bins (and, if
 *      `SIMILAR_REQUIRE_SAME_GRIP`, whose grip is the caller's). There is no
 *      radius: a person 5 mm away across a grid line is not a neighbour, and a
 *      person 15 mm away in the same cell is.
 *   2. A mouse's `raters` is the neighbours who rated it and its
 *      `meanSatisfaction` is their plain mean. It is never the ranking score.
 *   3. Mice are ranked by a Bayesian average toward one number for the whole
 *      list: the mean of every neighbour rating of every mouse that at least
 *      `SIMILAR_MIN_PEOPLE` neighbours rated (a plain mean over ratings,
 *      whether or not that mouse makes the top `MAX_SIMILAR_MICE`). So every
 *      number that orders the list comes from an aggregate of at least
 *      `SIMILAR_MIN_PEOPLE` neighbours: the ratings of a mouse that fewer than `SIMILAR_MIN_PEOPLE`
 *      neighbours rated, and of people who are not neighbours, move nothing.
 *      Ties go to more raters, then to the slug in code-unit order.
 *   4. The floor `SIMILAR_MIN_PEOPLE` (contract): under it, neighbours are not
 *      enough, a mouse is not listed, and with nothing left to list the answer
 *      is `available: false`, never a guess.
 *   5. The caller's own contributions are left out of everything, the prior
 *      too, so the answer cannot depend on, or give back, what the caller said.
 *
 * What the fixed cells stop, and what they do not (Kirby approved fixed cells
 * and the floor of 5 on 2026-10-20, candidates until a formal meeting):
 *
 * - Subtracting two overlapping windows. With a window that followed the
 *   caller (hand length +-10 mm, palm width +-5 mm) a caller who picked their
 *   own outline could ask twice, one bin apart, and the two groups of
 *   neighbours differed by one person. Example: hands of 170, 175, 180 and
 *   190 mm rating 4, 5, 2 and 1; a caller at 180 mm got 4 raters, mean 3, and
 *   a caller at 175 mm got 3 raters, mean 3.6667; 4 * 3 - 3 * 3.6667 = 1, the
 *   rating of the 190 mm hand. With fixed cells every position inside a cell
 *   gets the same answer (the neighbours depend on the cell, not on where in
 *   it the caller is; only `basis` repeats the caller's own bin), and two
 *   different cells share nobody, so no two queries differ by a single person,
 *   and a cell with fewer than `SIMILAR_MIN_PEOPLE` people says nothing at all.
 *   The caller's own contributions are the one thing that differs between two
 *   callers of the same cell, and the caller knows those already.
 * - The mean is not coarsened, and the floor is not airtight. A caller who
 *   controls `SIMILAR_MIN_PEOPLE - 1` accounts in one cell that rated one
 *   mouse (four, with a floor of 5) and the one other person who did can work
 *   that person's rating out from the shown mean. Fixed cells do not change
 *   this and neither does a higher floor; it only costs more accounts. Never
 *   claim that a single contributor cannot be worked out. Options if that is
 *   ever not enough: a coarser mean, probe limits, a higher floor.
 *
 * What the caller of this function must do (checked 2026-10-09 against the
 * planned catalogue growth: more brands, `listed = false` for the Logitech mice
 * that are neither G nor MX): the function takes every rating it is given as
 * valid and knows nothing about the catalogue. So the route that calls it
 * hands over only ratings of mice this caller may be shown: it drops unlisted
 * mice and the mice the fit excludes for this caller (hand, form factor) BEFORE
 * the call. Left in, they would be listed and would also move the prior. It
 * takes brand and model from the current `mice` row by `mouse_id` (a rating
 * stores no name), and never deletes a `mice` row (`survey_ratings.mouse_id`
 * cascades). The size of the catalogue does not matter to this function; the
 * size of the pool does.
 */
import type { GripStyle } from "../../lib/contracts/fit";
import {
  MAX_SIMILAR_MICE,
  SIMILAR_MIN_PEOPLE,
  type SimilarMouse,
  type SimilarResponse,
} from "../../lib/contracts/recommend";
import { CONTRIBUTION_BIN_MM } from "../../lib/contracts/survey";
import {
  SIMILAR_HAND_LENGTH_CELL_MM,
  SIMILAR_PALM_WIDTH_CELL_MM,
  SIMILAR_PRIOR_WEIGHT,
  SIMILAR_REQUIRE_SAME_GRIP,
  SIMILAR_SCORE_TIE_EPSILON,
} from "./constants";

/** One rating of one catalogue mouse inside a contribution. */
export interface ContributedRating {
  slug: string;
  brand: string;
  model: string;
  /**
   * The survey's whole numbers 1 to 5 (`satisfaction` in `survey.ts`). Anything
   * else, a fraction included, is ignored, not clamped or rounded.
   */
  satisfaction: number;
}

/** One contribution: a coarse hand profile and the mice that person rated. */
export interface Contribution {
  /** Used to leave the caller's own contributions out. Unique in the pool. */
  id: string;
  /** Hand length rounded down to `CONTRIBUTION_BIN_MM`. */
  handLengthBinMm: number;
  /** Palm width rounded down to `CONTRIBUTION_BIN_MM`. */
  palmWidthBinMm: number;
  gripStyle: GripStyle;
  ratings: ReadonlyArray<ContributedRating>;
}

export interface Caller {
  /** The caller's own hand profile, in bins (multiples of `CONTRIBUTION_BIN_MM`). */
  handLengthBinMm: number;
  palmWidthBinMm: number;
  gripStyle: GripStyle;
  /**
   * Every contribution that is this person's, including the ones made under
   * their signed-in account from other scans. All of them are left out.
   */
  ownContributionIds: ReadonlySet<string>;
}

/**
 * The candidate rules as one value, so a test can run the engine under another
 * setting. The server passes none: it gets `DEFAULT_SIMILAR_RULES`, which is
 * `constants.ts`. The floor on people is not here; it is the contract's.
 */
export interface SimilarRules {
  /** Width of one hand length cell, in mm (a grid anchored at 0). */
  handLengthCellMm: number;
  /** Width of one palm width cell, in mm. */
  palmWidthCellMm: number;
  requireSameGrip: boolean;
  priorWeight: number;
}

export const DEFAULT_SIMILAR_RULES: SimilarRules = {
  handLengthCellMm: SIMILAR_HAND_LENGTH_CELL_MM,
  palmWidthCellMm: SIMILAR_PALM_WIDTH_CELL_MM,
  requireSameGrip: SIMILAR_REQUIRE_SAME_GRIP,
  priorWeight: SIMILAR_PRIOR_WEIGHT,
};

/** What the engine knows about one mouse among one set of contributors. */
interface MouseTally {
  brand: string;
  model: string;
  /** Satisfactions, one per contributor. */
  values: number[];
}

const unavailable = (): SimilarResponse => ({
  available: false,
  reason: "insufficient_data",
});

const onBin = (mm: number): boolean =>
  Number.isInteger(mm) && mm % CONTRIBUTION_BIN_MM === 0;

/** Code-unit order: the same in every runtime and locale (not `localeCompare`). */
const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Sum in ascending order, so the same numbers give the same float whatever
 * order the contributors came in. Ratings are whole numbers (a fraction is
 * ignored), so a sum is exact in any order anyway; the sort is a guard that
 * costs nothing.
 */
function orderFreeSum(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b).reduce((sum, v) => sum + v, 0);
}

/**
 * The ratings of one contribution, one per slug. A rating that is not a whole
 * number from 1 to 5 is ignored (`Number.isInteger` is false for NaN and the
 * infinities). A slug named twice in one contribution is ambiguous (the survey
 * contract allows one rating per mouse), and picking one of the two would be a
 * guess, so that contributor's answer for that mouse is left out.
 */
function ratingsBySlug(
  contribution: Contribution,
): Map<string, ContributedRating> {
  const seen = new Map<string, ContributedRating>();
  const ambiguous = new Set<string>();
  for (const rating of contribution.ratings) {
    if (
      !Number.isInteger(rating.satisfaction) ||
      rating.satisfaction < 1 ||
      rating.satisfaction > 5
    ) {
      continue;
    }
    if (seen.has(rating.slug)) ambiguous.add(rating.slug);
    else seen.set(rating.slug, rating);
  }
  for (const slug of ambiguous) seen.delete(slug);
  return seen;
}

/** Add every rating of `contributions` to a per-slug tally. */
function tally(
  contributions: readonly Contribution[],
): Map<string, MouseTally> {
  const bySlug = new Map<string, MouseTally>();
  for (const contribution of contributions) {
    for (const rating of ratingsBySlug(contribution).values()) {
      const entry = bySlug.get(rating.slug);
      if (entry === undefined) {
        bySlug.set(rating.slug, {
          brand: rating.brand,
          model: rating.model,
          values: [rating.satisfaction],
        });
        continue;
      }
      entry.values.push(rating.satisfaction);
      // A slug is the key, so its brand and model should agree everywhere. If
      // they do not, the smaller pair wins, so the order of the pool cannot
      // decide which name a visitor sees.
      const nameOrder =
        compareText(rating.brand, entry.brand) ||
        compareText(rating.model, entry.model);
      if (nameOrder < 0) {
        entry.brand = rating.brand;
        entry.model = rating.model;
      }
    }
  }
  return bySlug;
}

/**
 * The Bayesian average used only to order mice: `n` neighbour raters with plain
 * mean `neighbourMean`, pulled toward `priorMean` (the engine passes the mean of
 * every neighbour rating of every mouse that cleared the floor) by
 * `priorWeight` people's worth. Never shown to a visitor.
 */
export function shrunkScore(
  n: number,
  neighbourMean: number,
  priorMean: number,
  priorWeight: number = SIMILAR_PRIOR_WEIGHT,
): number {
  return (n * neighbourMean + priorWeight * priorMean) / (n + priorWeight);
}

/**
 * The fixed cell a size falls in: the grid is anchored at 0, a cell includes its
 * lower edge and excludes its upper one, so 180 and 199 are in cell 9 (cell
 * width 20) and 200 is in cell 10. NaN, a missing value and the infinities give
 * a cell that is NaN or infinite and is never equal to a finite cell (`NaN` is
 * not equal to anything, itself included).
 */
const cellOf = (mm: number, cellMm: number): number => Math.floor(mm / cellMm);

/**
 * True when `candidate` is a neighbour of `caller` under the rules above: the
 * same hand length cell, the same palm width cell and, if the rule says so, the
 * same grip.
 *
 * Each size is tested with `===` on a cell, never as "not in a different cell":
 * a bin that is NaN or missing gives a cell that equals nothing, so it is out,
 * while testing "different cell" and excluding on that would take such a
 * contributor in as a neighbour.
 */
function isNeighbour(
  caller: Caller,
  candidate: Contribution,
  rules: SimilarRules,
): boolean {
  const sameHandCell =
    cellOf(candidate.handLengthBinMm, rules.handLengthCellMm) ===
    cellOf(caller.handLengthBinMm, rules.handLengthCellMm);
  if (!sameHandCell) return false;
  const samePalmCell =
    cellOf(candidate.palmWidthBinMm, rules.palmWidthCellMm) ===
    cellOf(caller.palmWidthBinMm, rules.palmWidthCellMm);
  if (!samePalmCell) return false;
  return !rules.requireSameGrip || candidate.gripStyle === caller.gripStyle;
}

/**
 * How the neighbours of `caller` in `pool` rated the mice. `available: false`
 * (`insufficient_data`) when too few people stand behind an answer.
 *
 * Throws a `RangeError` when the caller's hand profile is not on the bins: the
 * server rounds it down before asking, and the response repeats it back as
 * `basis`, which the contract requires to be on the bins. NaN or a value that
 * is not a multiple of the bin size would otherwise match nobody and look like
 * missing data.
 */
export function similarHands(
  caller: Caller,
  pool: readonly Contribution[],
  rules: SimilarRules = DEFAULT_SIMILAR_RULES,
): SimilarResponse {
  if (!onBin(caller.handLengthBinMm) || !onBin(caller.palmWidthBinMm)) {
    throw new RangeError(
      `caller hand profile must be whole multiples of ${CONTRIBUTION_BIN_MM} mm`,
    );
  }

  const others = pool.filter((c) => !caller.ownContributionIds.has(c.id));
  const neighbours = others.filter((c) => isNeighbour(caller, c, rules));
  if (neighbours.length < SIMILAR_MIN_PEOPLE) return unavailable();

  // The mice that enough neighbours rated, whether or not they make the top
  // `MAX_SIMILAR_MICE`. A mouse under the floor is never shown, so what its one
  // rater said must not move anything that is.
  const listable = [...tally(neighbours)].filter(
    ([, near]) => near.values.length >= SIMILAR_MIN_PEOPLE,
  );
  if (listable.length === 0) return unavailable();

  // The prior: one mean over every valid neighbour rating of those mice, so a
  // mean of ratings, not of per-mouse means. It is made of aggregates of at least
  // `SIMILAR_MIN_PEOPLE` neighbours only: the ratings of a mouse under the floor, of someone
  // who is not a neighbour, and of the caller are all outside it. `tally`'s
  // filter is the only one, so what counts as a valid rating is the same here
  // as in the per-mouse numbers. `listable` is not empty and each of its mice
  // has at least `SIMILAR_MIN_PEOPLE` ratings, so the division below is never by zero.
  const priorRatings = listable.flatMap(([, near]) => near.values);
  const globalMean = orderFreeSum(priorRatings) / priorRatings.length;

  const ranked: Array<{
    mouse: SimilarMouse;
    score: number;
  }> = [];
  for (const [slug, near] of listable) {
    const raters = near.values.length;
    const meanSatisfaction = orderFreeSum(near.values) / raters;
    ranked.push({
      mouse: {
        slug,
        brand: near.brand,
        model: near.model,
        raters,
        meanSatisfaction,
      },
      score: shrunkScore(
        raters,
        meanSatisfaction,
        globalMean,
        rules.priorWeight,
      ),
    });
  }

  ranked.sort((a, b) => {
    const byScore = b.score - a.score;
    if (Math.abs(byScore) > SIMILAR_SCORE_TIE_EPSILON) return byScore;
    return (
      b.mouse.raters - a.mouse.raters || compareText(a.mouse.slug, b.mouse.slug)
    );
  });

  // `ranked` has every listable mouse, so it is not empty, and the answer has
  // at least one mouse (the schema's minimum).
  return {
    available: true,
    neighbours: neighbours.length,
    basis: {
      handLengthBinMm: caller.handLengthBinMm,
      palmWidthBinMm: caller.palmWidthBinMm,
      gripStyle: caller.gripStyle,
    },
    mice: ranked.slice(0, MAX_SIMILAR_MICE).map((r) => r.mouse),
  };
}
