import { describe, expect, it } from "vitest";
import {
  CALIBRATION_METHODS,
  calibrationMethodOf,
  estimatePalmLengthMm,
  MANUAL_ENTRY,
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";

const evidence = {
  method: "manual-entry",
  handLengthMm: 185,
  handWidthMm: 82,
  palmLengthEstimated: true,
  palmLengthRatio: MANUAL_ENTRY.palmLengthRatio,
  parallaxCorrected: false,
} as const;

const body = (over: Record<string, unknown> = {}) => ({
  hand: "right",
  gripStyleStated: "claw",
  measurements: {
    handLengthMm: 185,
    palmLengthMm: estimatePalmLengthMm(185),
    palmWidthMm: 82,
  },
  calibration: evidence,
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  ...over,
});

const paths = (input: unknown) => {
  const r = scanSubmissionSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("scanSubmissionSchema: typed numbers without a photo (manual-entry)", () => {
  it("accepts typed length and width with an estimated palm length and a stated grip", () => {
    expect(scanSubmissionSchema.safeParse(body()).success).toBe(true);
    expect(calibrationMethodOf(evidence)).toBe("manual-entry");
    expect(CALIBRATION_METHODS).toContain("manual-entry");
  });

  it("estimates the palm length as the placeholder ratio times the hand length, to 0.1 mm", () => {
    expect(MANUAL_ENTRY.palmLengthRatio).toBe(0.56);
    expect(estimatePalmLengthMm(185)).toBe(103.6);
  });

  it("requires a stated grip, because the estimate carries no grip signal", () => {
    const noGrip: Record<string, unknown> = body();
    delete noGrip.gripStyleStated;
    expect(paths(noGrip)).toContain("gripStyleStated");
  });

  it("rejects a hand length, width or palm length that differs from the typed pair", () => {
    expect(
      paths(
        body({
          measurements: {
            handLengthMm: 190,
            palmLengthMm: 103.6,
            palmWidthMm: 82,
          },
        }),
      ),
    ).toContain("measurements.handLengthMm");
    expect(
      paths(
        body({
          measurements: {
            handLengthMm: 185,
            palmLengthMm: 103.6,
            palmWidthMm: 85,
          },
        }),
      ),
    ).toContain("measurements.palmWidthMm");
    expect(
      paths(
        body({
          measurements: {
            handLengthMm: 185,
            palmLengthMm: 110,
            palmWidthMm: 82,
          },
        }),
      ),
    ).toContain("measurements.palmLengthMm");
  });

  it("rejects a width that does not fit the length (0.38-0.56 band), at calibration.handWidthMm", () => {
    const wide = {
      ...evidence,
      handWidthMm: 120,
    };
    const r = body({
      measurements: {
        handLengthMm: 185,
        palmLengthMm: 103.6,
        palmWidthMm: 120,
      },
      calibration: wide,
    });
    expect(paths(r)).toContain("calibration.handWidthMm");
  });

  it("rejects a typed length outside 135-265 mm", () => {
    for (const handLengthMm of [134, 266]) {
      const cal = { ...evidence, handLengthMm };
      expect(
        scanSubmissionSchema.safeParse(
          body({
            measurements: {
              handLengthMm,
              palmLengthMm: estimatePalmLengthMm(handLengthMm),
              palmWidthMm: 82,
            },
            calibration: cal,
          }),
        ).success,
      ).toBe(false);
    }
  });

  // Every optional scan-only measurement, with a value that is fine on its own
  // (so a rejection can only be the manual-entry rule).
  const SCAN_ONLY = {
    thumbLengthMm: 60,
    indexLengthMm: 70,
    middleLengthMm: 75,
    ringLengthMm: 70,
    pinkyLengthMm: 55,
    palmThicknessMm: 30,
    knuckleHeightMm: 40,
    gripApertureMm: 100,
    thumbAngleDeg: 45,
  } as const;

  it("lists all nine scan-only fields (the test would be vacuous otherwise)", () => {
    expect(Object.keys(SCAN_ONLY)).toHaveLength(9);
  });

  it.each(Object.entries(SCAN_ONLY))(
    "rejects the scan-only field %s, so scan values never mix into a typed record",
    (key, value) => {
      const measurements = {
        handLengthMm: 185,
        palmLengthMm: 103.6,
        palmWidthMm: 82,
        [key]: value,
      };
      // Fine for a photo scan (paper-edge)...
      expect(
        scanSubmissionSchema.safeParse(
          body({
            measurements,
            calibration: {
              method: "paper-edge",
              paperSize: "a4",
              edgeFitResidualMm: 0.6,
              minSideCoverage: 0.92,
              parallaxCorrected: true,
            },
          }),
        ).success,
      ).toBe(true);
      // ...and for the typed record it is exactly this one field that is refused.
      expect(paths(body({ measurements }))).toEqual([`measurements.${key}`]);
    },
  );

  describe("the tolerances between the typed pair and the stored measurements", () => {
    const withMeasurements = (over: Record<string, number>) =>
      body({
        measurements: {
          handLengthMm: 185,
          palmLengthMm: 103.6,
          palmWidthMm: 82,
          ...over,
        },
      });

    it("palm length: within 0.1 mm of hand length x ratio passes, beyond it is refused", () => {
      // 185 x 0.56 = 103.6.
      for (const palmLengthMm of [103.51, 103.6, 103.69]) {
        expect(
          paths(withMeasurements({ palmLengthMm })),
          String(palmLengthMm),
        ).toEqual([]);
      }
      for (const palmLengthMm of [103.49, 103.71]) {
        expect(
          paths(withMeasurements({ palmLengthMm })),
          String(palmLengthMm),
        ).toEqual(["measurements.palmLengthMm"]);
      }
    });

    it("hand length: within 0.05 mm of the typed length passes, beyond it is refused", () => {
      for (const handLengthMm of [184.96, 185, 185.04]) {
        expect(
          paths(withMeasurements({ handLengthMm })),
          String(handLengthMm),
        ).toEqual([]);
      }
      for (const handLengthMm of [184.94, 185.06]) {
        expect(
          paths(withMeasurements({ handLengthMm })),
          String(handLengthMm),
        ).toEqual(["measurements.handLengthMm"]);
      }
    });

    it("hand width: within 0.05 mm of the typed width passes, beyond it is refused", () => {
      for (const palmWidthMm of [81.96, 82, 82.04]) {
        expect(
          paths(withMeasurements({ palmWidthMm })),
          String(palmWidthMm),
        ).toEqual([]);
      }
      for (const palmWidthMm of [81.94, 82.06]) {
        expect(
          paths(withMeasurements({ palmWidthMm })),
          String(palmWidthMm),
        ).toEqual(["measurements.palmWidthMm"]);
      }
    });
  });

  it("is strict: palmLengthEstimated must be true, parallax false, no extra fields", () => {
    for (const bad of [
      { ...evidence, palmLengthEstimated: false },
      { ...evidence, parallaxCorrected: true },
      { ...evidence, referenceMm: 185 },
    ]) {
      expect(
        scanSubmissionSchema.safeParse(body({ calibration: bad })).success,
      ).toBe(false);
    }
  });
});
