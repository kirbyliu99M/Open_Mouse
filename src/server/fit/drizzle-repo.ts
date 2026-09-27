import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { fitResults, mice } from "../../db/schema";
import type { FitRepo } from "./repo";
import type { FitResultRow } from "./rows";
import type { CatalogueMouse } from "./types";

/** `set` for `saveFitResults`'s upsert: every incoming column, taken from
 * the conflicting row being inserted (`excluded`), never a stale value from
 * whatever row is already there — same pattern as `scripts/seed.ts`. */
const CONFLICT_SET = {
  rank: sql`excluded.rank`,
  totalScore: sql`excluded.total_score`,
  lengthScore: sql`excluded.length_score`,
  gripWidthScore: sql`excluded.grip_width_score`,
  heightHumpScore: sql`excluded.height_hump_score`,
  frontFlareScore: sql`excluded.front_flare_score`,
  thumbScore: sql`excluded.thumb_score`,
  weightScore: sql`excluded.weight_score`,
  reasons: sql`excluded.reasons`,
};

/** The real `FitRepo`, over the Neon HTTP driver. */
export function createDrizzleFitRepo(db = getDb()): FitRepo {
  return {
    async loadCatalogue(): Promise<CatalogueMouse[]> {
      return db
        .select({
          id: mice.id,
          slug: mice.slug,
          brand: mice.brand,
          model: mice.model,
          lengthMm: mice.lengthMm,
          widthMm: mice.widthMm,
          heightMm: mice.heightMm,
          weightG: mice.weightG,
          size: mice.size,
          handCompatibility: mice.handCompatibility,
          shape: mice.shape,
          humpPlacement: mice.humpPlacement,
          frontFlare: mice.frontFlare,
          sideCurvature: mice.sideCurvature,
          thumbRest: mice.thumbRest,
        })
        .from(mice);
    },

    async saveFitResults(rows: readonly FitResultRow[]): Promise<void> {
      if (rows.length === 0) return;
      await db
        .insert(fitResults)
        .values(rows.map((r) => ({ ...r })))
        .onConflictDoUpdate({
          target: [
            fitResults.scanId,
            fitResults.mouseId,
            fitResults.engineVersion,
          ],
          set: CONFLICT_SET,
        });
    },
  };
}
