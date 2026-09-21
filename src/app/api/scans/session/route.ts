import { createDrizzleScanRepo } from "../../../../server/scans/drizzle-repo";
import { handleSessionDelete } from "../../../../server/scans/session";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  return handleSessionDelete(request, { repo: createDrizzleScanRepo() });
}

/**
 * `navigator.sendBeacon` (issue #17's `pagehide` cleanup) can only ever
 * issue a POST — the browser gives it no way to choose a method — so this
 * is the beacon's real target. It runs the identical idempotent delete as
 * DELETE above; the method is the only difference.
 */
export async function POST(request: Request): Promise<Response> {
  return handleSessionDelete(request, { repo: createDrizzleScanRepo() });
}
