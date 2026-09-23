import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_ROW_RETENTION_MS,
  isEndedRateLimitWindow,
} from "../../src/server/scans/rate-limit-config";

describe("isEndedRateLimitWindow", () => {
  it("is not ended right at windowStart", () => {
    expect(isEndedRateLimitWindow({ windowStart: 0 }, 0)).toBe(false);
  });

  it("is not ended just before the retention period elapses", () => {
    expect(
      isEndedRateLimitWindow(
        { windowStart: 0 },
        RATE_LIMIT_ROW_RETENTION_MS - 1,
      ),
    ).toBe(false);
  });

  it("is ended exactly at the retention boundary (inclusive)", () => {
    expect(
      isEndedRateLimitWindow({ windowStart: 0 }, RATE_LIMIT_ROW_RETENTION_MS),
    ).toBe(true);
  });

  it("is ended well past the retention period", () => {
    expect(
      isEndedRateLimitWindow(
        { windowStart: 0 },
        RATE_LIMIT_ROW_RETENTION_MS * 10,
      ),
    ).toBe(true);
  });
});
