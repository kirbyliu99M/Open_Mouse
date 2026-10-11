import type { FormFactor } from "../../lib/contracts/descriptors";
import type { MiceListSource } from "../../lib/mice/list";
import { VERTICAL_FORM_FACTOR_RATIO } from "../fit/coefficients";

/**
 * The all-mice page leaves out vertical mice and trackballs: 暫時排除，Kirby
 * 2026-10-12. This file is the ONE place that says so, and both parts of the
 * rule are as temporary as each other. To bring them back: empty
 * `EXCLUDED_FORM_FACTORS` and delete the height/length test in
 * `isExcludedFromMiceList` (or delete the `withoutExcludedFormFactors` call in
 * `loadMiceRows`). The 「N mice found」 line, the search and the filter's
 * option counts all come from the rows that are left, so they follow.
 */
export const EXCLUDED_FORM_FACTORS: readonly FormFactor[] = [
  "vertical",
  "trackball",
];

/** A catalogue row as the query returns it: the display fields plus the form factor the exclusion reads (never copied onto the page's row). */
export type MiceQueryRow = MiceListSource & { formFactor: FormFactor };

/**
 * Whether a row stays off the page. Same rule as the fit service
 * (`excludeReasonV1`, `src/server/fit/exclusions-v1.ts`): the row's
 * `form_factor` is excluded, or height / length is above the fit service's own
 * `VERTICAL_FORM_FACTOR_RATIO` (so a row written before CAT-1, whose
 * `form_factor` stayed at the default `standard`, is still caught). Exactly at
 * the ratio is kept. Both parts are temporary (see above).
 */
export function isExcludedFromMiceList(
  row: Pick<MiceQueryRow, "formFactor" | "heightMm" | "lengthMm">,
  excluded: readonly FormFactor[] = EXCLUDED_FORM_FACTORS,
): boolean {
  if (excluded.length === 0) return false;
  return (
    excluded.includes(row.formFactor) ||
    row.heightMm / row.lengthMm > VERTICAL_FORM_FACTOR_RATIO
  );
}

/** The rows the page may list: those that are not excluded. Keeps the order of `rows`. */
export function withoutExcludedFormFactors<
  T extends Pick<MiceQueryRow, "formFactor" | "heightMm" | "lengthMm">,
>(
  rows: readonly T[],
  excluded: readonly FormFactor[] = EXCLUDED_FORM_FACTORS,
): T[] {
  return rows.filter((row) => !isExcludedFromMiceList(row, excluded));
}
