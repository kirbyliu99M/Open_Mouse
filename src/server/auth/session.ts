import type { Session } from "next-auth";

/**
 * The only fields of a session that may reach the browser. With the database
 * strategy, Auth.js hands the `session` callback the adapter's session row
 * (`sessionToken`, `userId`, `expires`) and returns whatever the callback
 * returns as the body of `GET /api/auth/session`, so returning the argument
 * would give the raw session token to any script on the page. The allow-list is
 * `expires`, `user.id`, and the signed-in user's own `name` and `image`, which
 * the nav needs to show their avatar. `email`, `sessionToken` and `userId`
 * never leave the server.
 */
export function toPublicSession(
  session: { expires: Session["expires"] },
  user: { id: string; name?: string | null; image?: string | null },
): Session {
  return {
    expires: session.expires,
    user: { id: user.id, name: user.name ?? null, image: user.image ?? null },
  };
}
