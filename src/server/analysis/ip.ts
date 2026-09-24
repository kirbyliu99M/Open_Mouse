/**
 * Caller-IP resolution for the analysis route's per-IP rate limit (issue
 * #39, PLAN §M5's "per-IP rate limit" cost lever), reused as-is by the scan
 * submission and fit routes' own per-IP limits (M2 hardening). Pure string
 * handling — no I/O, no `Request` — so it's unit-testable without a real
 * request.
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
 * `::ffff:a.b.c.d` (the common dotted-quad form of an IPv4-mapped IPv6
 * address — what many proxies write when the underlying connection is
 * actually IPv4) reduced to the IPv4 address it carries. Returns null for
 * anything else, including a plain IPv4 address (nothing to reduce) or a
 * genuine IPv6 address.
 */
function ipv4MappedToIpv4(ip: string): string | null {
  const match = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(
    ip.trim(),
  );
  return match ? match[1]! : null;
}

/**
 * Expands a (possibly `::`-compressed) IPv6 address into its 8 hex groups.
 * Returns null for anything that isn't a well-formed IPv6 address — the
 * caller then falls back to using the address as-is rather than throwing,
 * since a rate-limit key just needs to be *some* stable string, not a
 * validated address.
 */
function expandIpv6Groups(ip: string): string[] | null {
  const withoutZone = ip.split("%")[0]!; // strip a zone id, e.g. "%eth0"
  if (!withoutZone.includes(":")) return null;

  const sides = withoutZone.split("::");
  if (sides.length > 2) return null; // "::" may appear at most once

  if (sides.length === 1) {
    const groups = withoutZone.split(":");
    return groups.length === 8 && groups.every((g) => g.length > 0)
      ? groups
      : null;
  }

  const head = sides[0]!.length > 0 ? sides[0]!.split(":") : [];
  const tail = sides[1]!.length > 0 ? sides[1]!.split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  if ([...head, ...tail].some((g) => g.length === 0 || g.length > 4)) {
    return null;
  }
  return [...head, ...Array<string>(missing).fill("0"), ...tail];
}

/**
 * Reduces a genuine IPv6 address to its /64 network prefix, canonicalised
 * (leading zeros dropped per group via numeric parsing) so equivalent
 * addresses always produce the same key. A single residential/mobile
 * customer is commonly handed an entire /64 or larger, and typically
 * rotates the low 64 bits (SLAAC/privacy addresses) far more often than the
 * network prefix — keying on the full address would let one caller dodge
 * the limit by varying only those bits. Returns null (caller falls back to
 * the address unchanged) when the input isn't well-formed IPv6.
 */
function ipv6ToSlash64Prefix(ip: string): string | null {
  const groups = expandIpv6Groups(ip);
  if (!groups) return null;
  const prefix = groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

/**
 * Normalises a resolved client IP for use as a rate-limit key (M1
 * hardening). IPv4 addresses are returned unchanged. An IPv4-mapped IPv6
 * address (`::ffff:a.b.c.d`) is reduced to the plain IPv4 address it
 * carries — the same caller, not a distinct IPv6 one. A genuine IPv6
 * address is reduced to its /64 prefix (see `ipv6ToSlash64Prefix`). Pure,
 * total: never throws, and any input that isn't recognisably IPv4-mapped or
 * IPv6 (including `UNKNOWN_IP_KEY` itself) passes through unchanged.
 */
export function normalizeClientIp(ip: string): string {
  const mappedV4 = ipv4MappedToIpv4(ip);
  if (mappedV4) return mappedV4;
  if (ip.includes(":")) {
    return ipv6ToSlash64Prefix(ip) ?? ip;
  }
  return ip;
}

/**
 * Resolves the rate-limit key for `request.headers`. Never throws, never
 * returns an empty string — always `UNKNOWN_IP_KEY` or a non-empty,
 * normalised IP (`normalizeClientIp`).
 */
export function resolveClientIp(headers: Pick<Headers, "get">): string {
  const vercelForwardedFor = headers.get("x-vercel-forwarded-for");
  if (vercelForwardedFor) {
    const ip = firstForwardedEntry(vercelForwardedFor);
    if (ip) return normalizeClientIp(ip);
  }

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = firstForwardedEntry(forwardedFor);
    if (ip) return normalizeClientIp(ip);
  }

  return UNKNOWN_IP_KEY;
}
