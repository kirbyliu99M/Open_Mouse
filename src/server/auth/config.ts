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

const PLACEHOLDER_AUTH_SECRET = "unconfigured-build-only-placeholder";

/**
 * True when this process is a real production runtime: either Vercel says
 * so (`VERCEL_ENV === "production"` — set only for an actual production
 * deployment, never a preview) or plain `NODE_ENV === "production"` (any
 * other production-mode host).
 */
function isProductionRuntime(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

/**
 * L3 (security hardening finding): `src/auth.ts` used to fall back to a
 * public, checked-in placeholder secret whenever `AUTH_SECRET` was unset,
 * with no distinction between "no real deployment exists yet" (fine — issue
 * #17) and "this IS a production deployment and someone forgot to configure
 * the secret" (never fine — Auth.js uses this value to sign/verify session
 * and CSRF/state cookies, so a known public value lets anyone forge them).
 *
 * `resolveAuthSecret` keeps the placeholder ONLY outside a real production
 * runtime (`isProductionRuntime` above) — dev, test, and any build/CI
 * environment that never actually serves traffic keep working exactly as
 * before, unset `AUTH_SECRET` and all. In a real production runtime, a
 * missing `AUTH_SECRET` throws immediately with a clear message instead of
 * silently arming every session with a secret anyone can read in this
 * repo's source history.
 */
export function resolveAuthSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (isProductionRuntime(env)) {
    throw new Error(
      "AUTH_SECRET is not set. Refusing to start in production with the " +
        "public placeholder secret — configure a real AUTH_SECRET before " +
        "deploying.",
    );
  }
  return PLACEHOLDER_AUTH_SECRET;
}
