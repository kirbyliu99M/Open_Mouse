import { describe, expect, it } from "vitest";
import {
  ANALYSIS_DAILY_MODEL_CAP_DEFAULT,
  globalModelCallRateLimitKey,
  parseAnalysisDailyModelCap,
} from "../../src/server/analysis/rate-limit-config";

describe("parseAnalysisDailyModelCap", () => {
  it("returns the default when the env var is unset", () => {
    expect(parseAnalysisDailyModelCap(undefined)).toBe(
      ANALYSIS_DAILY_MODEL_CAP_DEFAULT,
    );
  });

  it("returns the parsed value for a valid positive integer string", () => {
    expect(parseAnalysisDailyModelCap("250")).toBe(250);
    expect(parseAnalysisDailyModelCap("1")).toBe(1);
  });

  it.each([
    ["zero", "0"],
    ["a negative number", "-5"],
    ["a fraction", "12.5"],
    ["not a number at all", "banana"],
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("falls back to the default for %s", (_label, value) => {
    expect(parseAnalysisDailyModelCap(value)).toBe(
      ANALYSIS_DAILY_MODEL_CAP_DEFAULT,
    );
  });
});

describe("globalModelCallRateLimitKey", () => {
  it("formats as global:analysis:<UTC yyyy-mm-dd>", () => {
    expect(globalModelCallRateLimitKey(new Date("2026-09-24T12:00:00Z"))).toBe(
      "global:analysis:2026-09-24",
    );
  });

  it("uses the UTC calendar day, not the local one, at a UTC-day boundary", () => {
    expect(
      globalModelCallRateLimitKey(new Date("2026-09-24T00:00:00.000Z")),
    ).toBe("global:analysis:2026-09-24");
    expect(
      globalModelCallRateLimitKey(new Date("2026-09-24T23:59:59.999Z")),
    ).toBe("global:analysis:2026-09-24");
  });

  it("pads single-digit months and days to two digits", () => {
    expect(globalModelCallRateLimitKey(new Date("2026-01-05T00:00:00Z"))).toBe(
      "global:analysis:2026-01-05",
    );
  });

  it("changes once the UTC day rolls over", () => {
    const beforeMidnight = globalModelCallRateLimitKey(
      new Date("2026-09-24T23:59:59.999Z"),
    );
    const afterMidnight = globalModelCallRateLimitKey(
      new Date("2026-09-25T00:00:00.000Z"),
    );
    expect(beforeMidnight).not.toBe(afterMidnight);
  });
});
