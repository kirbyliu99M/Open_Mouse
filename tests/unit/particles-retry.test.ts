import { describe, expect, it } from "vitest";
import {
  START_RETRY_DELAYS_MS,
  retryDelay,
  retryStep,
} from "@/lib/particles/retry";

describe("retryDelay", () => {
  it("gives two retries, the second after a longer wait, then none", () => {
    expect(START_RETRY_DELAYS_MS).toHaveLength(2);
    const first = retryDelay(1);
    const second = retryDelay(2);
    expect(first).toBe(START_RETRY_DELAYS_MS[0]);
    expect(second).toBe(START_RETRY_DELAYS_MS[1]);
    expect(second!).toBeGreaterThan(first!);
    expect(retryDelay(3)).toBeNull();
    expect(retryDelay(50)).toBeNull();
  });

  it("is null before any failure, and for a count that is not a whole number", () => {
    expect(retryDelay(0)).toBeNull();
    expect(retryDelay(-1)).toBeNull();
    expect(retryDelay(1.5)).toBeNull();
    expect(retryDelay(Number.NaN)).toBeNull();
  });

  it("with no delays there is no retry", () => {
    expect(retryDelay(1, [])).toBeNull();
  });
});

describe("retryStep", () => {
  it("runs now in a shown tab and waits for a hidden one to be shown", () => {
    expect(retryStep(false)).toBe("run");
    expect(retryStep(true)).toBe("wait-until-shown");
  });
});
