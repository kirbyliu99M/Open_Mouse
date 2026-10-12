import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. `crypto.timingSafeEqual` itself throws
 * on unequal-length buffers, which would otherwise leak the secret's length
 * through an early branch — so both sides are hashed to a fixed-length
 * SHA-256 digest first, and only the digests are compared.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * The bearer check every cron endpoint shares (`expire-sessions`,
 * `purge-inactive`). Vercel Cron sends `Authorization: Bearer $CRON_SECRET`;
 * `undefined` (unset env var) always fails the check — never open by default.
 */
export function isCronAuthorized(
  authorization: string | null,
  cronSecret: string | undefined,
): boolean {
  // Fail closed: no configured secret or no header means no comparison is
  // even attempted — neither branch depends on secret bytes, so there is
  // nothing timing-sensitive to protect here.
  if (!cronSecret || !authorization) return false;
  return timingSafeStringEqual(authorization, `Bearer ${cronSecret}`);
}
