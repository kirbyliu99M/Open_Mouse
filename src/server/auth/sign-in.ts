import { recordSignIn } from "../account/activity";
import { claimOnSignIn, type ClaimDeps, type CookieReader } from "./claim";

/**
 * The Auth.js `events.signIn` body (`src/auth.ts`): stamp the account's
 * `last_active_at` (inactive-retention rule, spec 2026-10-11), then claim the
 * browser's anonymous scan session. The stamp comes first and never throws
 * (`recordSignIn` swallows its own errors), so a failing claim cannot skip it.
 * Auth.js itself swallows whatever this throws, so a failure here never fails
 * the sign-in.
 */
export async function handleSignInEvent(
  user: { id?: string | null },
  cookieStore: CookieReader,
  deps: ClaimDeps & { db: Parameters<typeof recordSignIn>[0] },
): Promise<void> {
  await recordSignIn(deps.db, user.id);
  await claimOnSignIn(user, cookieStore, deps);
}
