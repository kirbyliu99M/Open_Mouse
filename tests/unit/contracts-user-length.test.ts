import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";

const userLength = {
  method: "user-length",
  referenceMeasurement: "handLengthMm",
  referenceMm: 186,
  parallaxCorrected: false,
} as const;

const body = (handLengthMm: number, calibration: unknown = userLength) => ({
  hand: "right",
  measurements: { handLengthMm, palmLengthMm: 105, palmWidthMm: 82 },
  calibration,
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

describe("scanSubmissionSchema — typed-in hand length (no paper)", () => {
  it("accepts a user-length calibration whose hand length equals the typed value", () => {
    expect(scanSubmissionSchema.safeParse(body(186)).success).toBe(true);
  });

  it("rejects a hand length that differs from the typed value, at measurements.handLengthMm", () => {
    const r = scanSubmissionSchema.safeParse(body(190));
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain(
      "measurements.handLengthMm",
    );
  });

  it("rejects parallaxCorrected: true (there is no reference to correct against)", () => {
    const r = scanSubmissionSchema.safeParse(
      body(186, { ...userLength, parallaxCorrected: true }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects a typed length outside 100–280 mm", () => {
    for (const referenceMm of [99, 281]) {
      const r = scanSubmissionSchema.safeParse(
        body(referenceMm, { ...userLength, referenceMm }),
      );
      expect(r.success).toBe(false);
    }
  });

  it("rejects extra fields on the user-length evidence (strict)", () => {
    const r = scanSubmissionSchema.safeParse(
      body(186, { ...userLength, cardScaleRatio: 1 }),
    );
    expect(r.success).toBe(false);
  });

  it("does not apply the equality rule to other calibration methods", () => {
    const r = scanSubmissionSchema.safeParse(
      body(190, {
        method: "paper-edge",
        paperSize: "a4",
        edgeFitResidualMm: 0.5,
        minSideCoverage: 0.8,
        parallaxCorrected: true,
      }),
    );
    expect(r.success).toBe(true);
  });
});
