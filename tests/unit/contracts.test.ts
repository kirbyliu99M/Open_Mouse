import { describe, expect, it } from "vitest";
import {
  SHEET,
  MAX_SCALE_DISAGREEMENT,
  MEASUREMENT_MODEL_VERSION,
  PALM_THICKNESS_LEVELS,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";

const valid = {
  hand: "right",
  gripStyleStated: "claw",
  measurements: { handLengthMm: 190, palmLengthMm: 108, palmWidthMm: 84 },
  calibration: {
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.4,
    cardScaleRatio: 1.004,
    parallaxCorrected: true,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
} as const;

describe("scanSubmissionSchema", () => {
  it("accepts a plausible submission", () => {
    expect(scanSubmissionSchema.safeParse(valid).success).toBe(true);
  });

  it("blocks a scan whose printer scaled the page", () => {
    const r = scanSubmissionSchema.safeParse({
      ...valid,
      calibration: {
        ...valid.calibration,
        cardScaleRatio: 1 + MAX_SCALE_DISAGREEMENT + 0.001,
      },
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/printer/);
  });

  it.each([
    [
      "palm longer than hand",
      { handLengthMm: 150, palmLengthMm: 151, palmWidthMm: 80 },
    ],
    [
      "hand implausibly small",
      { handLengthMm: 60, palmLengthMm: 40, palmWidthMm: 80 },
    ],
    [
      "palm width not a number",
      { handLengthMm: 190, palmLengthMm: 108, palmWidthMm: Number.NaN },
    ],
  ])("rejects %s", (_, measurements) => {
    expect(
      scanSubmissionSchema.safeParse({ ...valid, measurements }).success,
    ).toBe(false);
  });

  it("rejects fewer than four markers and unknown model versions", () => {
    expect(
      scanSubmissionSchema.safeParse({
        ...valid,
        calibration: { ...valid.calibration, markerIds: [0, 1, 2] },
      }).success,
    ).toBe(false);
    expect(
      scanSubmissionSchema.safeParse({
        ...valid,
        measurementModelVersion: "v0",
      }).success,
    ).toBe(false);
  });

  describe("palmThicknessStated", () => {
    it("is optional: a skipped question sends no field and still parses", () => {
      expect(valid).not.toHaveProperty("palmThicknessStated");
      const r = scanSubmissionSchema.safeParse(valid);
      expect(r.success).toBe(true);
      expect(r.data).not.toHaveProperty("palmThicknessStated");
    });

    it.each(PALM_THICKNESS_LEVELS)("accepts %s and keeps it", (level) => {
      const r = scanSubmissionSchema.safeParse({
        ...valid,
        palmThicknessStated: level,
      });
      expect(r.success).toBe(true);
      expect(r.data?.palmThicknessStated).toBe(level);
    });

    it("lists exactly thin, medium and thick, in that order", () => {
      expect([...PALM_THICKNESS_LEVELS]).toEqual(["thin", "medium", "thick"]);
    });

    it.each([
      ["wrong case", "Thick"],
      ["a millimetre value", 24],
      ["null", null],
      ["an empty string", ""],
      ["an unknown label", "average"],
    ])("rejects %s instead of treating it as a skip", (_, bad) => {
      expect(
        scanSubmissionSchema.safeParse({ ...valid, palmThicknessStated: bad })
          .success,
      ).toBe(false);
    });

    it("sits beside, not inside, the measured palmThicknessMm", () => {
      const both = scanSubmissionSchema.safeParse({
        ...valid,
        palmThicknessStated: "thin",
        measurements: { ...valid.measurements, palmThicknessMm: 22 },
      });
      expect(both.success).toBe(true);
      expect(
        scanSubmissionSchema.safeParse({
          ...valid,
          measurements: { ...valid.measurements, palmThicknessStated: "thin" },
        }).success,
      ).toBe(false);
    });
  });

  it("rejects a payload carrying an image instead of silently stripping it", () => {
    const r = scanSubmissionSchema.safeParse({
      ...valid,
      image: "data:image/png;base64,AAAA",
    });
    expect(r.success).toBe(false);
  });

  it.each([
    ["a duplicated marker", [0, 0, 2, 3]],
    ["an upright-flap marker", [0, 1, 2, 4]],
    ["an unknown marker", [0, 1, 2, 9]],
  ])("rejects markerIds with %s", (_, markerIds) => {
    expect(
      scanSubmissionSchema.safeParse({
        ...valid,
        calibration: { ...valid.calibration, markerIds },
      }).success,
    ).toBe(false);
  });

  it("accepts the four flat-flap markers in any order", () => {
    expect(
      scanSubmissionSchema.safeParse({
        ...valid,
        calibration: { ...valid.calibration, markerIds: [3, 1, 0, 2] },
      }).success,
    ).toBe(true);
  });
});

describe("SHEET geometry", () => {
  it("is internally consistent: centre square + one marker = outer extent", () => {
    expect(SHEET.markerCentreSquareMm + SHEET.markerSizeMm).toBe(
      SHEET.markerLayoutOuterMm,
    );
  });

  it.each([
    ["A4", 210],
    ["US Letter", 215.9],
  ])("leaves printable side margins on %s", (_, paperWidthMm) => {
    expect(
      (paperWidthMm - SHEET.markerLayoutOuterMm) / 2,
    ).toBeGreaterThanOrEqual(10);
  });
});
