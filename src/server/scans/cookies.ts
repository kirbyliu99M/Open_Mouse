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

/** The session id from the request's Cookie header, or null if absent. */
export function readSessionCookie(header: string | null): string | null {
  const value = parseCookieHeader(header)[SCAN_SESSION_COOKIE];
  return value && value.length > 0 ? value : null;
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
