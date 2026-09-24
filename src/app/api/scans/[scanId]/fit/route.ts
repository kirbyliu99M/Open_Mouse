import { auth } from "../../../../../auth";
import { createDrizzleRateLimiter } from "../../../../../server/analysis/drizzle-rate-limiter";
import { createDrizzleFitRepo } from "../../../../../server/fit/drizzle-repo";
import { computeFitForScan } from "../../../../../server/fit/service";
import { createDrizzleScanRepo } from "../../../../../server/scans/drizzle-repo";
import {
  FIT_RATE_LIMIT_MAX,
  FIT_RATE_LIMIT_WINDOW_MS,
} from "../../../../../server/scans/rate-limit-config";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ scanId: string }> },
): Promise<Response> {
  const { scanId } = await context.params;
  return computeFitForScan(request, scanId, {
    scanRepo: createDrizzleScanRepo(),
    fitRepo: createDrizzleFitRepo(),
    limiter: createDrizzleRateLimiter({
      windowMs: FIT_RATE_LIMIT_WINDOW_MS,
      limit: FIT_RATE_LIMIT_MAX,
      keyPrefix: "fit:",
    }),
    getUserId,
  });
}
