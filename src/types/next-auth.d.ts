import type { DefaultSession } from "next-auth";

/** `session.user.id` isn't in next-auth's default session shape; the
 * `session` callback in `src/auth.ts` adds it from the adapter's `user`. */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
