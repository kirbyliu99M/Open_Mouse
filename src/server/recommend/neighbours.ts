/**
 * Similar-hand engine: how people whose hand is close to the caller's rated the
 * mice. A pure function of its two arguments: no I/O, no clock, no randomness,
 * and the pool's order does not change the answer. Every number is made here
 * (AGENTS.md hard rule 2); the response shape is `similarResponseSchema`
 * (`src/lib/contracts/recommend.ts`).
 *
 * Rules, all candidates (未拍板) unless the contract fixes them; the tunable
 * numbers are in `constants.ts`:
 *   1. A neighbour is a contributor, not the caller (any id in
 *      `ownContributionIds`), whose hand length is within
 *      `SIMILAR_HAND_LENGTH_RADIUS_MM` and palm width within
 *      `SIMILAR_PALM_WIDTH_RADIUS_MM` of the caller's (and, if
 *      `SIMILAR_REQUIRE_SAME_GRIP`, whose grip is the caller's).
 *   2. A mouse's `raters` is the neighbours who rated it and its
 *      `meanSatisfaction` is their plain mean. It is never the ranking score.
 *   3. Mice are ranked by a Bayesian average toward the mean of every rating
 *      of every mouse by every contributor (the caller's own ones left out),
 *      one number for the whole list; ties go to more raters, then to the slug
 *      in code-unit order.
 *   4. The floor `SIMILAR_MIN_PEOPLE` (contract): under it, neighbours are not
 *      enough, a mouse is not listed, and with nothing left to list the answer
 *      is `available: false`, never a guess.
 *   5. The caller's own contributions are left out of everything, the prior
 *      too, so the answer cannot depend on, or give back, what the caller said.
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
  SIMILAR_HAND_LENGTH_RADIUS_MM,
  SIMILAR_PALM_WIDTH_RADIUS_MM,
  SIMILAR_PRIOR_WEIGHT,
  SIMILAR_REQUIRE_SAME_GRIP,
  SIMILAR_SCORE_TIE_EPSILON,
} from "./constants";

/** One rating of one catalogue mouse inside a contribution. */
export interface ContributedRating {
  slug: string;
  brand: string;
  model: string;
  /** The survey's 1 to 5 scale. Anything else is ignored, not clamped. */
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
  handLengthRadiusMm: number;
  palmWidthRadiusMm: number;
  requireSameGrip: boolean;
  priorWeight: number;
}

export const DEFAULT_SIMILAR_RULES: SimilarRules = {
  handLengthRadiusMm: SIMILAR_HAND_LENGTH_RADIUS_MM,
  palmWidthRadiusMm: SIMILAR_PALM_WIDTH_RADIUS_MM,
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
 * order the contributors came in.
 */
function orderFreeSum(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b).reduce((sum, v) => sum + v, 0);
}

/**
 * The ratings of one contribution, one per slug. A rating off the 1 to 5 scale
 * is ignored. A slug named twice in one contribution is ambiguous (the survey
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
      !Number.isFinite(rating.satisfaction) ||
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
 * every rating of every mouse, the caller's own left out) by `priorWeight`
 * people's worth. Never shown to a visitor.
 */
export function shrunkScore(
  n: number,
  neighbourMean: number,
  priorMean: number,
  priorWeight: number = SIMILAR_PRIOR_WEIGHT,
): number {
  return (n * neighbourMean + priorWeight * priorMean) / (n + priorWeight);
}

/** True when `candidate` is a neighbour of `caller` under the rules above. */
function isNeighbour(
  caller: Caller,
  candidate: Contribution,
  rules: SimilarRules,
): boolean {
  if (
    Math.abs(candidate.handLengthBinMm - caller.handLengthBinMm) >
    rules.handLengthRadiusMm
  ) {
    return false;
  }
  if (
    Math.abs(candidate.palmWidthBinMm - caller.palmWidthBinMm) >
    rules.palmWidthRadiusMm
  ) {
    return false;
  }
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

  const nearby = tally(neighbours);
  const everyone = tally(others);

  // The prior: one mean over every valid rating of every mouse by every
  // contributor but the caller. A mean of ratings, not of per-mouse means.
  // `everyone` already has `tally`'s filtering, so it is not redone here. The
  // neighbours are among `others`, so every rating in `nearby` is also in
  // `everyone`: the loop below only runs when `allRatings` is not empty, and
  // an empty one (a NaN here) is never read.
  const allRatings = [...everyone.values()].flatMap((entry) => entry.values);
  const globalMean = orderFreeSum(allRatings) / allRatings.length;

  const ranked: Array<{
    mouse: SimilarMouse;
    score: number;
  }> = [];
  for (const [slug, near] of nearby) {
    const raters = near.values.length;
    if (raters < SIMILAR_MIN_PEOPLE) continue;
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

  const mice = ranked.slice(0, MAX_SIMILAR_MICE).map((r) => r.mouse);
  if (mice.length === 0) return unavailable();

  return {
    available: true,
    neighbours: neighbours.length,
    basis: {
      handLengthBinMm: caller.handLengthBinMm,
      palmWidthBinMm: caller.palmWidthBinMm,
      gripStyle: caller.gripStyle,
    },
    mice,
  };
}
