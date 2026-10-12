import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { surveyContributions, surveyRatings } from "../../db/schema";
import type { PooledContribution, SimilarRepo } from "./repo";

type Db = ReturnType<typeof getDb>;

/** The real `SimilarRepo`, over the Neon HTTP driver. */
export function createDrizzleSimilarRepo(db: Db = getDb()): SimilarRepo {
  return {
    async loadContributions() {
      // A LEFT JOIN, so a contribution whose ratings were all replaced by a
      // later answer of the same account is still one row: that person's hand
      // is still in the pool.
      const rows = await db
        .select({
          id: surveyContributions.id,
          userId: surveyContributions.userId,
          handLengthBinMm: surveyContributions.handLengthBinMm,
          palmWidthBinMm: surveyContributions.palmWidthBinMm,
          gripStyle: surveyContributions.gripStyle,
          mouseId: surveyRatings.mouseId,
          satisfaction: surveyRatings.satisfaction,
        })
        .from(surveyContributions)
        .leftJoin(
          surveyRatings,
          eq(surveyRatings.contributionId, surveyContributions.id),
        );

      const byId = new Map<string, PooledContribution>();
      for (const row of rows) {
        let contribution = byId.get(row.id);
        if (contribution === undefined) {
          contribution = {
            id: row.id,
            userId: row.userId,
            handLengthBinMm: row.handLengthBinMm,
            palmWidthBinMm: row.palmWidthBinMm,
            gripStyle: row.gripStyle,
            ratings: [],
          };
          byId.set(row.id, contribution);
        }
        if (row.mouseId !== null && row.satisfaction !== null) {
          contribution.ratings.push({
            mouseId: row.mouseId,
            satisfaction: row.satisfaction,
          });
        }
      }
      return [...byId.values()];
    },
  };
}
