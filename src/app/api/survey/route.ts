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
  logFailure,
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

/**
 * Building the dependencies can throw: each of the repos and the limiter opens
 * the database with `getDb()`, which refuses a missing or malformed
 * `DATABASE_URL`. That has to be the survey's own 500 (the plain sentence, no
 * body of an error, a log line that names only the error's class), not a
 * framework error page, so it is built inside a try/catch of its own.
 */
async function run(
  op: "submit" | "withdraw",
  handle: (request: Request, deps: SurveyDeps) => Promise<Response>,
  request: Request,
): Promise<Response> {
  let built: SurveyDeps;
  try {
    built = deps();
  } catch (error) {
    return logFailure(op, error);
  }
  return handle(request, built);
}

export async function POST(request: Request): Promise<Response> {
  return run("submit", handleSurveySubmission, request);
}

export async function DELETE(request: Request): Promise<Response> {
  return run("withdraw", handleSurveyWithdrawal, request);
}
