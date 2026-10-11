import { describe, expect, it } from "vitest";
import {
  estimatePalmLengthMm,
  MANUAL_ENTRY,
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";
import { en, zhTW } from "../../src/lib/copy/manualEntry";
import {
  buildManualEntrySubmission,
  EMPTY_DRAFT,
  firstProblemTarget,
  checkHandLength,
  checkHandWidth,
  checkManualEntry,
  fieldProblemMessage,
  formatCentimetres,
  parseCentimetres,
  widthRangeForLength,
} from "../../src/lib/scan/manualEntry";

describe("parseCentimetres", () => {
  it("turns one decimal of a centimetre into whole millimetres", () => {
    expect(parseCentimetres("18.5")).toEqual({ ok: true, mm: 185 });
    expect(parseCentimetres("8.2")).toEqual({ ok: true, mm: 82 });
    expect(parseCentimetres("19")).toEqual({ ok: true, mm: 190 });
    expect(parseCentimetres("0.1")).toEqual({ ok: true, mm: 1 });
  });

  it("accepts a comma as the decimal mark, spaces around, and full-width digits", () => {
    expect(parseCentimetres("18,5")).toEqual({ ok: true, mm: 185 });
    expect(parseCentimetres("  18.5  ")).toEqual({ ok: true, mm: 185 });
    expect(parseCentimetres("１８．５")).toEqual({ ok: true, mm: 185 });
    // The ideographic full stop, the "." key of a Chinese input method.
    expect(parseCentimetres("18。5")).toEqual({ ok: true, mm: 185 });
    expect(parseCentimetres("１８。５")).toEqual({ ok: true, mm: 185 });
  });

  it("is exact where floating point is not (no 18.5 * 10 style drift)", () => {
    for (let mm = 1; mm <= 999; mm += 1) {
      expect(parseCentimetres((mm / 10).toFixed(1))).toEqual({ ok: true, mm });
    }
  });

  it("takes zeros after the one decimal (18.50 is 18.5), nothing else", () => {
    expect(parseCentimetres("18.50")).toEqual({ ok: true, mm: 185 });
    expect(parseCentimetres("18.00")).toEqual({ ok: true, mm: 180 });
    expect(parseCentimetres("18,500")).toEqual({ ok: true, mm: 185 });
  });

  it("refuses two real decimals instead of rounding them (18.55)", () => {
    for (const raw of ["18.55", "18.05", "18.51", "18.505"]) {
      expect(parseCentimetres(raw), raw).toEqual({
        ok: false,
        problem: "tooManyDecimals",
      });
    }
  });

  it("refuses an unfinished number: a decimal mark needs a digit after it", () => {
    for (const raw of ["18.", "18,", "18。", " 18. "]) {
      expect(parseCentimetres(raw), raw).toEqual({
        ok: false,
        problem: "notNumber",
      });
    }
  });

  it("calls an empty string empty, and anything else that is not a number not a number", () => {
    expect(parseCentimetres("")).toEqual({ ok: false, problem: "empty" });
    expect(parseCentimetres("   ")).toEqual({ ok: false, problem: "empty" });
    for (const bad of [
      "abc",
      "18.5cm",
      "18.5 cm",
      "-18.5",
      "+18.5",
      "1e2",
      "18..5",
      "1.2.3",
      ".5",
      ",",
      "1 8",
      "1234",
      "NaN",
    ]) {
      expect(parseCentimetres(bad), bad).toEqual({
        ok: false,
        problem: "notNumber",
      });
    }
  });
});

describe("formatCentimetres", () => {
  it("shows whole mm as one-decimal cm", () => {
    expect(formatCentimetres(185)).toBe("18.5");
    expect(formatCentimetres(135)).toBe("13.5");
    expect(formatCentimetres(150)).toBe("15.0");
  });
});

describe("hand length", () => {
  it("takes the contract range, ends included", () => {
    expect(MANUAL_ENTRY.handLengthRangeMm).toEqual({ min: 135, max: 265 });
    expect(checkHandLength("13.5").mm).toBe(135);
    expect(checkHandLength("26.5").mm).toBe(265);
    expect(checkHandLength("18.5").problem).toBeNull();
  });

  it("refuses 13.4 cm and 26.6 cm, one step outside, and says the range", () => {
    expect(checkHandLength("13.4")).toEqual({
      mm: null,
      problem: { code: "outOfRange", side: "low", minMm: 135, maxMm: 265 },
    });
    expect(checkHandLength("26.6")).toEqual({
      mm: null,
      problem: { code: "outOfRange", side: "high", minMm: 135, maxMm: 265 },
    });
    expect(checkHandLength("28.0").problem).toMatchObject({
      code: "outOfRange",
    });
  });

  it("says what is wrong, with the allowed range, in both languages", () => {
    const problem = checkHandLength("28.0").problem!;
    expect(fieldProblemMessage(zhTW, "length", problem)).toContain("手長");
    expect(fieldProblemMessage(zhTW, "length", problem)).toContain("13.5");
    expect(fieldProblemMessage(zhTW, "length", problem)).toContain("26.5");
    expect(fieldProblemMessage(en, "length", problem)).toContain("13.5");
    expect(fieldProblemMessage(en, "length", problem)).toContain("26.5");
  });

  it("reports an empty field as empty, a typo as not a number", () => {
    expect(checkHandLength("").problem).toEqual({ code: "empty" });
    expect(checkHandLength("1x").problem).toEqual({ code: "notNumber" });
    expect(checkHandLength("18.55").problem).toEqual({
      code: "tooManyDecimals",
    });
  });
});

describe("hand width", () => {
  it("refuses a width outside the contract range", () => {
    expect(MANUAL_ENTRY.handWidthRangeMm).toEqual({ min: 50, max: 150 });
    expect(checkHandWidth("4.9", null).problem).toMatchObject({
      code: "outOfRange",
      side: "low",
    });
    expect(checkHandWidth("15.1", null).problem).toMatchObject({
      code: "outOfRange",
      side: "high",
    });
    expect(checkHandWidth("5.0", null).mm).toBe(50);
  });

  it("judges the width against the typed length: a ratio outside the band is refused", () => {
    // 18.5 cm long: 0.38 -> 70.3 mm, 0.56 -> 103.6 mm, so 71..103 mm.
    expect(widthRangeForLength(185)).toEqual({ minMm: 71, maxMm: 103 });
    expect(checkHandWidth("8.2", 185).mm).toBe(82);
    expect(checkHandWidth("7.1", 185).mm).toBe(71);
    expect(checkHandWidth("10.3", 185).mm).toBe(103);
    expect(checkHandWidth("7.0", 185).problem).toEqual({
      code: "widthVsLength",
      side: "narrow",
      lengthMm: 185,
      minMm: 71,
      maxMm: 103,
    });
    expect(checkHandWidth("10.4", 185).problem).toMatchObject({
      code: "widthVsLength",
      side: "wide",
    });
  });

  it("names the width that fits the length in the message", () => {
    const problem = checkHandWidth("7.0", 185).problem!;
    for (const copy of [zhTW, en]) {
      const text = fieldProblemMessage(copy, "width", problem);
      expect(text).toContain("18.5");
      expect(text).toContain("7.1");
      expect(text).toContain("10.3");
    }
  });

  it("has a non-empty set of fitting widths for every length it accepts", () => {
    for (let mm = 135; mm <= 265; mm += 1) {
      const range = widthRangeForLength(mm);
      expect(range, `${mm}`).not.toBeNull();
      expect(range!.minMm).toBeGreaterThanOrEqual(50);
      expect(range!.maxMm).toBeLessThanOrEqual(150);
    }
  });

  it("agrees with the schema at the edges of the band, for every fifth length", () => {
    for (let mm = 135; mm <= 265; mm += 5) {
      const range = widthRangeForLength(mm)!;
      const body = (width: number) => ({
        hand: "right",
        gripStyleStated: "claw",
        measurements: {
          handLengthMm: mm,
          palmLengthMm: estimatePalmLengthMm(mm),
          palmWidthMm: width,
        },
        calibration: {
          method: "manual-entry",
          handLengthMm: mm,
          handWidthMm: width,
          palmLengthEstimated: true,
          palmLengthRatio: MANUAL_ENTRY.palmLengthRatio,
          parallaxCorrected: false,
        },
        measurementModelVersion: MEASUREMENT_MODEL_VERSION,
      });
      expect(
        scanSubmissionSchema.safeParse(body(range.minMm)).success,
        `${mm} min`,
      ).toBe(true);
      expect(
        scanSubmissionSchema.safeParse(body(range.maxMm)).success,
        `${mm} max`,
      ).toBe(true);
      if (range.minMm > 50)
        expect(
          scanSubmissionSchema.safeParse(body(range.minMm - 1)).success,
          `${mm} below`,
        ).toBe(false);
      if (range.maxMm < 150)
        expect(
          scanSubmissionSchema.safeParse(body(range.maxMm + 1)).success,
          `${mm} above`,
        ).toBe(false);
    }
  });

  it("does not compare the width with a length that is not valid yet", () => {
    expect(checkHandWidth("8.2", null).mm).toBe(82);
  });
});

describe("checkManualEntry", () => {
  it("is valid only when both numbers are", () => {
    expect(checkManualEntry("18.5", "8.2").valid).toBe(true);
    expect(checkManualEntry("", "8.2").valid).toBe(false);
    expect(checkManualEntry("18.5", "").valid).toBe(false);
    expect(checkManualEntry("13.4", "8.2").valid).toBe(false);
    expect(checkManualEntry("18.5", "12.0").valid).toBe(false);
  });

  it("re-judges the width when the length changes", () => {
    expect(checkManualEntry("18.5", "10.3").valid).toBe(true);
    expect(checkManualEntry("14.0", "10.3").valid).toBe(false);
  });
});

describe("buildManualEntrySubmission", () => {
  const input = {
    hand: "right",
    handLengthMm: 185,
    handWidthMm: 82,
    grip: "claw",
  } as const;

  it("passes the contract scanSubmissionSchema", () => {
    const submission = buildManualEntrySubmission(input);
    expect(scanSubmissionSchema.safeParse(submission).success).toBe(true);
    expect(submission.hand).toBe("right");
    expect(submission.gripStyleStated).toBe("claw");
    expect(submission.measurementModelVersion).toBe(MEASUREMENT_MODEL_VERSION);
    expect(submission.calibration).toEqual({
      method: "manual-entry",
      handLengthMm: 185,
      handWidthMm: 82,
      palmLengthEstimated: true,
      palmLengthRatio: MANUAL_ENTRY.palmLengthRatio,
      parallaxCorrected: false,
    });
  });

  it("holds the typed length and width, and the palm length is the contract estimate", () => {
    const { measurements } = buildManualEntrySubmission(input);
    expect(measurements.handLengthMm).toBe(185);
    expect(measurements.palmWidthMm).toBe(82);
    expect(measurements.palmLengthMm).toBe(estimatePalmLengthMm(185));
    expect(measurements.palmLengthMm).toBe(103.6);
    // Not the typed length, and not the width.
    expect(measurements.palmLengthMm).not.toBe(185);
    expect(measurements.palmLengthMm).not.toBe(82);
  });

  it("carries no scan-only field, nothing but the three measurements", () => {
    const submission = buildManualEntrySubmission(input);
    expect(Object.keys(submission.measurements).sort()).toEqual([
      "handLengthMm",
      "palmLengthMm",
      "palmWidthMm",
    ]);
    expect(Object.keys(submission).sort()).toEqual([
      "calibration",
      "gripStyleStated",
      "hand",
      "measurementModelVersion",
      "measurements",
    ]);
    expect(JSON.stringify(submission)).not.toMatch(
      /thumb|index|middle|ring|pinky|Thickness|knuckle|Aperture/,
    );
  });

  it("works for both hands and every grip", () => {
    for (const hand of ["left", "right"] as const)
      for (const grip of ["palm", "claw", "fingertip"] as const)
        expect(
          scanSubmissionSchema.safeParse(
            buildManualEntrySubmission({ ...input, hand, grip }),
          ).success,
        ).toBe(true);
  });

  it("throws on a pair the contract refuses", () => {
    expect(() =>
      buildManualEntrySubmission({ ...input, handLengthMm: 134 }),
    ).toThrow();
    expect(() =>
      buildManualEntrySubmission({ ...input, handWidthMm: 120 }),
    ).toThrow();
    expect(() =>
      buildManualEntrySubmission({ ...input, handWidthMm: 70 }),
    ).toThrow();
  });

  it("refuses a missing grip at runtime too (the type forbids it, a cast must not slip through)", () => {
    expect(() =>
      buildManualEntrySubmission({
        ...input,
        grip: undefined as unknown as "claw",
      }),
    ).toThrow();
  });

  it("a payload that sent the typed length as the palm length would not pass the schema", () => {
    const good = buildManualEntrySubmission(input);
    const bad = {
      ...good,
      measurements: { ...good.measurements, palmLengthMm: 185 },
    };
    expect(scanSubmissionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("firstProblemTarget (where focus goes when the button is pressed too early)", () => {
  const good = { hand: "right", lengthText: "18.5", widthText: "8.2" } as const;

  it("is null when nothing is wrong", () => {
    expect(firstProblemTarget(good)).toBeNull();
  });

  it("names the first thing wrong in the order the form shows: hand, length, width", () => {
    expect(firstProblemTarget(EMPTY_DRAFT)).toBe("hand");
    expect(firstProblemTarget({ ...good, hand: null })).toBe("hand");
    expect(firstProblemTarget({ ...good, hand: null, lengthText: "" })).toBe(
      "hand",
    );
    expect(firstProblemTarget({ ...good, lengthText: "" })).toBe("length");
    expect(firstProblemTarget({ ...good, lengthText: "28" })).toBe("length");
    expect(firstProblemTarget({ ...good, lengthText: "", widthText: "" })).toBe(
      "length",
    );
    expect(firstProblemTarget({ ...good, widthText: "" })).toBe("width");
    expect(firstProblemTarget({ ...good, widthText: "12.0" })).toBe("width");
  });

  it("starts empty: no hand, no text", () => {
    expect(EMPTY_DRAFT).toEqual({ hand: null, lengthText: "", widthText: "" });
  });
});
