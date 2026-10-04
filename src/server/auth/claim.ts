import {
  SCAN_SESSION_COOKIE,
  parseSessionId,
  readSessionCookie,
} from "../scans/cookies";
import type { ScanRepo } from "../scans/repo";

/**
 * How a sign-in request learns which `scan_sessions` row it may claim: the
 * httpOnly, Secure, SameSite=Lax `scan_session` cookie on the request
 * itself. Never a client-supplied field (JSON body, query string, header the
 * client controls) — those are always ignored, even if present, which is
 * what makes claiming someone else's session impossible: an attacker who
 * doesn't hold the victim's cookie has no way to name their session id to
 * this code at all.
 *
 * Sign-in is no longer the only time a session is claimed:
 * `resolveSubmitSession` (`../scans/submit.ts`) also claims, when a
 * signed-in caller submits a scan with an unclaimed anonymous cookie. The
 * rule is the same there: the session id comes only from the caller's own
 * cookie, and `claimSession` never reassigns a session someone else holds.
 */
export function deriveClaimSessionId(request: Request): string | null {
  return readSessionCookie(request.headers.get("cookie"));
}

export interface ClaimDeps {
  repo: Pick<ScanRepo, "claimSession">;
  now?: () => Date;
}

/**
 * Attaches the caller's current anonymous scan session (if any) to the
 * newly signed-in user, and clears its expiry — one statement in
 * `ScanRepo.claimSession`, so "read and write" is not split into two steps
 * a race could slip between.
 *
 * Idempotent and safe to call on every sign-in: a no-op when there is no
 * anonymous cookie, when the named session is already claimed by someone
 * else (or by this same user again), or when it has already expired
 * (expired means gone — issue #17 spec amendment).
 */
export async function claimAnonymousSession(
  cookieValue: string | null | undefined,
  userId: string,
  deps: ClaimDeps,
): Promise<void> {
  // `cookieValue` is whatever the browser sent, read straight from the
  // cookie store by the Auth.js sign-in event, so it gets the same UUID check
  // as `readSessionCookie`. A malformed value (tampering, corruption) used to
  // reach Postgres as an invalid uuid (22P02): one query that can only fail,
  // an EventError in the log (Auth.js swallows errors thrown in events, so
  // the sign-in itself still succeeds) and the claim skipped. Now it is
  // simply "no cookie".
  const cookieSessionId = parseSessionId(cookieValue);
  if (!cookieSessionId) return;
  const now = deps.now ?? (() => new Date());
  await deps.repo.claimSession(cookieSessionId, userId, now());
}

/** The part of Next's `cookies()` store that the sign-in claim reads. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * The Auth.js `events.signIn` body (`src/auth.ts`): claim the browser's
 * anonymous scan session for the user who just signed in. `user.id` is
 * absent for a sign-in with no user row to attach to (nothing to claim);
 * otherwise the `scan_session` cookie's raw value goes to
 * `claimAnonymousSession`, which validates it.
 */
export async function claimOnSignIn(
  user: { id?: string | null },
  cookieStore: CookieReader,
  deps: ClaimDeps,
): Promise<void> {
  if (!user.id) return;
  await claimAnonymousSession(
    cookieStore.get(SCAN_SESSION_COOKIE)?.value,
    user.id,
    deps,
  );
}
