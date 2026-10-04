/**
 * Anonymous scan-session cookie. Pure string handling — no I/O, no Date.now().
 *
 * The cookie carries only an opaque session id; it is intentionally a
 * *session* cookie (no Max-Age/Expires) so it dies when the browser closes
 * (docs/PLAN.md §M6). The 24h `expires_at` on the `scan_sessions` row is the
 * server-side backstop, swept by the cron in this same milestone.
 */

export const SCAN_SESSION_COOKIE = "scan_session";

export function parseCookieHeader(
  header: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A `scan_session` cookie *value* as a session id, or null if it is absent
 * or not a UUID. Every id this app issues is a UUID (`scan_sessions.id`), so
 * any other value is tampering or corruption — treated as "no cookie" rather
 * than passed to Postgres, where a non-UUID makes the query throw (22P02: a
 * 500 instead of the contract's 404; in the sign-in event, a wasted failing
 * query and an EventError log line, with the claim skipped).
 *
 * The one check every reader of the cookie goes through, whether it has the
 * raw Cookie header (`readSessionCookie`) or an already-parsed value (the
 * Auth.js sign-in event, via `claimAnonymousSession`).
 */
export function parseSessionId(
  value: string | null | undefined,
): string | null {
  return value && UUID_PATTERN.test(value) ? value : null;
}

/** The session id from the request's Cookie header, or null (see `parseSessionId`). */
export function readSessionCookie(header: string | null): string | null {
  return parseSessionId(parseCookieHeader(header)[SCAN_SESSION_COOKIE]);
}

/** Set-Cookie value for a newly created session. No Max-Age — see above. */
export function buildSessionCookie(sessionId: string): string {
  return [
    `${SCAN_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

/** Set-Cookie value that deletes the cookie immediately (DELETE /session). */
export function buildExpiredSessionCookie(): string {
  return [
    `${SCAN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}
