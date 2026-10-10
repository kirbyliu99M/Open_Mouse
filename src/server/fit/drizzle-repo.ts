import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
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
          ringFingerRest: mice.ringFingerRest,
          connectivity: mice.connectivity,
          formFactor: mice.formFactor,
          listed: mice.listed,
        })
        .from(mice);
    },

    /**
     * Makes the stored rows for this scan and engine version equal `rows`:
     * upserts them, and deletes any other row of the same scan and version (a
     * mouse that was ranked on an earlier load and is now a variant, or no
     * longer ranked, would otherwise keep its old row and its old rank). One
     * `db.batch` = one atomic request on neon-http, so a reader never sees the
     * stale rows gone and the new ones missing, or the reverse.
     *
     * Every row must share one scan id and engine version (`loadOwnedFit`
     * always passes them that way). An empty list is a no-op: with no row there
     * is no scan to clear, and `loadOwnedFit` never ranks nothing for a scan
     * that had results.
     */
    async saveFitResults(rows: readonly FitResultRow[]): Promise<void> {
      const first = rows[0];
      if (!first) return;
      const { scanId, engineVersion } = first;
      if (
        rows.some(
          (r) => r.scanId !== scanId || r.engineVersion !== engineVersion,
        )
      ) {
        throw new Error(
          "saveFitResults needs every row to share one scan and engine version.",
        );
      }
      await db.batch([
        db.delete(fitResults).where(
          and(
            eq(fitResults.scanId, scanId),
            eq(fitResults.engineVersion, engineVersion),
            notInArray(
              fitResults.mouseId,
              rows.map((r) => r.mouseId),
            ),
          ),
        ),
        db
          .insert(fitResults)
          .values(rows.map((r) => ({ ...r })))
          .onConflictDoUpdate({
            target: [
              fitResults.scanId,
              fitResults.mouseId,
              fitResults.engineVersion,
            ],
            set: CONFLICT_SET,
          }),
      ]);
    },
  };
}
