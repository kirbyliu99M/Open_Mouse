import { buildExpiredSessionCookie, readSessionCookie } from "./cookies";
import type { ScanRepo } from "./repo";

export interface DeleteSessionDeps {
  repo: ScanRepo;
}

/**
 * `DELETE /api/scans/session` — the `navigator.sendBeacon` target on
 * `pagehide` (docs/PLAN.md §M6). Deletes the caller's session; the DB
 * cascade removes its scans and measurements. Idempotent: no cookie or an
 * unknown session id is not an error. Always clears the cookie.
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
