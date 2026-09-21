import { describe, expect, it } from "vitest";
import {
  MAX_SCALE_DISAGREEMENT,
  MEASUREMENT_MODEL_VERSION,
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

  it("carries no image field — the privacy invariant is structural", () => {
    const r = scanSubmissionSchema.safeParse({
      ...valid,
      image: "data:image/png;base64,AAAA",
    });
    expect(r.success && "image" in r.data).toBe(false);
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
