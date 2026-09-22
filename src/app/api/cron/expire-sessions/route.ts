import { createDrizzleScanRepo } from "../../../../server/scans/drizzle-repo";
import { handleExpireSessions } from "../../../../server/scans/expire-cron";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleExpireSessions(request, {
    repo: createDrizzleScanRepo(),
    cronSecret: process.env.CRON_SECRET,
  });
}
