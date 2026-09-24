import { describe, expect, it } from "vitest";
import {
  computeWindowStart,
  decideRateLimit,
  hashRateLimitKey,
} from "../../src/server/analysis/rate-limit";

const MINUTE = 60_000;

describe("computeWindowStart", () => {
  it("floors to the nearest window boundary at or before now", () => {
    expect(computeWindowStart(0, MINUTE)).toBe(0);
    expect(computeWindowStart(59_999, MINUTE)).toBe(0);
    expect(computeWindowStart(60_000, MINUTE)).toBe(60_000);
    expect(computeWindowStart(125_000, MINUTE)).toBe(120_000);
  });

  it("is deterministic for the same inputs", () => {
    expect(computeWindowStart(123_456, MINUTE)).toBe(
      computeWindowStart(123_456, MINUTE),
    );
  });
});

describe("decideRateLimit", () => {
  const windowMs = MINUTE;
  const limit = 3;

  it("allows the first request ever seen for a key (no existing row)", () => {
    const decision = decideRateLimit(null, 0, windowMs, limit);
    expect(decision).toEqual({ windowStart: 0, count: 1, allow: true });
  });

  it("increments the count for a request in the same window", () => {
    const existing = { windowStart: 0, count: 1 };
    const decision = decideRateLimit(existing, 30_000, windowMs, limit);
    expect(decision).toEqual({ windowStart: 0, count: 2, allow: true });
  });

  it("allows exactly up to the limit (boundary case)", () => {
    const existing = { windowStart: 0, count: limit - 1 };
    const decision = decideRateLimit(existing, 30_000, windowMs, limit);
    expect(decision.count).toBe(limit);
    expect(decision.allow).toBe(true);
  });

  it("rejects once the count exceeds the limit", () => {
    const existing = { windowStart: 0, count: limit };
    const decision = decideRateLimit(existing, 30_000, windowMs, limit);
    expect(decision.count).toBe(limit + 1);
    expect(decision.allow).toBe(false);
  });

  it("resets to 1 when the request lands in a new window, even if the old count was over the limit", () => {
    const existing = { windowStart: 0, count: limit + 5 };
    const decision = decideRateLimit(existing, 60_000, windowMs, limit);
    expect(decision).toEqual({ windowStart: 60_000, count: 1, allow: true });
  });

  it("treats a request in a new window as independent of the previous window's count", () => {
    const existing = { windowStart: 0, count: 1 };
    const decision = decideRateLimit(existing, 61_000, windowMs, limit);
    expect(decision.windowStart).toBe(60_000);
    expect(decision.count).toBe(1);
    expect(decision.allow).toBe(true);
  });
});

describe("hashRateLimitKey", () => {
  it("never returns the raw key itself, with or without a secret", () => {
    expect(hashRateLimitKey("203.0.113.5", "s3cret")).not.toBe("203.0.113.5");
    expect(hashRateLimitKey("203.0.113.5", undefined)).not.toBe("203.0.113.5");
  });

  it("is deterministic for the same key and secret", () => {
    expect(hashRateLimitKey("203.0.113.5", "s3cret")).toBe(
      hashRateLimitKey("203.0.113.5", "s3cret"),
    );
    expect(hashRateLimitKey("203.0.113.5", undefined)).toBe(
      hashRateLimitKey("203.0.113.5", undefined),
    );
  });

  it("produces a different hash for a different secret, same key", () => {
    expect(hashRateLimitKey("203.0.113.5", "secret-a")).not.toBe(
      hashRateLimitKey("203.0.113.5", "secret-b"),
    );
  });

  it("produces a different hash for a different key, same secret", () => {
    expect(hashRateLimitKey("203.0.113.5", "s3cret")).not.toBe(
      hashRateLimitKey("198.51.100.9", "s3cret"),
    );
  });

  it("the no-secret fallback differs from every secret-keyed hash of the same key", () => {
    expect(hashRateLimitKey("203.0.113.5", undefined)).not.toBe(
      hashRateLimitKey("203.0.113.5", "s3cret"),
    );
  });

  it("returns a 64-character lowercase hex digest (sha256)", () => {
    expect(hashRateLimitKey("203.0.113.5", "s3cret")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRateLimitKey("203.0.113.5", undefined)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
