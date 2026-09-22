import { describe, expect, it } from "vitest";
import { assembleScanSubmission } from "../../src/client/photo/submission";
import {
  MEASUREMENT_MODEL_VERSION,
  type HandMeasurements,
} from "../../src/lib/contracts/measurement";

const VALID_MEASUREMENTS: HandMeasurements = {
  handLengthMm: 185,
  palmLengthMm: 105,
  palmWidthMm: 85,
  thumbLengthMm: 60,
  indexLengthMm: 70,
  middleLengthMm: 75,
  ringLengthMm: 72,
  pinkyLengthMm: 55,
};

describe("assembleScanSubmission", () => {
  it("builds a submission that satisfies scanSubmissionSchema", () => {
    const submission = assembleScanSubmission({
      hand: "right",
      measurements: VALID_MEASUREMENTS,
      markerIds: [3, 1, 0, 2],
      reprojectionErrorMm: 0.4,
      cardScaleRatio: 1.002,
    });
    expect(submission.hand).toBe("right");
    expect(submission.measurementModelVersion).toBe(MEASUREMENT_MODEL_VERSION);
    expect(submission.calibration.parallaxCorrected).toBe(false);
    expect(submission.calibration.markerIds).toEqual([0, 1, 2, 3]); // sorted
    expect(submission.gripStyleStated).toBeUndefined();
  });

  it("includes gripStyleStated only when provided", () => {
    const submission = assembleScanSubmission({
      hand: "left",
      gripStyleStated: "claw",
      measurements: VALID_MEASUREMENTS,
      markerIds: [0, 1, 2, 3],
      reprojectionErrorMm: 0.1,
      cardScaleRatio: 1.0,
    });
    expect(submission.gripStyleStated).toBe("claw");
  });

  it("always sets parallaxCorrected to false, regardless of caller intent", () => {
    const submission = assembleScanSubmission({
      hand: "right",
      measurements: VALID_MEASUREMENTS,
      markerIds: [0, 1, 2, 3],
      reprojectionErrorMm: 0.1,
      cardScaleRatio: 1.0,
    });
    expect(submission.calibration.parallaxCorrected).toBe(false);
  });

  it("throws when the calibration evidence violates the contract (bad marker ids)", () => {
    expect(() =>
      assembleScanSubmission({
        hand: "right",
        measurements: VALID_MEASUREMENTS,
        markerIds: [0, 1, 2, 2], // not 4 distinct ids
        reprojectionErrorMm: 0.1,
        cardScaleRatio: 1.0,
      }),
    ).toThrow();
  });

  it("throws when card scale disagreement exceeds 1%", () => {
    expect(() =>
      assembleScanSubmission({
        hand: "right",
        measurements: VALID_MEASUREMENTS,
        markerIds: [0, 1, 2, 3],
        reprojectionErrorMm: 0.1,
        cardScaleRatio: 1.05,
      }),
    ).toThrow(/printer/i);
  });

  it("throws when measurements are internally inconsistent (palm longer than hand)", () => {
    expect(() =>
      assembleScanSubmission({
        hand: "right",
        measurements: { ...VALID_MEASUREMENTS, palmLengthMm: 200 },
        markerIds: [0, 1, 2, 3],
        reprojectionErrorMm: 0.1,
        cardScaleRatio: 1.0,
      }),
    ).toThrow();
  });
});
