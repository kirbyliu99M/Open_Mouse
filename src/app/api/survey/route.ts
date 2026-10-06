import { auth } from "../../../auth";
import { createDrizzleRateLimiter } from "../../../server/analysis/drizzle-rate-limiter";
import {
  SURVEY_RATE_LIMIT_MAX,
  SURVEY_RATE_LIMIT_WINDOW_MS,
} from "../../../server/scans/rate-limit-config";
import { createDrizzleScanRepo } from "../../../server/scans/drizzle-repo";
import { createDrizzleSurveyRepo } from "../../../server/survey/drizzle-repo";
import {
  handleSurveySubmission,
  handleSurveyWithdrawal,
  type SurveyDeps,
} from "../../../server/survey/service";

export const dynamic = "force-dynamic";

function deps(): SurveyDeps {
  return {
    scanRepo: createDrizzleScanRepo(),
    surveyRepo: createDrizzleSurveyRepo(),
    // One budget for POST and DELETE, keyed on the caller's IP.
    limiter: createDrizzleRateLimiter({
      windowMs: SURVEY_RATE_LIMIT_WINDOW_MS,
      limit: SURVEY_RATE_LIMIT_MAX,
      keyPrefix: "survey:",
    }),
    getUserId: async () => (await auth())?.user?.id ?? null,
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleSurveySubmission(request, deps());
}

export async function DELETE(request: Request): Promise<Response> {
  return handleSurveyWithdrawal(request, deps());
}
