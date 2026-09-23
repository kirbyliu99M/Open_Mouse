import { describe, expect, it } from "vitest";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../../src/server/analysis/ip";

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
