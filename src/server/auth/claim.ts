import { parseSessionId, readSessionCookie } from "../scans/cookies";
import type { ScanRepo } from "../scans/repo";

/**
 * The ONLY sanctioned way to learn which `scan_sessions` row a sign-in
 * request may claim: the httpOnly, Secure, SameSite=Lax `scan_session`
 * cookie on the request itself. Never a client-supplied field (JSON body,
 * query string, header the client controls) — those are always ignored,
 * even if present, which is what makes claiming someone else's session
 * impossible: an attacker who doesn't hold the victim's cookie has no way
 * to name their session id to this code at all.
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
  // reach Postgres as an invalid uuid (22P02) and could fail the sign-in
  // itself; now it is simply "no cookie".
  const cookieSessionId = parseSessionId(cookieValue);
  if (!cookieSessionId) return;
  const now = deps.now ?? (() => new Date());
  await deps.repo.claimSession(cookieSessionId, userId, now());
}
