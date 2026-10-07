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
  /** Runs after the account is deleted, to clear the auth cookie in the
   * response. Best effort: the session row is already gone, so the browser is
   * signed out either way and a failure here is not reported to the caller. */
  clearSession?: () => Promise<void>;
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
 * `DELETE /api/account/scans`. Deletes the signed-in user's account: every
 * scan they own, across every session/device that was ever claimed into it,
 * every survey contribution they made, and the `users` row with the Google
 * profile on it (`repo.deleteAllScans`; the survey contract says this button
 * must withdraw the survey answers). Their `auth_sessions` rows go with the
 * user, so every browser they were signed in on is signed out. Irreversible;
 * the `/account` UI gates this behind a confirmation dialog
 * (docs/design-guidelines.md — modal tasks dim the background).
 */
export async function handleAccountDeleteAll(
  deps: AccountDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return json(401, { error: "Sign in required." });
  const deletedScans = await deps.repo.deleteAllScans(userId);
  try {
    await deps.clearSession?.();
  } catch {
    // Already signed out: the session row went with the user.
  }
  return json(200, { deletedScans });
}
