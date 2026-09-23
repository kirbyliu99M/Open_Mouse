import { createDrizzleScanRepo } from "../../../../server/scans/drizzle-repo";
import { handleSessionDelete } from "../../../../server/scans/session";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  return handleSessionDelete(request, { repo: createDrizzleScanRepo() });
}

/**
 * Kept alongside `DELETE` above only because a plain HTML `<form method="…">`
 * and some older clients can't issue `DELETE` directly; the "Delete this
 * scan now" action (issue #42) uses `fetch` and could call either — this
 * runs the identical idempotent delete either way. (Formerly also the
 * `navigator.sendBeacon` target for the automatic `pagehide` beacon, which
 * `sendBeacon` could only ever POST to; that automatic beacon is removed —
 * see `src/server/scans/session.ts`.)
 */
export async function POST(request: Request): Promise<Response> {
  return handleSessionDelete(request, { repo: createDrizzleScanRepo() });
}
