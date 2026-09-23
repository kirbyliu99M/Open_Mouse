import { buildExpiredSessionCookie, readSessionCookie } from "./cookies";
import type { ScanRepo } from "./repo";

export interface DeleteSessionDeps {
  repo: ScanRepo;
}

/**
 * `DELETE`/`POST /api/scans/session` — the target of the anonymous-only
 * "Delete this scan now" action on `/results/[scanId]` (issue #42).
 * Deletes the caller's session; the DB cascade removes its scans and
 * measurements. Idempotent: no cookie, an unknown session id, or a session
 * already claimed by a signed-in user (`ScanRepo.deleteSession`'s own guard
 * — issue #17: "Kept until you delete it") is not an error and deletes
 * nothing. Always clears the cookie.
 *
 * This used to also be reached automatically by a `navigator.sendBeacon`
 * call on `pagehide` — removed (issue #42) because `pagehide` fires on
 * reload and back/forward navigation, not just tab close, so it destroyed
 * data the user never asked to delete. Automatic 24h deletion is still
 * enforced independently by the session TTL plus the hourly sweep
 * (`src/server/scans/retention.ts`); this route is now only ever called by
 * an explicit user action.
 */
export async function handleSessionDelete(
  request: Request,
  deps: DeleteSessionDeps,
): Promise<Response> {
  const sessionId = readSessionCookie(request.headers.get("cookie"));
  if (sessionId) {
    await deps.repo.deleteSession(sessionId);
  }
  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie": buildExpiredSessionCookie(),
      "cache-control": "no-store",
    },
  });
}
