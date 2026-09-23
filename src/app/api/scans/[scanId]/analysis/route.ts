import { auth } from "../../../../../auth";
import { createDrizzleAnalysisCache } from "../../../../../server/analysis/drizzle-cache";
import { createDrizzleRateLimiter } from "../../../../../server/analysis/drizzle-rate-limiter";
import { createAnalysisModel } from "../../../../../server/analysis/gemini";
import {
  ANALYSIS_RATE_LIMIT_MAX,
  ANALYSIS_RATE_LIMIT_WINDOW_MS,
} from "../../../../../server/analysis/rate-limit-config";
import { computeAnalysisForScan } from "../../../../../server/analysis/service";
import { createDrizzleFitRepo } from "../../../../../server/fit/drizzle-repo";
import { createDrizzleScanRepo } from "../../../../../server/scans/drizzle-repo";

export const dynamic = "force-dynamic";

/**
 * One Gemini call plus `./analyse.ts`'s single built-in retry
 * (MAX_ATTEMPTS = 2), plus a handful of small DB round trips (rate-limiter
 * upsert, cache get/set, catalogue load, `fit_results` upsert) that each
 * run in well under a second on Neon's HTTP driver. Vercel Hobby's
 * serverless function ceiling is 60 seconds; 30 comfortably covers two
 * sequential `gemini-3.8-flash` calls even under elevated latency while
 * leaving half the ceiling as headroom, rather than sizing to the edge of
 * what the plan allows.
 */
export const maxDuration = 30;

async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ scanId: string }> },
): Promise<Response> {
  const { scanId } = await context.params;
  return computeAnalysisForScan(request, scanId, {
    scanRepo: createDrizzleScanRepo(),
    fitRepo: createDrizzleFitRepo(),
    client: createAnalysisModel(process.env),
    cache: createDrizzleAnalysisCache(),
    limiter: createDrizzleRateLimiter({
      windowMs: ANALYSIS_RATE_LIMIT_WINDOW_MS,
      limit: ANALYSIS_RATE_LIMIT_MAX,
    }),
    getUserId,
  });
}
