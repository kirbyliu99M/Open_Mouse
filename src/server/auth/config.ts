/**
 * Whether real Google OAuth credentials are configured. Pure, env-injectable
 * so it is testable without touching `process.env` globally.
 *
 * No real credentials exist in this environment (issue #17): the app must
 * build and every test must pass with these unset, and the sign-in button
 * must show "Sign-in unavailable" rather than a broken OAuth flow.
 */
export function isAuthConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return Boolean(
    env.AUTH_GOOGLE_ID?.trim() &&
    env.AUTH_GOOGLE_SECRET?.trim() &&
    env.AUTH_SECRET?.trim(),
  );
}
