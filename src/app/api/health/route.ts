import { sql } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { createDrizzleRateLimiter } from "../../../server/analysis/drizzle-rate-limiter";
import {
  HEALTH_RATE_LIMIT_MAX,
  HEALTH_RATE_LIMIT_WINDOW_MS,
  handleHealth,
} from "../../../server/health/health";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleHealth(request, {
    checkDb: async () => {
      await getDb().execute(sql`select 1`);
    },
    createLimiter: () =>
      createDrizzleRateLimiter({
        windowMs: HEALTH_RATE_LIMIT_WINDOW_MS,
        limit: HEALTH_RATE_LIMIT_MAX,
        keyPrefix: "health:",
      }),
    // Only this one variable, never the whole environment.
    env: { VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA },
  });
}
