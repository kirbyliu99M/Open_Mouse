import type { FitEntry } from "../../lib/contracts/fit";
import { UNKNOWN_PRIOR_SCORE } from "./coefficients";

/** One row for `fit_results`, before `id`/`createdAt` (DB-generated). */
export interface FitResultRow {
  scanId: string;
  mouseId: string;
  engineVersion: string;
  rank: number;
  totalScore: number;
  lengthScore: number;
  gripWidthScore: number;
  heightHumpScore: number;
  frontFlareScore: number;
  thumbScore: number;
  weightScore: number;
  reasons: FitEntry["subscores"];
}

/**
 * Maps `scoreFit`'s ranked results to `fit_results` rows. Every number here
 * already came from `scoreFit` (hard rule 2/6 — the route adds no
 * computation); this only reshapes them for storage. Never called for
 * `excluded` mice — they have no scores to store.
 *
 * `fit_results`'s six per-subscore columns are `NOT NULL` (see
 * `src/db/schema.ts`), but an individual sub-score can be `score: null`
 * (`descriptor_unknown` — nothing classified yet for that mouse). Storing
 * `UNKNOWN_PRIOR_SCORE` there mirrors exactly how `scoreFit` already folds
 * that same null into `total` — a neutral prior, never an invented number.
 * The true "unknown" fact is not lost: `reasons` keeps the real `score:
 * null` and the `descriptor_unknown` code untouched, for anything that
 * reads this row directly instead of through the API's `fitResponseSchema`
 * (which the route validates before ever calling this).
 *
 * Throws if a result's mouse slug has no entry in `mouseIdBySlug` — every
 * scored result came from the same catalogue load that built the map, so a
 * miss means the catalogue changed mid-request or the map was built wrong,
 * not a case to paper over.
 */
export function buildFitResultRows(
  scanId: string,
  engineVersion: string,
  results: readonly FitEntry[],
  mouseIdBySlug: ReadonlyMap<string, string>,
): FitResultRow[] {
  return results.map((entry) => {
    const mouseId = mouseIdBySlug.get(entry.mouse.slug);
    if (!mouseId) {
      throw new Error(
        `No catalogue id found for scored mouse slug "${entry.mouse.slug}".`,
      );
    }
    const s = entry.subscores;
    const orPrior = (score: number | null) => score ?? UNKNOWN_PRIOR_SCORE;
    return {
      scanId,
      mouseId,
      engineVersion,
      rank: entry.rank,
      totalScore: entry.total,
      lengthScore: orPrior(s.length.score),
      gripWidthScore: orPrior(s.gripWidth.score),
      heightHumpScore: orPrior(s.heightHump.score),
      frontFlareScore: orPrior(s.frontFlare.score),
      thumbScore: orPrior(s.thumb.score),
      weightScore: orPrior(s.weight.score),
      reasons: s,
    };
  });
}
