import { describe, expect, it } from "vitest";
import { assemblePaperEdgeSubmission } from "../../src/client/photo/submission";
import {
  scanSubmissionSchema,
  MEASUREMENT_MODEL_VERSION,
  PAPER_EDGE_LIMITS,
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

describe("assemblePaperEdgeSubmission", () => {
  it("builds a submission that satisfies scanSubmissionSchema", () => {
    const submission = assemblePaperEdgeSubmission({
      hand: "right",
      measurements: VALID_MEASUREMENTS,
      paperSize: "a4",
      edgeFitResidualMm: 0.4,
      minSideCoverage: 0.9,
      parallaxCorrected: true,
    });
    expect(scanSubmissionSchema.safeParse(submission).success).toBe(true);
    expect(submission.hand).toBe("right");
    expect(submission.measurementModelVersion).toBe(MEASUREMENT_MODEL_VERSION);
    expect(submission.calibration).toEqual({
      method: "paper-edge",
      paperSize: "a4",
      edgeFitResidualMm: 0.4,
      minSideCoverage: 0.9,
      parallaxCorrected: true,
    });
    expect(submission.gripStyleStated).toBeUndefined();
  });

  it("includes gripStyleStated only when provided", () => {
    const submission = assemblePaperEdgeSubmission({
      hand: "left",
      gripStyleStated: "fingertip",
      measurements: VALID_MEASUREMENTS,
      paperSize: "letter",
      edgeFitResidualMm: 0.2,
      minSideCoverage: 1,
      parallaxCorrected: false,
    });
    expect(submission.gripStyleStated).toBe("fingertip");
    expect(submission.calibration.paperSize).toBe("letter");
  });

  it("passes parallaxCorrected through honestly (not hardcoded false)", () => {
    const corrected = assemblePaperEdgeSubmission({
      hand: "right",
      measurements: VALID_MEASUREMENTS,
      paperSize: "a4",
      edgeFitResidualMm: 0.1,
      minSideCoverage: 1,
      parallaxCorrected: true,
    });
    const uncorrected = assemblePaperEdgeSubmission({
      hand: "right",
      measurements: VALID_MEASUREMENTS,
      paperSize: "a4",
      edgeFitResidualMm: 0.1,
      minSideCoverage: 1,
      parallaxCorrected: false,
    });
    expect(corrected.calibration.parallaxCorrected).toBe(true);
    expect(uncorrected.calibration.parallaxCorrected).toBe(false);
  });

  it("throws when the residual exceeds PAPER_EDGE_LIMITS.maxEdgeFitResidualMm", () => {
    expect(() =>
      assemblePaperEdgeSubmission({
        hand: "right",
        measurements: VALID_MEASUREMENTS,
        paperSize: "a4",
        edgeFitResidualMm: PAPER_EDGE_LIMITS.maxEdgeFitResidualMm + 0.5,
        minSideCoverage: 1,
        parallaxCorrected: false,
      }),
    ).toThrow();
  });

  it("throws when coverage is below PAPER_EDGE_LIMITS.minSideCoverage", () => {
    expect(() =>
      assemblePaperEdgeSubmission({
        hand: "right",
        measurements: VALID_MEASUREMENTS,
        paperSize: "a4",
        edgeFitResidualMm: 0.1,
        minSideCoverage: PAPER_EDGE_LIMITS.minSideCoverage - 0.1,
        parallaxCorrected: false,
      }),
    ).toThrow();
  });

  it("throws when measurements are internally inconsistent", () => {
    expect(() =>
      assemblePaperEdgeSubmission({
        hand: "right",
        measurements: { ...VALID_MEASUREMENTS, palmLengthMm: 200 },
        paperSize: "a4",
        edgeFitResidualMm: 0.1,
        minSideCoverage: 1,
        parallaxCorrected: false,
      }),
    ).toThrow();
  });

  it("never emits printed-sheet-only fields (markerIds, cardScaleRatio, reprojectionErrorMm)", () => {
    const submission = assemblePaperEdgeSubmission({
      hand: "right",
      measurements: VALID_MEASUREMENTS,
      paperSize: "a4",
      edgeFitResidualMm: 0.1,
      minSideCoverage: 1,
      parallaxCorrected: false,
    });
    expect(submission.calibration).not.toHaveProperty("markerIds");
    expect(submission.calibration).not.toHaveProperty("cardScaleRatio");
    expect(submission.calibration).not.toHaveProperty("reprojectionErrorMm");
  });
});
