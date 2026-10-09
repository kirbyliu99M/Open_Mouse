/** What the nav needs to know about the signed-in user. */
export type NavUser = { name: string | null; image: string | null };

/** The body of `GET /api/auth/session` as the nav reads it: a signed-in user
 * (with the optional profile fields) or null for anything else. */
export function parseSessionBody(body: unknown): NavUser | null {
  if (typeof body !== "object" || body === null) return null;
  const user = (body as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  const { id, name, image } = user as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  return {
    name: typeof name === "string" && name.trim() !== "" ? name : null,
    image: typeof image === "string" && image !== "" ? image : null,
  };
}
