/**
 * Caller-IP resolution for the analysis route's per-IP rate limit (issue
 * #39, PLAN §M5's "per-IP rate limit" cost lever). Pure string handling —
 * no I/O, no `Request` — so it's unit-testable without a real request.
 *
 * Trusts `x-vercel-forwarded-for` first: Vercel's edge network sets this
 * header itself on every request that reaches a Vercel function, and a
 * client-sent header of the same name is overwritten, not appended to, so
 * on Vercel it cannot be spoofed by the caller. Falls back to the first
 * entry of the standard `x-forwarded-for` header — also platform-appended
 * in Vercel's proxy chain, and the conventional header elsewhere — for any
 * environment that doesn't set the Vercel-specific one (local dev, a
 * different host).
 *
 * A missing or malformed header must not let a caller dodge the limit by
 * omitting or forging it. Rather than fall back to a per-request or random
 * key — equivalent to no rate limit at all — every request with no usable
 * IP shares one fixed bucket, `UNKNOWN_IP_KEY`, which is far stricter than
 * any single real IP's fair share. Fail toward limiting, not unlimited.
 */

/** Shared rate-limit bucket for any request with no usable IP header. */
export const UNKNOWN_IP_KEY = "unknown";

function firstForwardedEntry(value: string): string | null {
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Resolves the rate-limit key for `request.headers`. Never throws, never
 * returns an empty string — always `UNKNOWN_IP_KEY` or a non-empty IP.
 */
export function resolveClientIp(headers: Pick<Headers, "get">): string {
  const vercelForwardedFor = headers.get("x-vercel-forwarded-for");
  if (vercelForwardedFor) {
    const ip = firstForwardedEntry(vercelForwardedFor);
    if (ip) return ip;
  }

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = firstForwardedEntry(forwardedFor);
    if (ip) return ip;
  }

  return UNKNOWN_IP_KEY;
}
