import type { FitPreferences, FitResponse } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import type { CatalogueMouse } from "./types";

/**
 * Stability measures for docs/fit-algorithm.md §8: how much a ranking moves
 * when the measurement moves by a plausible error. Pure and deterministic;
 * `scripts/fit-stability.ts` prints them and the continuity test asserts on
 * the sweep.
 */

/** An engine as the stability code sees it. */
export type EngineFn = (
  measurements: HandMeasurements,
  catalogue: readonly CatalogueMouse[],
  prefs: FitPreferences,
  hand: "left" | "right",
) => Omit<FitResponse, "scanId">;

export interface Perturbation {
  /** Shown in the report, e.g. "hand length ±5 mm". */
  label: string;
  /** The signed changes applied one at a time (mm). */
  steps: readonly Partial<Record<keyof HandMeasurements, number>>[];
}

export const PERTURBATIONS: readonly Perturbation[] = [
  {
    label: "hand length ±5 mm",
    steps: [{ handLengthMm: 5 }, { handLengthMm: -5 }],
  },
  {
    label: "hand length ±8 mm",
    steps: [{ handLengthMm: 8 }, { handLengthMm: -8 }],
  },
  {
    label: "palm length ±3 mm",
    steps: [{ palmLengthMm: 3 }, { palmLengthMm: -3 }],
  },
  {
    label: "palm width ±3 mm",
    steps: [{ palmWidthMm: 3 }, { palmWidthMm: -3 }],
  },
];

export interface StabilityMeasure {
  /** Number of perturbed runs measured. */
  runs: number;
  /** Runs whose top-1 mouse equals the base top-1. */
  top1Kept: number;
  /** Mean Jaccard overlap of the top-5 slug sets. */
  top5Jaccard: number;
  /** Largest change in a base top-5 mouse's displayed total. */
  maxTotalChange: number;
}

const TOP = 5;

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

type Ranked = Pick<FitResponse, "results">;

/** Compare one perturbed ranking with its base ranking. */
export function compareRankings(base: Ranked, perturbed: Ranked) {
  const baseTop = base.results.slice(0, TOP);
  const pertTop = perturbed.results.slice(0, TOP);
  const pertTotals = new Map(
    perturbed.results.map((e) => [e.mouse.slug, e.total] as const),
  );
  let maxTotalChange = 0;
  for (const e of baseTop) {
    const t = pertTotals.get(e.mouse.slug);
    if (t !== undefined) {
      maxTotalChange = Math.max(maxTotalChange, Math.abs(t - e.total));
    }
  }
  return {
    top1Kept: baseTop[0]?.mouse.slug === pertTop[0]?.mouse.slug,
    top5Jaccard: jaccard(
      baseTop.map((e) => e.mouse.slug),
      pertTop.map((e) => e.mouse.slug),
    ),
    maxTotalChange,
  };
}

/** Fold several `compareRankings` results into one measure. */
export function foldMeasures(
  parts: readonly ReturnType<typeof compareRankings>[],
): StabilityMeasure {
  return {
    runs: parts.length,
    top1Kept: parts.filter((p) => p.top1Kept).length,
    top5Jaccard: parts.reduce((s, p) => s + p.top5Jaccard, 0) / parts.length,
    maxTotalChange: Math.max(0, ...parts.map((p) => p.maxTotalChange)),
  };
}

export function perturbationRuns(
  engine: EngineFn,
  catalogue: readonly CatalogueMouse[],
  hand: "left" | "right",
  base: HandMeasurements,
  perturbation: Perturbation,
  prefs: FitPreferences = { includeVertical: false },
) {
  const baseRanking = engine(base, catalogue, prefs, hand);
  return perturbation.steps.map((step) => {
    const m: HandMeasurements = {
      ...base,
      handLengthMm: base.handLengthMm + (step.handLengthMm ?? 0),
      palmLengthMm: base.palmLengthMm + (step.palmLengthMm ?? 0),
      palmWidthMm: base.palmWidthMm + (step.palmWidthMm ?? 0),
    };
    return compareRankings(baseRanking, engine(m, catalogue, prefs, hand));
  });
}

export interface SweepJump {
  /** Largest absolute change in one mouse's displayed total between neighbouring steps. */
  maxJump: number;
  slug: string;
  fromPalmLengthMm: number;
  toPalmLengthMm: number;
}

/**
 * Sweep palm length in `stepMm` steps over r = palm/hand in [rMin, rMax] with
 * the hand length fixed, and report the largest jump of any mouse's displayed
 * total between neighbouring steps.
 */
export function palmLengthSweep(
  engine: EngineFn,
  catalogue: readonly CatalogueMouse[],
  hand: "left" | "right",
  base: HandMeasurements,
  options: { rMin?: number; rMax?: number; stepMm?: number } = {},
  prefs: FitPreferences = { includeVertical: false },
): SweepJump {
  const { rMin = 0.5, rMax = 0.62, stepMm = 0.5 } = options;
  const first = Math.ceil((rMin * base.handLengthMm) / stepMm) * stepMm;
  const last = Math.floor((rMax * base.handLengthMm) / stepMm) * stepMm;
  let best: SweepJump = {
    maxJump: 0,
    slug: "",
    fromPalmLengthMm: first,
    toPalmLengthMm: first,
  };
  let prev: Map<string, number> | null = null;
  let prevPalm = first;
  for (let palm = first; palm <= last + 1e-9; palm += stepMm) {
    const out = engine({ ...base, palmLengthMm: palm }, catalogue, prefs, hand);
    const totals = new Map(
      out.results.map((e) => [e.mouse.slug, e.total] as const),
    );
    if (prev) {
      for (const [slug, t] of totals) {
        const p = prev.get(slug);
        if (p === undefined) continue;
        const jump = Math.abs(t - p);
        if (jump > best.maxJump) {
          best = {
            maxJump: jump,
            slug,
            fromPalmLengthMm: prevPalm,
            toPalmLengthMm: palm,
          };
        }
      }
    }
    prev = totals;
    prevPalm = palm;
  }
  return best;
}
