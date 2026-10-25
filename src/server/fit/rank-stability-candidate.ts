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
  scoreFitV2,
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
 * truncated to the API's valid range, and no input is rounded
 * (`resampledMeasurements`). It says how much the ranking would move if the
 * measurement moved; it is not a probability that a mouse fits.
 *
 * Cost, and a known deviation from build spec rev2 §2.3 (2026-10-18): the
 * exclusions and the length range (`planV2`) and the priors are computed once
 * per call, but every resample still scores every rankable mouse on every grip
 * in play in full, including frontFlare, thumb and weight, which do not
 * change between resamples. The spec asks for those three to be shared;
 * doing so would change `scoreMouseV1`'s signature, which the allowed v1
 * refactor (§2.5, move or export only) does not cover, so it is not done.
 * Each resample also builds a full `FitEntry` (displayed sub-scores included)
 * for every rankable mouse, because `groupShells` takes entries, and groups
 * the whole list, so the projection is exactly the one the baseline gets. What
 * a resample skips is the rest of the response: excluded entries, handType,
 * coverage and the display re-scoring. Measured on the seed catalogue with no
 * grip stated, a call takes roughly 0.5 to 0.8 s; that is not a budget for a
 * request path.
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

/**
 * The `RANK_STABILITY_DRAWS` resampled hands, in draw order: draw d takes the
 * next two normals, z1 for the hand length and z2 for the palm width, from the
 * fixed seed. Nothing is rounded or truncated (a draw above the API's 280 mm
 * stays above it), and every other measurement, palm length included, is the
 * input's. A non-finite draw is a bug and throws. Pure.
 */
export function resampledMeasurements(
  measurements: HandMeasurements,
): HandMeasurements[] {
  const normal = createStandardNormal(RANK_STABILITY_SEED);
  const { handLengthMm, palmWidthMm } = measurements;
  const draws: HandMeasurements[] = [];
  for (let d = 0; d < RANK_STABILITY_DRAWS; d++) {
    // Fixed order: hand length first, then palm width.
    const z1 = normal();
    const z2 = normal();
    const draw: HandMeasurements = {
      ...measurements,
      handLengthMm: handLengthMm + SIGMA_MEAS_MM.handLength * z1,
      palmWidthMm: palmWidthMm + SIGMA_MEAS_MM.palmWidth * z2,
    };
    if (
      !Number.isFinite(draw.handLengthMm) ||
      !Number.isFinite(draw.palmWidthMm)
    ) {
      throw new Error("Rank stability drew a non-finite measurement.");
    }
    draws.push(draw);
  }
  return draws;
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

/**
 * The ranked entries of one set of measurements, before grouping. Full
 * entries (with displayed sub-scores of the ranking context, never shown),
 * because `groupShells` takes `FitEntry`s.
 */
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
export function memberSlugs(card: FitEntry): string[] {
  return [card.mouse.slug, ...(card.variants ?? []).map((v) => v.slug)];
}

/**
 * The path of the first difference between two JSON-like values, or null when
 * they are equal. A key whose value is undefined counts as absent; numbers are
 * compared with `===` (NaN equals NaN).
 */
export function firstDifference(
  a: unknown,
  b: unknown,
  path: string,
): string | null {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b) ? null : path;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return path;
    }
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const d = firstDifference(x[key], y[key], `${path}.${key}`);
      if (d !== null) return d;
    }
    return null;
  }
  return path;
}

/** The response as the engine makes it: no `scanId`, no `rankStability`. */
export function engineView(
  response: Omit<FitResponse, "scanId"> & { scanId?: string },
): unknown {
  const { scanId: _scanId, ...rest } = response;
  void _scanId;
  return {
    ...rest,
    results: rest.results.map((entry) => {
      const { rankStability: _share, ...plain } = entry;
      void _share;
      return plain;
    }),
  };
}

/**
 * `response` with `rankStability` on the entries that are shown on the first
 * `RANK_STABILITY_TRACKED_CARDS` cards. The response stays ungrouped, as the
 * engine returns it, so `groupShells` downstream makes the same cards and
 * carries the value on each card; an entry that becomes a variant, and every
 * entry past those cards, gets none, even if the response passed in carried
 * one (every old value is dropped before the new ones are written).
 *
 * The pairing is checked, not trusted: `scoreFitV2` is run once more on
 * `input`, and unless `response` (without `scanId` and any `rankStability`)
 * deep-equals that output, field for field (engine version, hand, gripStyle
 * and its weights, handType, targets, coverage, excluded, and every entry's
 * rank, mouse, total, confidence and sub-scores), this throws and names the
 * first field that differs. A response with the same order but another hand
 * length, a re-ranked or edited response, another hand, grip or preference,
 * and the grouped (card) list all fail it. What the check cannot see is an
 * input difference that leaves the whole response unchanged (for example two
 * palm lengths that give the same `predicted` grip under equal weights); the
 * resamples would then be centred on the input given here, so the caller
 * must still pass the input the response came from. Pure: changes neither
 * argument.
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
  const expected = scoreFitV2(
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
      `The response is not scoreFitV2's output for this input (first difference at ${difference}); rank stability refuses to attach to it.`,
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
  // Any value the response already carried is dropped from every row first,
  // so only the shown rows of this call's first cards carry one.
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
