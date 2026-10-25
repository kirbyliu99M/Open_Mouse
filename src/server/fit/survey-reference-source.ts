import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { mice, surveyContributions, surveyRatings } from "../../db/schema";
import type {
  SurveyRatingForCalibration,
  SurveyReferenceSource,
} from "./auto-calibration";

/**
 * The real `SurveyReferenceSource`, over the Neon HTTP driver: one read-only
 * SELECT of the caller's own ratings of catalogue mice, each with the grip of
 * its contribution, newest contribution first. A rating carries the slug of its
 * current `mice` row. Nothing is written and nothing is logged.
 */
export function createDrizzleSurveyReferenceSource(
  db = getDb(),
): SurveyReferenceSource {
  return {
    async loadRatings(userId): Promise<SurveyRatingForCalibration[]> {
      return db
        .select({
          slug: mice.slug,
          satisfaction: surveyRatings.satisfaction,
          painPoints: surveyRatings.painPoints,
          gripStyle: surveyContributions.gripStyle,
        })
        .from(surveyRatings)
        .innerJoin(mice, eq(mice.id, surveyRatings.mouseId))
        .innerJoin(
          surveyContributions,
          eq(surveyContributions.id, surveyRatings.contributionId),
        )
        .where(eq(surveyRatings.userId, userId))
        .orderBy(
          desc(surveyContributions.consentedAt),
          desc(surveyContributions.id),
          asc(mice.slug),
        );
    },
  };
}
