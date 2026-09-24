import { createDrizzleRateLimiter } from "../../../server/analysis/drizzle-rate-limiter";
import {
  SCAN_SUBMIT_RATE_LIMIT_MAX,
  SCAN_SUBMIT_RATE_LIMIT_WINDOW_MS,
} from "../../../server/scans/rate-limit-config";
import { createDrizzleScanRepo } from "../../../server/scans/drizzle-repo";
import { handleScanSubmission } from "../../../server/scans/submit";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleScanSubmission(request, {
    repo: createDrizzleScanRepo(),
    limiter: createDrizzleRateLimiter({
      windowMs: SCAN_SUBMIT_RATE_LIMIT_WINDOW_MS,
      limit: SCAN_SUBMIT_RATE_LIMIT_MAX,
      keyPrefix: "submit:",
    }),
  });
}
