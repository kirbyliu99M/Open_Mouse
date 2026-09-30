import { describe, expect, it } from "vitest";
import {
  LOA_Z,
  accuracyStats,
  mean,
  repeatabilityRow,
  sampleSd,
  summariseRepeatability,
} from "../../src/lib/m2/stats";
import {
  CANDIDATE_THRESHOLDS,
  accuracyReadings,
  parseThresholds,
  repeatabilityReadings,
} from "../../src/lib/m2/thresholds";

// Everything below is worked out by hand in the comments.

describe("mean and sampleSd", () => {
  it("mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(() => mean([])).toThrow();
  });

  it("the SD divides by n - 1 (the sample SD), not n", () => {
    // 2 4 4 4 5 5 7 9: mean 5, squared deviations sum to 32.
    // sample SD = sqrt(32 / 7) = 2.138090; the population SD sqrt(32 / 8) = 2 is wrong here.
    const sd = sampleSd([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(sd).toBeCloseTo(2.13809, 5);
    expect(sd).not.toBeCloseTo(2, 2);
  });

  it("has no SD for fewer than two values", () => {
    expect(sampleSd([])).toBeNull();
    expect(sampleSd([5])).toBeNull();
  });
});

describe("accuracyStats", () => {
  // Errors -2 0 1 -3 -1 (measured 188 190 191 187 189 against a ruler 190):
  //   bias = -5 / 5 = -1
  //   MAE = (2 + 0 + 1 + 3 + 1) / 5 = 1.4
  //   largest |error| = 3
  //   deviations from the bias: -1 1 2 -2 0 -> squares 1 + 1 + 4 + 4 + 0 = 10
  //   SD = sqrt(10 / 4) = 1.5811388
  //   95% LoA = -1 +/- 1.96 * 1.5811388 = -1 +/- 3.0990 = [-4.0990, 2.0990]
  const stats = accuracyStats([-2, 0, 1, -3, -1])!;

  it("bias, MAE, largest error and n", () => {
    expect(stats.n).toBe(5);
    expect(stats.bias).toBeCloseTo(-1, 10);
    expect(stats.mae).toBeCloseTo(1.4, 10);
    expect(stats.maxAbsError).toBe(3);
  });

  it("the SD is the sample SD", () => {
    expect(stats.sd).toBeCloseTo(1.5811388, 6);
  });

  it("the 95% limits of agreement are bias +/- 1.96 SD", () => {
    expect(LOA_Z).toBe(1.96);
    expect(stats.loa!.lower).toBeCloseTo(-4.099, 3);
    expect(stats.loa!.upper).toBeCloseTo(2.099, 3);
    // Symmetric about the bias.
    expect(stats.loa!.upper + stats.loa!.lower).toBeCloseTo(2 * stats.bias, 10);
  });

  it("the largest error counts the sign: a big negative error is the largest", () => {
    expect(accuracyStats([1, -5, 2])!.maxAbsError).toBe(5);
  });

  it("one photo has a bias and MAE but no SD and no limits of agreement", () => {
    const one = accuracyStats([-1.5])!;
    expect(one).toMatchObject({ n: 1, bias: -1.5, mae: 1.5, maxAbsError: 1.5 });
    expect(one.sd).toBeNull();
    expect(one.loa).toBeNull();
  });

  it("no photos: nothing, not zeros", () => {
    expect(accuracyStats([])).toBeNull();
  });
});

describe("repeatability", () => {
  // 188 190 191 187 189: min 187, max 191, range 4, mean 189,
  // deviations -1 1 2 -2 0 -> SD = sqrt(10 / 4) = 1.5811388, largest deviation 2.
  const first = repeatabilityRow([188, 190, 191, 187, 189])!;
  // 150 151 150 152 151: range 2, mean 150.8, squares .64 .04 .64 1.44 .04 = 2.8,
  // SD = sqrt(2.8 / 4) = 0.8366600, largest deviation 1.2.
  const second = repeatabilityRow([150, 151, 150, 152, 151])!;

  it("range, SD and largest deviation of one group", () => {
    expect(first).toMatchObject({ n: 5, min: 187, max: 191, range: 4 });
    expect(first.sd).toBeCloseTo(1.5811388, 6);
    expect(first.maxDeviationFromMean).toBeCloseTo(2, 10);
    expect(second.range).toBeCloseTo(2, 10);
    expect(second.sd).toBeCloseTo(0.83666, 5);
    expect(second.maxDeviationFromMean).toBeCloseTo(1.2, 10);
  });

  it("a single photo is not a repeat", () => {
    expect(repeatabilityRow([190])).toBeNull();
    expect(repeatabilityRow([])).toBeNull();
  });

  it("summary over groups: mean range 3, worst 4, pooled SD sqrt((4 * 2.5 + 4 * 0.7) / 8) = 1.264911", () => {
    const summary = summariseRepeatability([first, second])!;
    expect(summary.groups).toBe(2);
    expect(summary.meanRange).toBeCloseTo(3, 10);
    expect(summary.maxRange).toBe(4);
    expect(summary.meanSd).toBeCloseTo((1.5811388 + 0.83666) / 2, 5);
    expect(summary.pooledSd).toBeCloseTo(1.264911, 5);
    expect(summary.maxDeviationFromMean).toBeCloseTo(2, 10);
  });

  it("the pooled SD weights groups by their degrees of freedom (n - 1)", () => {
    // 3 photos (df 2, var 4) and 5 photos (df 4, var 1): sqrt((2 * 4 + 4 * 1) / 6) = sqrt(2)
    const a = {
      n: 3,
      min: 0,
      max: 0,
      range: 0,
      sd: 2,
      maxDeviationFromMean: 0,
    };
    const b = {
      n: 5,
      min: 0,
      max: 0,
      range: 0,
      sd: 1,
      maxDeviationFromMean: 0,
    };
    expect(summariseRepeatability([a, b])!.pooledSd).toBeCloseTo(
      Math.SQRT2,
      10,
    );
  });

  it("no groups: nothing", () => {
    expect(summariseRepeatability([])).toBeNull();
  });
});

describe("candidate limits and readings", () => {
  it("default limits are the PLAN.md numbers and are labelled candidate (未拍板)", () => {
    expect(CANDIDATE_THRESHOLDS.accuracyMm).toEqual({ handLengthMm: 2 });
    expect(CANDIDATE_THRESHOLDS.repeatabilityMm).toEqual({ handLengthMm: 1.5 });
    expect(CANDIDATE_THRESHOLDS.status).toMatch(/candidate/);
    expect(CANDIDATE_THRESHOLDS.status).toMatch(/未拍板/);
    expect(CANDIDATE_THRESHOLDS.status).toMatch(/W7/);
  });

  it("accuracy is read three ways and the three can disagree", () => {
    // MAE 1.4 is within 2, the worst photo (3) is not, and the limits of
    // agreement (-4.099 .. 2.099) are not.
    const readings = accuracyReadings(accuracyStats([-2, 0, 1, -3, -1])!, 2);
    expect(readings.map((r) => r.withinLimit)).toEqual([true, false, false]);
    expect(readings[0]!.valueMm).toBeCloseTo(1.4, 10);
    expect(readings[1]!.valueMm).toBe(3);
    expect(readings[2]!.valueMm).toBeCloseTo(4.099, 3);
  });

  it("a limit is inclusive", () => {
    const readings = accuracyReadings(accuracyStats([2, -2])!, 2);
    expect(readings[0]).toMatchObject({ valueMm: 2, withinLimit: true });
    expect(readings[1]).toMatchObject({ valueMm: 2, withinLimit: true });
  });

  it("one photo has no limits-of-agreement reading (null, not a pass)", () => {
    const readings = accuracyReadings(accuracyStats([1])!, 2);
    expect(readings[2]).toMatchObject({ valueMm: null, withinLimit: null });
  });

  it("repeatability is read three ways for the worst group", () => {
    const summary = summariseRepeatability([
      repeatabilityRow([188, 190, 191, 187, 189])!,
    ])!;
    // range 4 against 1.5 ; half-range 2 against 1.5 ; deviation 2 against 1.5
    const readings = repeatabilityReadings(summary, 1.5);
    expect(readings.map((r) => r.valueMm)).toEqual([4, 2, 2]);
    expect(readings.map((r) => r.withinLimit)).toEqual([false, false, false]);
    // With a wider limit the readings part ways: range 4 > 3 but half-range 2 <= 3.
    const wide = repeatabilityReadings(summary, 3);
    expect(wide.map((r) => r.withinLimit)).toEqual([false, true, true]);
  });

  it("limits come from a config file, checked", () => {
    expect(
      parseThresholds({ accuracyMm: { handLengthMm: 3 }, status: "agreed" }),
    ).toMatchObject({
      status: "agreed",
      accuracyMm: { handLengthMm: 3 },
      repeatabilityMm: {},
    });
    expect(parseThresholds({}).status).toMatch(/candidate/);
    expect(() => parseThresholds([])).toThrow(/object/);
    expect(() => parseThresholds({ extra: 1 })).toThrow(/Unknown key/);
    expect(() => parseThresholds({ accuracyMm: { handLengthMm: 0 } })).toThrow(
      /positive/,
    );
    expect(() =>
      parseThresholds({ repeatabilityMm: { handLengthMm: "1.5" } }),
    ).toThrow(/positive/);
  });
});
