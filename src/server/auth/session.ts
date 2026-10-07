import type { Session } from "next-auth";

/**
 * The only fields of a session that may reach the browser. With the database
 * strategy, Auth.js hands the `session` callback the adapter's session row
 * (`sessionToken`, `userId`, `expires`) and returns whatever the callback
 * returns as the body of `GET /api/auth/session`, so returning the argument
 * would give the raw session token to any script on the page. No consumer reads
 * `name`, `email` or `image` (every reader uses `session.user.id` or only checks
 * that a user exists), so the Google profile stays server-side.
 */
export function toPublicSession(
  session: { expires: Session["expires"] },
  user: { id: string },
): Session {
  return { expires: session.expires, user: { id: user.id } };
}
