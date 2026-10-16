import { describe, expect, it } from "vitest";
import {
  CALIBRATION_METHODS,
  MANUAL_ENTRY,
  handMeasurementsSchema,
  type HandMeasurements,
} from "../../src/lib/contracts/measurement";
import { scoringMeasurements } from "../../src/server/fit/scoring-measurements";

const typed: HandMeasurements = {
  handLengthMm: 190,
  palmLengthMm: 106.4,
  palmWidthMm: 85,
};

describe("scoringMeasurements", () => {
  it("scales a typed width by the contract's factor and nothing else", () => {
    const out = scoringMeasurements(typed, "manual-entry");
    expect(out.palmWidthMm).toBeCloseTo(65.45, 10);
    expect(out.palmWidthMm).toBe(
      typed.palmWidthMm * MANUAL_ENTRY.widthToLandmarkScale,
    );
    expect(out.handLengthMm).toBe(190);
    expect(out.palmLengthMm).toBe(106.4);
    expect(Object.keys(out).sort()).toEqual(Object.keys(typed).sort());
  });

  it("keeps the optional fields of the scan as they are", () => {
    const full: HandMeasurements = {
      ...typed,
      thumbLengthMm: 60,
      middleLengthMm: 85,
      palmThicknessMm: 30,
      knuckleHeightMm: 28,
      gripApertureMm: 90,
      thumbAngleDeg: 40,
    };
    const out = scoringMeasurements(full, "manual-entry");
    expect({ ...out, palmWidthMm: full.palmWidthMm }).toEqual(full);
  });

  it.each(
    CALIBRATION_METHODS.filter((m) => m !== "manual-entry").map((m) => [m]),
  )("scores a %s scan exactly as stored", (method) => {
    expect(scoringMeasurements(typed, method)).toEqual(typed);
  });

  it("scores a scan with no recorded method (null, undefined) as stored", () => {
    expect(scoringMeasurements(typed, null)).toEqual(typed);
    expect(scoringMeasurements(typed, undefined)).toEqual(typed);
  });

  it("never modifies its input and returns a new object for a typed scan", () => {
    const input: HandMeasurements = { ...typed };
    const frozen = Object.freeze({ ...typed });
    const out = scoringMeasurements(input, "manual-entry");
    expect(input).toEqual(typed);
    expect(input.palmWidthMm).toBe(85);
    expect(out).not.toBe(input);
    expect(() => scoringMeasurements(frozen, "manual-entry")).not.toThrow();
    expect(frozen.palmWidthMm).toBe(85);
  });

  it("clamps a scaled width below the contract's range to its minimum, without throwing", () => {
    // 60 * 0.77 = 46.2 mm, under the 50 mm floor.
    const low = { ...typed, palmWidthMm: 60 };
    const out = scoringMeasurements(low, "manual-entry");
    expect(out.palmWidthMm).toBe(MANUAL_ENTRY.handWidthRangeMm.min);
    expect(handMeasurementsSchema.safeParse(out).success).toBe(true);
  });

  it("clamps an out-of-contract width to the range, whatever its size", () => {
    const tiny = scoringMeasurements(
      { ...typed, palmWidthMm: 1 },
      "manual-entry",
    );
    expect(tiny.palmWidthMm).toBe(MANUAL_ENTRY.handWidthRangeMm.min);
    const huge = scoringMeasurements(
      { ...typed, palmWidthMm: 1e6 },
      "manual-entry",
    );
    expect(huge.palmWidthMm).toBe(MANUAL_ENTRY.handWidthRangeMm.max);
  });

  it("leaves the top of the range alone (150 mm typed is 115.5 mm scored)", () => {
    const wide = scoringMeasurements(
      { ...typed, palmWidthMm: 150 },
      "manual-entry",
    );
    expect(wide.palmWidthMm).toBeCloseTo(115.5, 10);
    expect(handMeasurementsSchema.safeParse(wide).success).toBe(true);
  });

  it("the contract range the clamp uses is the one the measurement schema enforces", () => {
    const { min, max } = MANUAL_ENTRY.handWidthRangeMm;
    const at = (w: number) =>
      handMeasurementsSchema.safeParse({ ...typed, palmWidthMm: w }).success;
    expect(at(min)).toBe(true);
    expect(at(max)).toBe(true);
    expect(at(min - 0.1)).toBe(false);
    expect(at(max + 0.1)).toBe(false);
  });

  it("does not throw on a width that is not a finite number: it is left as it is", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const input = { ...typed, palmWidthMm: bad };
      let out: HandMeasurements | undefined;
      expect(() => {
        out = scoringMeasurements(input, "manual-entry");
      }).not.toThrow();
      expect(Object.is(out!.palmWidthMm, bad)).toBe(true);
      expect(out!.handLengthMm).toBe(190);
    }
  });
});
