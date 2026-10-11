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

  it("rejects scan-only optional fields, so scan values never mix into a typed record", () => {
    expect(
      paths(
        body({
          measurements: {
            handLengthMm: 185,
            palmLengthMm: 103.6,
            palmWidthMm: 82,
            indexLengthMm: 70,
          },
        }),
      ),
    ).toContain("measurements.indexLengthMm");
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
