import type {
  FitEntry,
  FitPreferences,
  FitResponse,
} from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import {
  ENGINE_VERSION_V3,
  RANK_STABILITY_DRAWS,
  RANK_STABILITY_TOP_CARDS,
  RANK_STABILITY_TRACKED_CARDS,
} from "./coefficients";
import type { Priors } from "./priors";
import {
  engineView,
  firstDifference,
  memberSlugs,
  resampledMeasurements,
} from "./rank-stability-candidate";
import { toFitEntryV1 } from "./score-v1";
import { planV2 } from "./score-v2-candidate";
import { rankV3, scoreFitV3, type FitV3Options } from "./score-v3-candidate";
import { groupShells } from "./shell-groups";
import type { CatalogueMouse } from "./types";

/**
 * Rank stability for the fit-v3.0 candidate (未拍板): the same measure as
 * `attachRankStability` (the share of resampled hands, 6 mm on the hand
 * length and 4 mm on the palm width, in which a card's shell stays among the
 * first five cards), with the v3 engine doing the ranking. Every resample is
 * ranked from scratch by `rankV3`, so the personal calibration is recomputed
 * for the nearby hand too: the question is how much the ranking moves if the
 * measurement moves, with everything else the person said held fixed.
 *
 * The resampling, the card projection and the pairing check are v2's own
 * helpers (exported from rank-stability-candidate.ts).
 */
export interface RankStabilityV3Input {
  measurements: HandMeasurements;
  catalogue: readonly CatalogueMouse[];
  prefs: FitPreferences;
  hand: "left" | "right";
  priors: Priors;
  options?: FitV3Options;
}

/**
 * `response` with `rankStability` on the first `RANK_STABILITY_TRACKED_CARDS`
 * cards, like `attachRankStability`; every old value is dropped first. The
 * pairing is checked: `scoreFitV3` is run again on `input`, and unless
 * `response` deep-equals its output this throws, naming the first difference.
 * Pure.
 */
export function attachRankStabilityV3(
  response: Omit<FitResponse, "scanId">,
  input: RankStabilityV3Input,
): Omit<FitResponse, "scanId"> {
  if (response.engineVersion !== ENGINE_VERSION_V3) {
    throw new Error(
      `Rank stability needs a ${ENGINE_VERSION_V3} response, got ${response.engineVersion}.`,
    );
  }
  const expected = scoreFitV3(
    input.measurements,
    input.catalogue,
    input.prefs,
    input.hand,
    input.priors,
    input.options,
  );
  const difference = firstDifference(
    engineView(response),
    engineView(expected),
    "response",
  );
  if (difference !== null) {
    throw new Error(
      `The response is not scoreFitV3's output for this input (first difference at ${difference}); rank stability refuses to attach to it.`,
    );
  }

  const plan = planV2(input.catalogue, input.hand, input.prefs, input.options);
  const cards = groupShells(response.results, input.catalogue).slice(
    0,
    RANK_STABILITY_TRACKED_CARDS,
  );
  if (cards.length === 0) return { ...response, results: [] };
  const cardOfMember = new Map<string, number>();
  cards.forEach((card, i) => {
    for (const slug of memberSlugs(card)) cardOfMember.set(slug, i);
  });

  const hits = cards.map(() => 0);
  for (const draw of resampledMeasurements(input.measurements)) {
    const { ranked } = rankV3(
      plan,
      draw,
      input.catalogue,
      input.prefs,
      input.priors,
      input.options,
    );
    const entries: FitEntry[] = ranked.map(({ mouse, score }, i) =>
      toFitEntryV1(mouse, score, i + 1),
    );
    const top = groupShells(entries, input.catalogue).slice(
      0,
      RANK_STABILITY_TOP_CARDS,
    );
    const seen = new Set<number>();
    for (const card of top) {
      for (const slug of memberSlugs(card)) {
        const i = cardOfMember.get(slug);
        if (i !== undefined) seen.add(i);
      }
    }
    for (const i of seen) hits[i] += 1;
  }

  const shareByShown = new Map(
    cards.map((card, i) => [card.mouse.slug, hits[i]! / RANK_STABILITY_DRAWS]),
  );
  return {
    ...response,
    results: response.results.map((entry) => {
      const { rankStability: _old, ...plain } = entry;
      void _old;
      const share = shareByShown.get(entry.mouse.slug);
      return share === undefined ? plain : { ...plain, rankStability: share };
    }),
  };
}
