import { auth } from "../../../../../auth";
import { createDrizzleRateLimiter } from "../../../../../server/analysis/drizzle-rate-limiter";
import { createDrizzleFitRepo } from "../../../../../server/fit/drizzle-repo";
import { createDrizzleSimilarRepo } from "../../../../../server/recommend/drizzle-repo";
import {
  handleSimilar,
  logFailure,
  type SimilarDeps,
} from "../../../../../server/recommend/service";
import { createDrizzleScanRepo } from "../../../../../server/scans/drizzle-repo";
import {
  SIMILAR_RATE_LIMIT_MAX,
  SIMILAR_RATE_LIMIT_WINDOW_MS,
} from "../../../../../server/scans/rate-limit-config";

export const dynamic = "force-dynamic";

function deps(): SimilarDeps {
  return {
    scanRepo: createDrizzleScanRepo(),
    fitRepo: createDrizzleFitRepo(),
    similarRepo: createDrizzleSimilarRepo(),
    limiter: createDrizzleRateLimiter({
      windowMs: SIMILAR_RATE_LIMIT_WINDOW_MS,
      limit: SIMILAR_RATE_LIMIT_MAX,
      keyPrefix: "similar:",
    }),
    getUserId: async () => (await auth())?.user?.id ?? null,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ scanId: string }> },
): Promise<Response> {
  const { scanId } = await context.params;
  // Building the dependencies can throw (each repo opens the database with
  // `getDb()`, which refuses a missing or malformed `DATABASE_URL`). That is
  // this route's own 500, not a framework error page.
  let built: SimilarDeps;
  try {
    built = deps();
  } catch (error) {
    return logFailure(error);
  }
  return handleSimilar(request, scanId, built);
}
