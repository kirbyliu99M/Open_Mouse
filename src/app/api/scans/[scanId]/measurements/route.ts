import { auth } from "../../../../../auth";
import { createDrizzleRateLimiter } from "../../../../../server/analysis/drizzle-rate-limiter";
import { createDrizzleScanRepo } from "../../../../../server/scans/drizzle-repo";
import { handleScanMeasurements } from "../../../../../server/scans/measurements";
import {
  FIT_RATE_LIMIT_MAX,
  FIT_RATE_LIMIT_WINDOW_MS,
} from "../../../../../server/scans/rate-limit-config";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ scanId: string }> },
): Promise<Response> {
  const { scanId } = await context.params;
  return handleScanMeasurements(request, scanId, {
    repo: createDrizzleScanRepo(),
    // The fit route's numbers, but its own counter: the viewer's read must not
    // spend the budget of the person's fit requests.
    limiter: createDrizzleRateLimiter({
      windowMs: FIT_RATE_LIMIT_WINDOW_MS,
      limit: FIT_RATE_LIMIT_MAX,
      keyPrefix: "measurements:",
    }),
    getUserId,
  });
}
