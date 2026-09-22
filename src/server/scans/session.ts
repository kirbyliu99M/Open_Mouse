import { buildExpiredSessionCookie, readSessionCookie } from "./cookies";
import type { ScanRepo } from "./repo";

export interface DeleteSessionDeps {
  repo: ScanRepo;
}

/**
 * `DELETE /api/scans/session` — the `navigator.sendBeacon` target on
 * `pagehide` (docs/PLAN.md §M6). Deletes the caller's session; the DB
 * cascade removes its scans and measurements. Idempotent: no cookie, an
 * unknown session id, or a session already claimed by a signed-in user
 * (`ScanRepo.deleteSession`'s own guard — issue #17: "Kept until you delete
 * it") is not an error and deletes nothing. Always clears the cookie.
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
    headers: { "set-cookie": buildExpiredSessionCookie() },
  });
}
