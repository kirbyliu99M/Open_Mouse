import {
  GRIP_STYLES,
  SUBSCORES,
  type GripStyle,
  type Subscore,
} from "../../lib/contracts/fit";
import { UNKNOWN_PRIOR_SCORE } from "./coefficients";
import { scoreFrontFlare, scoreThumb } from "./subscores";
import type { CatalogueMouse } from "./types";

/** PRIOR[sub][grip]: what a null sub-score contributes in fit-v1. */
export type Priors = Record<Subscore, Record<GripStyle, number>>;

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
