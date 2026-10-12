import { SUBSCORES, type Subscore } from "../contracts/fit";

/** One bar of the "How we score" chart on /learn. */
export interface WeightBar {
  key: Subscore;
  /** Bar length as a fraction of the longest bar: 0 < ratio <= 1. */
  ratio: number;
}

/**
 * The six bars of the "How we score" chart, longest first. A bar's length is
 * its weight relative to the heaviest weight (docs/fit-algorithm.md section 4,
 * v0 candidate), so the chart follows the engine's weights table and the page
 * never shows a number (hard rule 2: a figure a user sees comes from code, and
 * this page shows lengths only). Ties keep the contract's sub-score order.
 */
export function weightBars(
  weights: Readonly<Record<Subscore, number>>,
): WeightBar[] {
  const values = SUBSCORES.map((key) => weights[key]);
  if (values.some((w) => !Number.isFinite(w) || w <= 0)) {
    throw new Error("weightBars: every weight must be a positive number");
  }
  const max = Math.max(...values);
  return SUBSCORES.map((key, index) => ({ key, ratio: values[index] / max }))
    .map((bar, index) => ({ bar, index }))
    .sort((a, b) => b.bar.ratio - a.bar.ratio || a.index - b.index)
    .map(({ bar }) => bar);
}
