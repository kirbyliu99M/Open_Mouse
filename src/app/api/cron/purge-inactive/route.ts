import { getDb } from "../../../../db/client";
import { createDrizzlePurgeRepo } from "../../../../server/account/purge";
import { handlePurgeInactive } from "../../../../server/account/purge-cron";

export const dynamic = "force-dynamic";
// The run stops starting new chunks after 20 s (purge-cron.ts); this leaves
// room for the chunk that is already running.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return handlePurgeInactive(request, {
    // `getDb` is passed as a factory: nothing touches the database before the
    // bearer check and the mode have let the request through, so an
    // unauthorised call or an `off` deploy never needs DATABASE_URL.
    repo: createDrizzlePurgeRepo(getDb),
    cronSecret: process.env.CRON_SECRET,
    modeEnv: process.env.RETENTION_PURGE_MODE,
  });
}
