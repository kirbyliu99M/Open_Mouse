import type { CatalogueMouse } from "./types";
import type { FitResultRow } from "./rows";

/**
 * The DB seam for the fit route (issue #27). Route handlers wire
 * `drizzle-repo.ts`'s real implementation; unit tests inject an in-memory
 * fake — no real database in unit tests (AGENTS.md).
 */
export interface FitRepo {
  /** Every `mice` row, mapped to what `scoreFit` needs (`id` included, so a
   * scored result can be traced back to a `mice.id` for persistence). */
  loadCatalogue(): Promise<CatalogueMouse[]>;
  /**
   * Upserts one row per ranked result, keyed on the existing
   * `(scan_id, mouse_id, engine_version)` unique constraint on `fit_results`
   * — repeating the same request overwrites its own rows instead of raising
   * a unique-violation (issue #27, criterion 5). A no-op for an empty list.
   */
  saveFitResults(rows: readonly FitResultRow[]): Promise<void>;
}
