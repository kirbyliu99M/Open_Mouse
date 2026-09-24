import { describe, expect, it } from "vitest";
import {
  UNKNOWN_IP_KEY,
  normalizeClientIp,
  resolveClientIp,
} from "../../src/server/analysis/ip";

function headersWith(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("resolveClientIp", () => {
  it("trusts x-vercel-forwarded-for first", () => {
    const headers = headersWith({
      "x-vercel-forwarded-for": "203.0.113.5",
      "x-forwarded-for": "198.51.100.9",
    });
    expect(resolveClientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to the first entry of x-forwarded-for when the Vercel header is absent", () => {
    const headers = headersWith({
      "x-forwarded-for": "198.51.100.9, 10.0.0.1",
    });
    expect(resolveClientIp(headers)).toBe("198.51.100.9");
  });

  it("takes the first entry of a multi-value x-vercel-forwarded-for", () => {
    const headers = headersWith({
      "x-vercel-forwarded-for": "203.0.113.5, 10.0.0.2",
    });
    expect(resolveClientIp(headers)).toBe("203.0.113.5");
  });

  it("trims whitespace around the first entry", () => {
    const headers = headersWith({
      "x-forwarded-for": "  198.51.100.9  , 10.0.0.1",
    });
    expect(resolveClientIp(headers)).toBe("198.51.100.9");
  });

  it("falls back to UNKNOWN_IP_KEY when neither header is present", () => {
    expect(resolveClientIp(headersWith({}))).toBe(UNKNOWN_IP_KEY);
  });

  it("falls back to UNKNOWN_IP_KEY when x-vercel-forwarded-for is blank and x-forwarded-for is absent", () => {
    const headers = headersWith({ "x-vercel-forwarded-for": "   " });
    expect(resolveClientIp(headers)).toBe(UNKNOWN_IP_KEY);
  });

  it("falls back to x-forwarded-for when x-vercel-forwarded-for is a malformed, comma-only value", () => {
    const headers = headersWith({
      "x-vercel-forwarded-for": ",,,",
      "x-forwarded-for": "198.51.100.9",
    });
    expect(resolveClientIp(headers)).toBe("198.51.100.9");
  });

  it("falls back to UNKNOWN_IP_KEY when both headers are malformed, comma-only values", () => {
    const headers = headersWith({
      "x-vercel-forwarded-for": ",,,",
      "x-forwarded-for": ",,,",
    });
    expect(resolveClientIp(headers)).toBe(UNKNOWN_IP_KEY);
  });

  it("never returns an empty string", () => {
    const headers = headersWith({ "x-forwarded-for": "" });
    expect(resolveClientIp(headers)).toBe(UNKNOWN_IP_KEY);
  });
});

describe("normalizeClientIp — IPv4 unchanged", () => {
  it("passes a plain IPv4 address through unchanged", () => {
    expect(normalizeClientIp("203.0.113.5")).toBe("203.0.113.5");
  });

  it("passes UNKNOWN_IP_KEY through unchanged", () => {
    expect(normalizeClientIp(UNKNOWN_IP_KEY)).toBe(UNKNOWN_IP_KEY);
  });
});

describe("normalizeClientIp — IPv4-mapped IPv6 reduced to the IPv4 address", () => {
  it("reduces ::ffff:a.b.c.d to a.b.c.d", () => {
    expect(normalizeClientIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
  });

  it("is case-insensitive on the ::ffff: prefix", () => {
    expect(normalizeClientIp("::FFFF:203.0.113.5")).toBe("203.0.113.5");
  });
});

describe("normalizeClientIp — IPv6 reduced to its /64 prefix", () => {
  it("keeps only the first 4 groups (64 bits) of a full 8-group address", () => {
    expect(normalizeClientIp("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:1234:5678::/64",
    );
  });

  it("expands :: compression before taking the /64 prefix", () => {
    expect(normalizeClientIp("2001:db8:1234:5678::1")).toBe(
      "2001:db8:1234:5678::/64",
    );
  });

  it("two addresses that differ only in the low 64 bits normalise to the same key", () => {
    const a = normalizeClientIp("2001:db8:1234:5678:aaaa:bbbb:cccc:0001");
    const b = normalizeClientIp("2001:db8:1234:5678:1111:2222:3333:4444");
    expect(a).toBe(b);
  });

  it("two addresses that differ in the network prefix normalise to different keys", () => {
    const a = normalizeClientIp("2001:db8:1234:5678::1");
    const b = normalizeClientIp("2001:db8:1234:9999::1");
    expect(a).not.toBe(b);
  });

  it("canonicalises leading zeros so equivalent addresses share a key", () => {
    const a = normalizeClientIp("2001:0db8:0000:5678::1");
    const b = normalizeClientIp("2001:db8:0:5678::1");
    expect(a).toBe(b);
  });

  it("normalises the loopback address ::1", () => {
    expect(normalizeClientIp("::1")).toBe("0:0:0:0::/64");
  });

  it("handles :: at the very start (leading compression)", () => {
    expect(normalizeClientIp("::2001:db8:1234:5678")).toBe("0:0:0:0::/64");
  });

  it("handles a fully expanded address with no :: at all", () => {
    expect(normalizeClientIp("2001:0db8:1234:5678:0000:0000:0000:0001")).toBe(
      "2001:db8:1234:5678::/64",
    );
  });
});
