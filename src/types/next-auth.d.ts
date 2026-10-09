import type { DefaultSession } from "next-auth";

/** `session.user.id` isn't in next-auth's default session shape; the
 * `session` callback in `src/auth.ts` adds it (via `toPublicSession` in
 * `src/server/auth/session.ts`, which returns only `expires`, `user.id`, `user.name` and `user.image`
 * (the signed-in user's own avatar for the nav). The email and the session
 * token are never populated). */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string | null;
      image: string | null;
    } & Omit<DefaultSession["user"], "name" | "image">;
  }
}
