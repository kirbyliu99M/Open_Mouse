import type {
  FitEntry,
  FitPreferences,
  FitResponse,
} from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import {
  ENGINE_VERSION_V2,
  RANK_STABILITY_DRAWS,
  RANK_STABILITY_SEED,
  RANK_STABILITY_TOP_CARDS,
  RANK_STABILITY_TRACKED_CARDS,
  SIGMA_MEAS_MM,
} from "./coefficients";
import type { Priors } from "./priors";
import { toFitEntryV1 } from "./score-v1";
import {
  planV2,
  rankV2,
  type FitV2Options,
  type PlanV2,
} from "./score-v2-candidate";
import { groupShells } from "./shell-groups";
import type { CatalogueMouse } from "./types";

/**
 * Rank stability for the fit-v2.0 candidate (未拍板). A separate step after
 * `scoreFitV2`, never part of it, and not recursive: each resample is ranked
 * by `rankV2` alone.
 *
 * The unit is the card a person sees: the engine's ranking projected through
 * `groupShells` (the same-shell grouping `core.ts` applies), for the baseline
 * and for every resample alike. Each of the first `RANK_STABILITY_TRACKED_CARDS`
 * baseline cards gets the share of resamples in which its shell (any member
 * of the card) is among the first `RANK_STABILITY_TOP_CARDS` cards.
 *
 * A resample moves the measured hand length and palm width by independent
 * normal errors of `SIGMA_MEAS_MM` (6 mm and 4 mm, unvalidated; σ_eff already
 * contains them, so this re-runs the same scoring on a nearby hand). Palm
 * length and everything else stay as measured. The distribution is not
 * truncated to the API's valid range, and no input is rounded. It says how
 * much the ranking would move if the measurement moved; it is not a
 * probability that a mouse fits.
 */

/** mulberry32: a 32-bit seeded PRNG, uniform on [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal values from `mulberry32(seed)` by Box–Muller: each pair of
 * uniforms (u1, u2) gives r = √(−2 ln(1 − u1)) and θ = 2π·u2, and the source
 * yields r·cos θ, then r·sin θ, then starts a new pair. 1 − u1 lies in (0, 1],
 * so every value is finite.
 */
export function createStandardNormal(seed: number): () => number {
  const uniform = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const z = spare;
      spare = null;
      return z;
    }
    const r = Math.sqrt(-2 * Math.log(1 - uniform()));
    const theta = 2 * Math.PI * uniform();
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

/** Everything `scoreFitV2` was called with. */
export interface RankStabilityInput {
  measurements: HandMeasurements;
  catalogue: readonly CatalogueMouse[];
  prefs: FitPreferences;
  hand: "left" | "right";
  priors: Priors;
  options?: FitV2Options;
}

/** The ranked entries of one set of measurements, before grouping. */
function rankedEntries(
  plan: PlanV2,
  measurements: HandMeasurements,
  input: RankStabilityInput,
): FitEntry[] {
  const { ranked } = rankV2(
    plan,
    measurements,
    input.prefs,
    input.priors,
    input.options,
  );
  return ranked.map(({ mouse, score }, i) => toFitEntryV1(mouse, score, i + 1));
}

/** A card's members: the shown entry and its variants. */
function memberSlugs(card: FitEntry): string[] {
  return [card.mouse.slug, ...(card.variants ?? []).map((v) => v.slug)];
}

/**
 * `response` with `rankStability` on the entries that are shown on the first
 * `RANK_STABILITY_TRACKED_CARDS` cards. The response stays ungrouped, as the
 * engine returns it, so `groupShells` downstream makes the same cards and
 * carries the value on each card; an entry that becomes a variant, and every
 * entry past those cards, gets none.
 *
 * `response` must be `scoreFitV2`'s output for exactly `input`; anything else
 * (another engine, other inputs) throws instead of attaching numbers that do
 * not belong to it. Pure: changes neither argument.
 */
export function attachRankStability(
  response: Omit<FitResponse, "scanId">,
  input: RankStabilityInput,
): Omit<FitResponse, "scanId"> {
  if (response.engineVersion !== ENGINE_VERSION_V2) {
    throw new Error(
      `Rank stability needs a ${ENGINE_VERSION_V2} response, got ${response.engineVersion}.`,
    );
  }
  const plan = planV2(input.catalogue, input.hand, input.prefs, input.options);
  const center = rankedEntries(plan, input.measurements, input);
  if (
    center.length !== response.results.length ||
    center.some((e, i) => e.mouse.slug !== response.results[i]!.mouse.slug)
  ) {
    throw new Error(
      "The response is not scoreFitV2's ranking for these inputs; rank stability refuses to attach to it.",
    );
  }

  const cards = groupShells(response.results, input.catalogue).slice(
    0,
    RANK_STABILITY_TRACKED_CARDS,
  );
  if (cards.length === 0) return { ...response };
  const cardOfMember = new Map<string, number>();
  cards.forEach((card, i) => {
    for (const slug of memberSlugs(card)) cardOfMember.set(slug, i);
  });

  const hits = cards.map(() => 0);
  const normal = createStandardNormal(RANK_STABILITY_SEED);
  const { handLengthMm, palmWidthMm } = input.measurements;
  for (let d = 0; d < RANK_STABILITY_DRAWS; d++) {
    // Fixed order: hand length first, then palm width.
    const z1 = normal();
    const z2 = normal();
    const draw: HandMeasurements = {
      ...input.measurements,
      handLengthMm: handLengthMm + SIGMA_MEAS_MM.handLength * z1,
      palmWidthMm: palmWidthMm + SIGMA_MEAS_MM.palmWidth * z2,
    };
    if (
      !Number.isFinite(draw.handLengthMm) ||
      !Number.isFinite(draw.palmWidthMm)
    ) {
      throw new Error("Rank stability drew a non-finite measurement.");
    }
    const top = groupShells(
      rankedEntries(plan, draw, input),
      input.catalogue,
    ).slice(0, RANK_STABILITY_TOP_CARDS);
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
      const share = shareByShown.get(entry.mouse.slug);
      return share === undefined ? entry : { ...entry, rankStability: share };
    }),
  };
}
