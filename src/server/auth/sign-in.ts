import { recordSignIn } from "../account/activity";
import { claimOnSignIn, type ClaimDeps, type CookieReader } from "./claim";

/**
 * The Auth.js `events.signIn` body (`src/auth.ts`): stamp the account's
 * `last_active_at` (inactive-retention rule, spec 2026-10-11), then claim the
 * browser's anonymous scan session. The stamp comes first and never throws
 * (`recordSignIn` swallows its own errors), and `cookies()` is passed as a
 * getter and evaluated after it, so neither a failing claim nor a failing
 * `cookies()` can skip it.
 * Auth.js itself swallows whatever this throws, so a failure here never fails
 * the sign-in.
 */
export async function handleSignInEvent(
  user: { id?: string | null },
  getCookies: () => Promise<CookieReader> | CookieReader,
  deps: Pick<ClaimDeps, "now"> & {
    db: Parameters<typeof recordSignIn>[0];
    /** A factory, so building the repo cannot fail before the stamp. */
    makeRepo: () => ClaimDeps["repo"];
  },
): Promise<void> {
  await recordSignIn(deps.db, user.id);
  // Read only now: a `cookies()` that throws affects the claim (as before), never
  // the stamp above.
  await claimOnSignIn(user, await getCookies(), {
    repo: deps.makeRepo(),
    now: deps.now,
  });
}
