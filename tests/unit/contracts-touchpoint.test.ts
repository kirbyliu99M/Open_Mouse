import { describe, expect, it } from "vitest";
import {
  ERROR_PHOTO_CODE_ALPHABET,
  ERROR_PHOTO_CONSENT_VERSION,
  ERROR_PHOTO_REFERENCES,
  ERROR_PHOTO_RETENTION_DAYS,
  errorPhotoCodeSchema,
  errorPhotoDeleteSchema,
  errorPhotoMetaSchema,
  errorPhotoResponseSchema,
} from "../../src/lib/contracts/error-photo";
import {
  HAND_SAMPLE_NOTICE_VERSION,
  roundSampleMm,
  sampleMonthOf,
} from "../../src/lib/contracts/hand-sample";
import {
  estimatePalmLengthMm,
  MANUAL_ENTRY,
  MEASUREMENT_MODEL_VERSION,
  PAPER_SIZES_MM,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";

const baseSubmission = {
  hand: "right",
  gripStyleStated: "claw",
  measurements: {
    handLengthMm: 185,
    palmLengthMm: estimatePalmLengthMm(185),
    palmWidthMm: 82,
  },
  calibration: {
    method: "manual-entry",
    handLengthMm: 185,
    handWidthMm: 82,
    palmLengthEstimated: true,
    palmLengthRatio: MANUAL_ENTRY.palmLengthRatio,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
};

describe("hand-sample contract", () => {
  it("rounds to whole millimetres and truncates time to the UTC month", () => {
    expect(roundSampleMm(189.6)).toBe(190);
    expect(roundSampleMm(84.4)).toBe(84);
    expect(
      sampleMonthOf(new Date("2026-11-08T23:59:00+08:00")).toISOString(),
    ).toBe("2026-11-01T00:00:00.000Z");
  });

  it("scan submission accepts the current notice version or no field, nothing else", () => {
    const ok = (v: unknown) => scanSubmissionSchema.safeParse(v).success;
    expect(ok(baseSubmission)).toBe(true);
    expect(
      ok({ ...baseSubmission, sampleNotice: HAND_SAMPLE_NOTICE_VERSION }),
    ).toBe(true);
    expect(
      ok({ ...baseSubmission, sampleNotice: "hand-sample-notice-v0" }),
    ).toBe(false);
    expect(ok({ ...baseSubmission, sampleNotice: true })).toBe(false);
  });
});

describe("error-photo contract", () => {
  it("references are the paper sizes plus the card", () => {
    expect([...ERROR_PHOTO_REFERENCES].sort()).toEqual(
      [...Object.keys(PAPER_SIZES_MM), "card"].sort(),
    );
  });

  it("keeps photos about six months", () => {
    expect(ERROR_PHOTO_RETENTION_DAYS).toBeGreaterThanOrEqual(179);
    expect(ERROR_PHOTO_RETENTION_DAYS).toBeLessThanOrEqual(180);
  });

  it("meta is strict and needs the consent version", () => {
    const ok = {
      consent: ERROR_PHOTO_CONSENT_VERSION,
      trigger: "numbers-wrong",
      reference: "card",
      measured: { handLengthMm: 183, palmWidthMm: 80 },
      widthPx: 1200,
      heightPx: 900,
    };
    expect(errorPhotoMetaSchema.safeParse(ok).success).toBe(true);
    expect(
      errorPhotoMetaSchema.safeParse({ ...ok, consent: "x" }).success,
    ).toBe(false);
    expect(
      errorPhotoMetaSchema.safeParse({ ...ok, userAgent: "Mozilla" }).success,
    ).toBe(false);
    expect(
      errorPhotoMetaSchema.safeParse({ ...ok, failureCode: "no hand!" })
        .success,
    ).toBe(false);
  });

  it("the code alphabet is exactly what the code schema accepts", () => {
    expect(ERROR_PHOTO_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(ERROR_PHOTO_CODE_ALPHABET).size).toBe(32);
    for (const ch of ERROR_PHOTO_CODE_ALPHABET) {
      expect(errorPhotoCodeSchema.safeParse(ch.repeat(12)).success).toBe(true);
    }
    for (const ch of "01IO") {
      expect(errorPhotoCodeSchema.safeParse(ch.repeat(12)).success).toBe(false);
    }
  });

  it("deletion codes use the unambiguous 12-character alphabet", () => {
    expect(
      errorPhotoResponseSchema.safeParse({ deleteCode: "ABCD2345EFGH" })
        .success,
    ).toBe(true);
    expect(
      errorPhotoResponseSchema.safeParse({ deleteCode: "ABCD0O1IEFGH" })
        .success,
    ).toBe(false);
    expect(errorPhotoDeleteSchema.parse({ code: " abcd2345efgh " }).code).toBe(
      "ABCD2345EFGH",
    );
  });
});
