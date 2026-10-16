import { describe, expect, it, vi } from "vitest";

// The factor must come from the contract, not be written into the function:
// with the contract's factor replaced, the scaled width follows it.
vi.mock("../../src/lib/contracts/measurement", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/lib/contracts/measurement")
    >();
  return {
    ...actual,
    MANUAL_ENTRY: { ...actual.MANUAL_ENTRY, widthToLandmarkScale: 0.5 },
  };
});

import { scoringMeasurements } from "../../src/server/fit/scoring-measurements";

describe("scoringMeasurements reads the factor from the contract", () => {
  it("scales by the contract's factor, whatever it is", () => {
    const out = scoringMeasurements(
      { handLengthMm: 190, palmLengthMm: 106.4, palmWidthMm: 85 },
      "manual-entry",
    );
    expect(out.palmWidthMm).toBe(42.5);
    expect(out.handLengthMm).toBe(190);
  });
});
