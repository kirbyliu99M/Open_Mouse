import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { cookies } from "next/headers";
import { getDb } from "./db/client";
import { accounts, authSessions, users, verificationTokens } from "./db/schema";
import { claimOnSignIn } from "./server/auth/claim";
import { isAuthConfigured, resolveAuthSecret } from "./server/auth/config";
import { createDrizzleScanRepo } from "./server/scans/drizzle-repo";

/**
 * `getDb()` throws when `DATABASE_URL` is unset or malformed (see
 * `db/client.ts`) — and unlike the scan API's repos, `DrizzleAdapter(db,
 * schema)` inspects `db` *synchronously, right when it's called* to pick a
 * SQL dialect, so a lazy stand-in (e.g. a Proxy) doesn't work here: the
 * adapter needs a real, correctly-shaped client immediately, not on first
 * query. `next build` still imports this module (to collect route info)
 * even though the route itself is `force-dynamic`, so this can't just call
 * `getDb()` unguarded either — that would break the build and every test
 * whenever `DATABASE_URL` isn't set, which is the normal state of this repo
 * outside a real deployment.
 *
 * So: try to build the real adapter; if there's no usable database
 * configured, fall back to no adapter and a JWT session instead of
 * throwing. Whenever `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`/`AUTH_SECRET` are
 * unset (issue #17's actual requirement), `providers` is empty anyway, so
 * nothing can reach a code path that needed the adapter in the first place.
 */
function buildAdapter() {
  try {
    return DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: authSessions,
      verificationTokensTable: verificationTokens,
    });
  } catch {
    return undefined;
  }
}

const configured = isAuthConfigured();
const adapter = buildAdapter();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: adapter ? "database" : "jwt" },
  providers: configured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
      ]
    : [],
  // L3 (security hardening finding): see resolveAuthSecret. A missing AUTH_SECRET used to fall
  // back silently to a public, checked-in placeholder even in production —
  // `resolveAuthSecret` (`./server/auth/config.ts`) now keeps that fixed
  // placeholder only where neither VERCEL_ENV nor NODE_ENV is "production":
  // `next dev` and the test runner (issue #17: no real secret exists in this
  // environment, and nothing reaches a code path that signs or verifies with
  // this value while providers is empty). `next build` sets
  // NODE_ENV=production, so every build and every deployed runtime without
  // AUTH_SECRET gets a random secret, generated once per process, that
  // nobody knows — not the placeholder — so nothing can be forged with a
  // value anyone can read in this repo's source history.
  // It deliberately does NOT throw: production runs without sign-in today
  // (no provider is enabled), and a throw at module load would fail
  // `next build` and every route that imports this file. Sign-in itself
  // still needs AUTH_SECRET: `isAuthConfigured` keeps `providers` empty
  // without it.
  secret: resolveAuthSecret(),
  callbacks: {
    // Database session strategy hands the callback `user`, not a decoded
    // token; `session.user.id` isn't populated by default (see
    // `src/types/next-auth.d.ts`), and `/account` needs it to scope every
    // query to exactly this signed-in user.
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    /**
     * Claiming (issue #17): when an anonymous user signs in, attach their
     * current `scan_sessions` row to the new account and clear its expiry —
     * only for the session named by *their own* httpOnly cookie. `cookies()`
     * here reads the same request that just completed the OAuth callback,
     * so this can never be pointed at a session the caller doesn't hold.
     * The raw cookie value goes straight to `claimAnonymousSession` (via
     * `claimOnSignIn`), which applies the same UUID check as
     * `readSessionCookie`: a malformed value never reaches the database
     * (there it would be one query that can only fail, plus an EventError in
     * the log, with the claim skipped).
     */
    async signIn({ user }) {
      await claimOnSignIn(user, await cookies(), {
        repo: createDrizzleScanRepo(),
      });
    },
  },
});
