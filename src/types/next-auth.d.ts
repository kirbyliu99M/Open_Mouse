import type { DefaultSession } from "next-auth";

/** `session.user.id` isn't in next-auth's default session shape; the
 * `session` callback in `src/auth.ts` adds it (via `toPublicSession` in
 * `src/server/auth/session.ts`, which returns only `expires` and `user.id`:
 * the name, email and image of the default shape are never populated). */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
