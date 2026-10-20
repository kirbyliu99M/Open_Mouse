import { auth } from "../../../../../auth";
import { createDrizzleRateLimiter } from "../../../../../server/analysis/drizzle-rate-limiter";
import { createDrizzleFitRepo } from "../../../../../server/fit/drizzle-repo";
import { createDrizzleSurveyReferenceSource } from "../../../../../server/fit/survey-reference-source";
import { createDrizzleResultFeedbackRepo } from "../../../../../server/result-feedback/drizzle-repo";
import {
  handleResultFeedbackStatus,
  handleResultFeedbackSubmission,
  logFailure,
  type ResultFeedbackDeps,
} from "../../../../../server/result-feedback/service";
import { createDrizzleScanRepo } from "../../../../../server/scans/drizzle-repo";
import {
  RESULT_FEEDBACK_RATE_LIMIT_MAX,
  RESULT_FEEDBACK_RATE_LIMIT_WINDOW_MS,
  RESULT_FEEDBACK_READ_RATE_LIMIT_MAX,
  RESULT_FEEDBACK_READ_RATE_LIMIT_WINDOW_MS,
} from "../../../../../server/scans/rate-limit-config";

export const dynamic = "force-dynamic";

function deps(op: "submit" | "status"): ResultFeedbackDeps {
  return {
    scanRepo: createDrizzleScanRepo(),
    fitRepo: createDrizzleFitRepo(),
    feedbackRepo: createDrizzleResultFeedbackRepo(),
    surveyReferences: createDrizzleSurveyReferenceSource(),
    limiter: createDrizzleRateLimiter(
      op === "status"
        ? {
            windowMs: RESULT_FEEDBACK_READ_RATE_LIMIT_WINDOW_MS,
            limit: RESULT_FEEDBACK_READ_RATE_LIMIT_MAX,
            keyPrefix: "result-feedback-read:",
          }
        : {
            windowMs: RESULT_FEEDBACK_RATE_LIMIT_WINDOW_MS,
            limit: RESULT_FEEDBACK_RATE_LIMIT_MAX,
            keyPrefix: "result-feedback:",
          },
    ),
    getUserId: async () => (await auth())?.user?.id ?? null,
  };
}

type Context = { params: Promise<{ scanId: string }> };

// Building the dependencies can throw (`getDb()` refuses a missing or
// malformed `DATABASE_URL`); that is this route's own 500, not an error page.
async function run(
  op: "submit" | "status",
  handle: (
    request: Request,
    scanId: string,
    deps: ResultFeedbackDeps,
  ) => Promise<Response>,
  request: Request,
  context: Context,
): Promise<Response> {
  const { scanId } = await context.params;
  let built: ResultFeedbackDeps;
  try {
    built = deps(op);
  } catch (error) {
    return logFailure(op, error);
  }
  return handle(request, scanId, built);
}

export async function POST(
  request: Request,
  context: Context,
): Promise<Response> {
  return run("submit", handleResultFeedbackSubmission, request, context);
}

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  return run("status", handleResultFeedbackStatus, request, context);
}
