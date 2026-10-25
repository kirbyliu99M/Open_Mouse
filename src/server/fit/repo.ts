import type { CatalogueMouse } from "./types";

/**
 * The DB seam for the fit route (issue #27). Route handlers wire
 * `drizzle-repo.ts`'s real implementation; unit tests inject an in-memory
 * fake — no real database in unit tests (AGENTS.md).
 */
export interface FitRepo {
  /** Every `mice` row, mapped to what `scoreFit` needs (`id` included), with
   * `listed` and `formFactor`. Unlisted rows are returned too: the caller
   * (`loadOwnedFit`) drops them with `listedOnly` before scoring. */
  loadCatalogue(): Promise<CatalogueMouse[]>;
}
