import { randomBytes } from "node:crypto";

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
 * public, checked-in placeholder secret whenever `AUTH_SECRET` was unset.
 * Auth.js signs and verifies session/CSRF cookies with this value, so a
 * known public value would let anyone forge a JWT session if the database
 * adapter ever failed and the strategy fell back to "jwt".
 *
 * In a production runtime without `AUTH_SECRET` this returns a random
 * secret generated once per process — nobody knows it, so nothing can be
 * forged. It deliberately does NOT throw: production runs without sign-in
 * today (`isAuthConfigured` needs `AUTH_SECRET`, so no provider is
 * enabled), `src/auth.ts` is imported by the layout and API routes, and a
 * throw there fails `next build` and takes the whole site down (verified
 * 2026-09-26). Outside production the fixed placeholder keeps dev/test
 * deterministic.
 */
export function resolveAuthSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
  randomSecret: () => string = defaultRandomSecret,
): string {
  const configured = env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (isProductionRuntime(env)) return randomSecret();
  return PLACEHOLDER_AUTH_SECRET;
}

let processSecret: string | undefined;
function defaultRandomSecret(): string {
  processSecret ??= randomBytes(32).toString("base64url");
  return processSecret;
}

export { PLACEHOLDER_AUTH_SECRET };
