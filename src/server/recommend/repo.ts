import type { GripStyle } from "../../lib/contracts/fit";

/**
 * One rating inside a pooled contribution. The mouse is a `mice.id`, not a
 * name: a rating stores no name, and the service takes brand, model and slug
 * from the current catalogue row (neighbours.ts, "What the caller of this
 * function must do", item 2).
 */
export interface PooledRating {
  mouseId: string;
  /** The survey's whole numbers 1 to 5 (a CHECK on the column). */
  satisfaction: number;
}

/**
 * One contribution as the similar-hand route reads it: a coarse hand profile
 * and what that person rated. `userId` is only there so the service can find
 * the caller's own contributions; it never reaches the engine or a response.
 */
export interface PooledContribution {
  id: string;
  /** The contributor's account, or null for an anonymous contribution. */
  userId: string | null;
  /** Hand length rounded down to `CONTRIBUTION_BIN_MM`. */
  handLengthBinMm: number;
  palmWidthBinMm: number;
  gripStyle: GripStyle;
  /** Empty when the person's later answers took every rating over. */
  ratings: PooledRating[];
}

/**
 * The DB seam for `GET /api/scans/{scanId}/similar`. The route wires
 * `drizzle-repo.ts`; unit tests inject an in-memory fake, and the real repo is
 * run on PGlite (tests/unit/similar-repo.test.ts).
 */
export interface SimilarRepo {
  /**
   * Every contribution with its ratings, in no particular order (the engine's
   * answer does not depend on it). Nothing is filtered here: which mice the
   * caller may be shown is the service's decision, made from the catalogue.
   */
  loadContributions(): Promise<PooledContribution[]>;
}
