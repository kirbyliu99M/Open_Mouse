import type { AccountRepo } from "./repo";

// `no-store` is defense in depth: `force-dynamic` on the route plus the
// auth check above already prevent serving another user's data, but every
// response from this helper carries personal hand-measurement data (or a
// count derived from it), so it should never be cached — by a shared proxy
// or by the browser's back/forward cache.
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export interface AccountDeps {
  repo: AccountRepo;
  /** Resolves the signed-in user's id, or null. Wraps `auth()` in the real
   * route; tests inject a fake so no NextAuth machinery runs in unit tests. */
  getUserId: () => Promise<string | null>;
}

/**
 * `GET /api/account/scans`. Requires a signed-in session — an anonymous
 * caller gets 401 and the repo is never touched, so there is no path by
 * which anonymous scan data (or anyone else's) can leak here. The response
 * shape doubles as the export payload: the `/account` page's "Export as
 * JSON" button fetches this same endpoint and turns the response into a
 * client-side download (issue #17) — there is no separate export route.
 */
export async function handleAccountScansList(
  deps: AccountDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return json(401, { error: "Sign in required." });
  const scans = await deps.repo.listScans(userId);
  return json(200, { scans });
}

/**
 * `DELETE /api/account/scans`. Deletes every scan this signed-in user owns,
 * across every session/device that was ever claimed into their account, and
 * withdraws every survey contribution they made (`repo.deleteAllScans`; the
 * survey contract says this button must). Irreversible; the `/account` UI gates this behind a confirmation dialog
 * (docs/design-guidelines.md — modal tasks dim the background).
 */
export async function handleAccountDeleteAll(
  deps: AccountDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return json(401, { error: "Sign in required." });
  const deletedScans = await deps.repo.deleteAllScans(userId);
  return json(200, { deletedScans });
}
