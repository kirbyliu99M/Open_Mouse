import { getDb } from "../../../../db/client";
import { createVercelErrorPhotoBlobStore } from "../../../../server/error-photos/blob-store";
import { createDrizzleErrorPhotoRepo } from "../../../../server/error-photos/drizzle-repo";
import { purgeErrorPhotos } from "../../../../server/error-photos/purge";
import { createDrizzleScanRepo } from "../../../../server/scans/drizzle-repo";
import { handleExpireSessions } from "../../../../server/scans/expire-cron";
import { createDrizzleTesterShotRepo } from "../../../../server/tester/drizzle-repo";
import { purgeTesterPhotos } from "../../../../server/tester/purge";

export const dynamic = "force-dynamic";
// The error-photo purge stops starting new steps after 20 s (purge.ts); this
// leaves room for the step already running.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return handleExpireSessions(request, {
    repo: createDrizzleScanRepo(),
    cronSecret: process.env.CRON_SECRET,
    // Only with the private Blob store connected; whatever the error-photo
    // flag says (src/server/scans/expire-cron.ts).
    ...(process.env.BLOB_READ_WRITE_TOKEN
      ? {
          purgeErrorPhotos: () =>
            purgeErrorPhotos({
              repo: createDrizzleErrorPhotoRepo(getDb),
              blob: createVercelErrorPhotoBlobStore(),
            }),
          // Tester photos (candidate): same store, own folder, own retention.
          purgeTesterPhotos: () =>
            purgeTesterPhotos({
              repo: createDrizzleTesterShotRepo(getDb),
              blob: createVercelErrorPhotoBlobStore(),
            }),
        }
      : {}),
  });
}
