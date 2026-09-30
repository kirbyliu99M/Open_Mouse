import { describe, expect, it } from "vitest";
import {
  CALIBRATION_METHODS,
  MEASUREMENT_MODEL_VERSION,
  MEASUREMENT_MODEL_VERSIONS,
  calibrationMethodOf,
  handMeasurementsSchema,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";

const printedSheet = {
  markerIds: [0, 1, 2, 3],
  reprojectionErrorMm: 0.4,
  cardScaleRatio: 1.002,
  parallaxCorrected: true,
};
const paperEdge = {
  method: "paper-edge" as const,
  paperSize: "a4" as const,
  edgeFitResidualMm: 0.6,
  minSideCoverage: 0.72,
  parallaxCorrected: true,
};
const userLength = {
  method: "user-length" as const,
  referenceMeasurement: "handLengthMm" as const,
  referenceMm: 186,
  parallaxCorrected: false as const,
};
const measurements = {
  handLengthMm: 186,
  palmLengthMm: 106,
  palmWidthMm: 82,
};
const submission = {
  hand: "right" as const,
  measurements,
  calibration: printedSheet,
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
};

describe("measurement model versions", () => {
  // Pinned literally: a calibrated model is appended in W7, never swapped in,
  // so clients still sending the old version keep working through a deploy.
  it("keeps landmark-raw-v1 and the current version in the accepted list", () => {
    // Literal on purpose: a W7 change that replaces instead of appends fails.
    expect(MEASUREMENT_MODEL_VERSIONS).toContain("landmark-raw-v1");
    expect(MEASUREMENT_MODEL_VERSIONS).toContain(MEASUREMENT_MODEL_VERSION);
  });

  it("builds the submission field from the list, not a single literal", () => {
    const field = scanSubmissionSchema.shape.measurementModelVersion as {
      options?: readonly string[];
    };
    expect(field.options).toEqual([...MEASUREMENT_MODEL_VERSIONS]);
  });

  it.each(MEASUREMENT_MODEL_VERSIONS)("accepts a %s submission", (version) => {
    expect(
      scanSubmissionSchema.safeParse({
        ...submission,
        measurementModelVersion: version,
      }).success,
    ).toBe(true);
  });

  it.each(["calibrated-v1", "landmark-raw-v0", ""])(
    "rejects the unknown version %j",
    (version) => {
      expect(
        scanSubmissionSchema.safeParse({
          ...submission,
          measurementModelVersion: version,
        }).success,
      ).toBe(false);
    },
  );
});

describe("calibrationMethodOf", () => {
  it("names each calibration path", () => {
    expect(calibrationMethodOf(printedSheet)).toBe("printed-sheet");
    expect(calibrationMethodOf(paperEdge)).toBe("paper-edge");
    expect(calibrationMethodOf(userLength)).toBe("user-length");
  });

  it("lists exactly the three methods", () => {
    expect(CALIBRATION_METHODS).toEqual([
      "printed-sheet",
      "paper-edge",
      "user-length",
    ]);
  });
});

// #63: a submission with a finger longer than the whole hand was accepted.
describe("finger lengths are shorter than the hand", () => {
  it.each([
    "thumbLengthMm",
    "indexLengthMm",
    "middleLengthMm",
    "ringLengthMm",
    "pinkyLengthMm",
  ])("rejects %s equal to handLengthMm", (key) => {
    const r = handMeasurementsSchema.safeParse({
      ...measurements,
      handLengthMm: 110,
      palmLengthMm: 70,
      [key]: 110,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join("."))).toContain(key);
    }
  });

  it.each([
    "thumbLengthMm",
    "indexLengthMm",
    "middleLengthMm",
    "ringLengthMm",
    "pinkyLengthMm",
  ])("accepts %s just under handLengthMm", (key) => {
    expect(
      handMeasurementsSchema.safeParse({
        ...measurements,
        handLengthMm: 110,
        palmLengthMm: 70,
        [key]: 109.9,
      }).success,
    ).toBe(true);
  });

  // A real middle-finger chain can be longer than the palm; only the whole
  // hand bounds it.
  it("accepts a finger longer than the palm but shorter than the hand", () => {
    expect(
      handMeasurementsSchema.safeParse({
        handLengthMm: 190,
        palmLengthMm: 100,
        palmWidthMm: 82,
        middleLengthMm: 110,
      }).success,
    ).toBe(true);
  });

  it("accepts ordinary finger lengths", () => {
    expect(
      handMeasurementsSchema.safeParse({
        ...measurements,
        thumbLengthMm: 60,
        indexLengthMm: 75,
        middleLengthMm: 82,
        ringLengthMm: 77,
        pinkyLengthMm: 60,
      }).success,
    ).toBe(true);
  });
});
