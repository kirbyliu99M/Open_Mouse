import type { FitEntry } from "../../lib/contracts/fit";
import type { CatalogueMouse } from "./types";

/**
 * Fills the catalogue facts the results-page filter reads (FILTER-1,
 * candidate): `mouse.shape`, `mouse.connectivity` and each variant's
 * `connectivity`, copied from the `mice` rows. Pure; run it after
 * `groupShells`, so a variant is already on its card.
 *
 * Facts only. No score, rank or order changes, and nothing here is a number
 * the analysis may use: `toInputEntry` (src/server/analysis/input.ts) picks
 * its fields one by one and never copies these (hard rule 2; pinned by
 * tests/unit/filter-facts.test.ts). A value that is missing in the catalogue
 * is written as `null` ("not known"); the filter never guesses one.
 */
export function withFilterFacts(
  results: readonly FitEntry[],
  catalogue: readonly CatalogueMouse[],
): FitEntry[] {
  const bySlug = new Map(catalogue.map((m) => [m.slug, m] as const));
  return results.map((entry) => {
    const row = bySlug.get(entry.mouse.slug);
    return {
      ...entry,
      mouse: {
        ...entry.mouse,
        shape: row?.shape ?? null,
        connectivity: row?.connectivity ?? null,
      },
      ...(entry.variants
        ? {
            variants: entry.variants.map((v) => ({
              ...v,
              connectivity: bySlug.get(v.slug)?.connectivity ?? null,
            })),
          }
        : {}),
    };
  });
}
