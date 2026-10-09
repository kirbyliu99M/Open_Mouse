import {
  GRIP_STYLES,
  SUBSCORES,
  type GripStyle,
  type Subscore,
} from "../../lib/contracts/fit";
import {
  TARGET_BOUND_PERCENTILES,
  UNKNOWN_PRIOR_SCORE,
  VERTICAL_FORM_FACTOR_RATIO,
} from "./coefficients";
import { scoreFrontFlare, scoreThumb } from "./subscores";
import type { CatalogueMouse } from "./types";

/** The clamp range of one ideal size, in mm. */
export interface Bound {
  low: number;
  high: number;
}

/** CALIB-1: the clamp range of each ideal size, from the catalogue's standard mice. */
export interface TargetBounds {
  lengthMm: Bound;
  gripWidthMm: Bound;
  heightMm: Bound;
}

/**
 * What the v1 engine precomputes from the catalogue: PRIOR[sub][grip] (what a
 * null sub-score contributes) and, since CALIB-1, `targetBounds`, which is
 * null when fewer than two standard mice exist (no clamping then).
 */
export type Priors = Record<Subscore, Record<GripStyle, number>> & {
  targetBounds: TargetBounds | null;
};

/**
 * The p-th percentile (0..100) of `values` by linear interpolation between
 * closest ranks (the "type 7" method of R and NumPy): rank = p/100 * (n - 1)
 * over the sorted values. Returns null for an empty list; one value is its own
 * percentile at every p.
 */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

/**
 * CALIB-1: the clamp range of each ideal size, over the standard mice (not
 * vertical, not a trackball, height/length within the vertical ratio) of the
 * catalogue. Null with fewer than two such mice: one row has no spread to
 * bound by, so nothing is clamped.
 */
export function computeTargetBounds(
  catalogue: readonly CatalogueMouse[],
): TargetBounds | null {
  const standard = catalogue.filter(
    (m) =>
      m.formFactor !== "vertical" &&
      m.formFactor !== "trackball" &&
      m.heightMm / m.lengthMm <= VERTICAL_FORM_FACTOR_RATIO,
  );
  if (standard.length < 2) return null;
  const bound = (pick: (m: CatalogueMouse) => number): Bound => ({
    low: percentile(standard.map(pick), TARGET_BOUND_PERCENTILES.low)!,
    high: percentile(standard.map(pick), TARGET_BOUND_PERCENTILES.high)!,
  });
  return {
    lengthMm: bound((m) => m.lengthMm),
    gripWidthMm: bound((m) => m.widthMm),
    heightMm: bound((m) => m.heightMm),
  };
}

/** `targets` with each size clamped into `bounds` (unchanged when `bounds` is null). */
export function clampTargets<
  T extends { lengthMm: number; gripWidthMm: number; heightMm: number },
>(targets: T, bounds: TargetBounds | null): T {
  if (!bounds) return targets;
  const clamp = (v: number, b: Bound) => Math.min(b.high, Math.max(b.low, v));
  return {
    ...targets,
    lengthMm: clamp(targets.lengthMm, bounds.lengthMm),
    gripWidthMm: clamp(targets.gripWidthMm, bounds.gripWidthMm),
    heightMm: clamp(targets.heightMm, bounds.heightMm),
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return UNKNOWN_PRIOR_SCORE;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * v1 §4: the neutral score a missing descriptor contributes, per sub-score and
 * grip, as the mean of that sub-score over the catalogue rows that DO have the
 * descriptor. Computed once per catalogue load and passed to `scoreFitV1`, so
 * the engine stays a pure function of its arguments.
 *
 * Only `frontFlare` and `thumb` can be null because of a missing descriptor
 * (length, grip width and height always have a score; weight depends on the
 * user's preference, not on the catalogue). The other four, and either of
 * these two when no row has the descriptor, fall back to `UNKNOWN_PRIOR_SCORE`
 * (75), the v0 value.
 *
 * The caller passes the rows that can reach the engine. Once CAT-1 adds a
 * `listed` column, unlisted rows will never reach the engine; today every
 * seeded row does.
 */
export function computePriors(catalogue: readonly CatalogueMouse[]): Priors {
  const priors = {} as Priors;
  priors.targetBounds = computeTargetBounds(catalogue);
  for (const sub of SUBSCORES) {
    priors[sub] = {} as Record<GripStyle, number>;
    for (const grip of GRIP_STYLES) {
      let values: number[] = [];
      if (sub === "frontFlare" || sub === "thumb") {
        const score = sub === "frontFlare" ? scoreFrontFlare : scoreThumb;
        values = catalogue
          .map((m) => score(m, grip).score)
          .filter((s): s is number => s !== null);
      }
      priors[sub][grip] = mean(values);
    }
  }
  return priors;
}
