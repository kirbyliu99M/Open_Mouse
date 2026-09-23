import { describe, expect, it } from "vitest";
import {
  dimensionDelta,
  formatConfidence,
  formatMm,
  formatMmValue,
  formatScore,
  formatSignedMm,
  formatSignedMmValue,
  formatWeight,
  isLowConfidence,
} from "../../src/components/results/format";

describe("formatMm", () => {
  it("rounds to one decimal and appends the unit", () => {
    expect(formatMm(63.46)).toBe("63.5 mm");
  });

  it("never shows -0.0", () => {
    expect(formatMm(-0.02)).toBe("0.0 mm");
  });
});

describe("formatSignedMm", () => {
  it("prefixes positive deltas with a plus sign", () => {
    expect(formatSignedMm(2)).toBe("+2.0 mm");
  });

  it("keeps the minus sign for negative deltas", () => {
    expect(formatSignedMm(-1.5)).toBe("-1.5 mm");
  });

  it("shows a bare zero for no difference", () => {
    expect(formatSignedMm(0)).toBe("0.0 mm");
  });
});

describe("formatMmValue", () => {
  it("rounds to one decimal without a unit suffix", () => {
    expect(formatMmValue(63.46)).toBe("63.5");
  });

  it("never shows -0.0", () => {
    expect(formatMmValue(-0.02)).toBe("0.0");
  });
});

describe("formatSignedMmValue", () => {
  it("prefixes positive deltas with a plus sign, no unit suffix", () => {
    expect(formatSignedMmValue(2)).toBe("+2.0");
  });

  it("keeps the minus sign for negative deltas", () => {
    expect(formatSignedMmValue(-1.5)).toBe("-1.5");
  });
});

describe("dimensionDelta", () => {
  it("is actual minus target", () => {
    expect(dimensionDelta(125, 120)).toBe(5);
    expect(dimensionDelta(118, 120)).toBe(-2);
  });
});

describe("formatWeight", () => {
  it("spells out a missing weight rather than showing a blank or zero", () => {
    expect(formatWeight(null)).toBe("Weight not listed");
  });

  it("rounds grams", () => {
    expect(formatWeight(59.6)).toBe("60 g");
  });
});

describe("formatConfidence", () => {
  it("renders a 0-1 share as a whole-number percentage", () => {
    expect(formatConfidence(0.7)).toBe("70%");
    expect(formatConfidence(0.923)).toBe("92%");
  });
});

describe("formatScore", () => {
  it("never renders a null score as 0", () => {
    expect(formatScore(null)).toBe("Not yet assessed");
    expect(formatScore(null)).not.toContain("0");
  });

  it("renders a real score as-is", () => {
    expect(formatScore(88)).toBe("88");
  });
});

describe("isLowConfidence", () => {
  it("is true below the 0.6 threshold and false at or above it", () => {
    expect(isLowConfidence(0.59)).toBe(true);
    expect(isLowConfidence(0.6)).toBe(false);
    expect(isLowConfidence(0.9)).toBe(false);
  });
});
