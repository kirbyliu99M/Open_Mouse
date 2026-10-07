import { describe, expect, it, vi } from "vitest";
import { clampAttempt, clampCount, issueCodes } from "@/client/analytics/props";
import {
  redactEventUrls,
  redactUrlProperties,
} from "@/client/analytics/redact";
import { createTrack } from "@/client/analytics/track";
import { ANALYTICS_COUNT_CAP } from "@/lib/contracts/analytics";

const UUID = "3f2b8c1e-5d4a-4e6f-9a0b-1c2d3e4f5a6b";

describe("redactEventUrls", () => {
  it("redacts every URL-shaped property, including $set and $set_once", () => {
    const out = redactEventUrls({
      properties: {
        $current_url: `https://x.test/results/${UUID}?a=1#f`,
        $pathname: `/results/${UUID}`,
        $referrer: `https://x.test/l/v1/tok123`,
        $initial_current_url: `https://x.test/results/${UUID}`,
        $initial_pathname: `/results/${UUID}`,
        $initial_referrer: "$direct",
        $prev_pageview_pathname: `/results/${UUID}`,
        $referring_domain: "x.test",
        other: "keep",
      },
      $set: { $current_url: `https://x.test/results/${UUID}` },
      $set_once: { $initial_pathname: `/results/${UUID}` },
    });
    expect(out.properties).toMatchObject({
      $current_url: "https://x.test/results/[scanId]",
      $pathname: "/results/[scanId]",
      $referrer: "https://x.test/l/v1/[token]",
      $initial_current_url: "https://x.test/results/[scanId]",
      $initial_pathname: "/results/[scanId]",
      $initial_referrer: "$direct",
      $prev_pageview_pathname: "/results/[scanId]",
      $referring_domain: "x.test",
      other: "keep",
    });
    expect(out.$set).toEqual({
      $current_url: "https://x.test/results/[scanId]",
    });
    expect(out.$set_once).toEqual({ $initial_pathname: "/results/[scanId]" });
    expect(JSON.stringify(out)).not.toContain(UUID);
  });

  it("deletes a property redaction refuses, and a non-string URL", () => {
    const out = redactUrlProperties({
      $current_url: "javascript:alert(1)",
      $pathname: 5,
      $referrer: "https://x.test/results/" + UUID,
    });
    expect(out).toEqual({ $referrer: "https://x.test/results/[scanId]" });
  });

  it("drops a $referring_domain that carries a path, and does not mutate", () => {
    const input = { $referring_domain: `x.test/results/${UUID}` };
    expect(redactUrlProperties(input)).toEqual({});
    expect(input.$referring_domain).toContain(UUID);
  });
});

describe("count helpers", () => {
  it("clamps counts to 0..cap", () => {
    expect(clampCount(-3)).toBe(0);
    expect(clampCount(2.9)).toBe(2);
    expect(clampCount(999)).toBe(ANALYTICS_COUNT_CAP);
    expect(clampCount(Number.NaN)).toBe(0);
  });
  it("clamps attempts to 1..cap", () => {
    expect(clampAttempt(0)).toBe(1);
    expect(clampAttempt(7)).toBe(7);
    expect(clampAttempt(500)).toBe(ANALYTICS_COUNT_CAP);
  });
  it("deduplicates issue codes, drops non-codes, caps at 8", () => {
    expect(issueCodes(["A", "A", "B_2", "not a code", "lower"])).toEqual([
      "A",
      "B_2",
    ]);
    const many = Array.from({ length: 12 }, (_, i) => `C${i}`);
    expect(issueCodes(many)).toHaveLength(8);
  });
});

describe("track", () => {
  it("sends a valid event through the schema", () => {
    const send = vi.fn();
    const track = createTrack({ enabled: () => true, send });
    track("scan_submitted", { flow: "easy" });
    expect(send).toHaveBeenCalledWith("scan_submitted", { flow: "easy" });
  });
  it("silently drops invalid props", () => {
    const send = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const track = createTrack({ enabled: () => true, send });
    // @ts-expect-error: an extra property the schema forbids
    track("scan_submitted", { flow: "easy", scanId: UUID });
    // @ts-expect-error: an enum value outside the contract
    track("scan_submitted", { flow: "other" });
    expect(send).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("is a no-op without a key", () => {
    const send = vi.fn();
    const track = createTrack({ enabled: () => false, send });
    track("scan_submitted", { flow: "easy" });
    expect(send).not.toHaveBeenCalled();
  });
  it("never throws when the sender does", () => {
    const track = createTrack({
      enabled: () => true,
      send: () => {
        throw new Error("boom");
      },
    });
    expect(() => track("scan_submitted", { flow: "easy" })).not.toThrow();
  });
});
