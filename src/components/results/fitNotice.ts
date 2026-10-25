import type { FitResponse } from "@/lib/contracts/fit";
import { FAIR_MIN } from "@/lib/fit/bands";

/**
 * Candidate threshold until real hand-to-mouse pairings validate fit scores.
 * Derived from the fit bands, so the notice and the bands cannot disagree: a
 * total under the lowest total of `fair` is `poor`.
 */
export const POOR_FIT_THRESHOLD = FAIR_MIN;

/**
 * The `poorFit` property of `results_page_viewed`: whether the mouse in the
 * header scores under the poor-fit threshold. Outside the catalogue's length
 * range (`coverage.lengthOutOfRange`) `total` is a ranking value, not a fit,
 * so there is nothing to report: the property is left out (the contract makes
 * it optional for exactly this case).
 */
export function poorFitField(
  response: Pick<FitResponse, "coverage">,
  total: number,
): { poorFit?: boolean } {
  if (response.coverage?.lengthOutOfRange === true) return {};
  return { poorFit: total < POOR_FIT_THRESHOLD };
}
