import { describe, expect, it } from "vitest";
import { problemAreaFor } from "../../src/client/camera/problemArea";

const landmarks = [
  { x: 100, y: 200 },
  { x: 300, y: 600 },
  { x: 200, y: 400 },
];
const paper = [
  { x: 10, y: 20 },
  { x: 500, y: 20 },
  { x: 500, y: 900 },
  { x: 10, y: 900 },
];

describe("problemAreaFor", () => {
  it("a hand problem outlines the hand's landmarks, padded", () => {
    for (const code of [
      "HAND_TILTED",
      "FINGER_NOT_STRAIGHT",
      "HANDEDNESS_MISMATCH",
      "LOW_LANDMARK_CONFIDENCE",
      "HAND_OUT_OF_BOUNDS",
      "MEASUREMENT_OUT_OF_RANGE",
    ]) {
      expect(
        problemAreaFor(
          code,
          { landmarksPx: landmarks, paperCorners: paper },
          10,
        ),
        code,
      ).toEqual({ x: 90, y: 190, width: 220, height: 420 });
    }
  });

  it("a paper problem outlines the paper's corners", () => {
    for (const code of [
      "PAPER_EDGE_HIDDEN",
      "PAPER_CURLED",
      "PAPER_CORNER_HIDDEN",
    ]) {
      expect(
        problemAreaFor(
          code,
          { landmarksPx: landmarks, paperCorners: paper },
          0,
        ),
        code,
      ).toEqual({ x: 10, y: 20, width: 490, height: 880 });
    }
  });

  it("outlines nothing that was not located: no hand found means no guess", () => {
    expect(
      problemAreaFor(
        "HAND_NOT_DETECTED",
        { landmarksPx: null, paperCorners: paper },
        8,
      ),
    ).toBeNull();
    expect(
      problemAreaFor(
        "HAND_TILTED",
        { landmarksPx: null, paperCorners: paper },
        8,
      ),
    ).toBeNull();
    expect(
      problemAreaFor(
        "PAPER_CURLED",
        { landmarksPx: landmarks, paperCorners: null },
        8,
      ),
    ).toBeNull();
    expect(
      problemAreaFor("PAPER_CURLED", { landmarksPx: landmarks }, 8),
    ).toBeNull();
  });

  it("outlines nothing for a problem with the whole photo or the app", () => {
    const overlay = { landmarksPx: landmarks, paperCorners: paper };
    for (const code of [
      "LOW_SHARPNESS",
      "DECODE_FAILED",
      "DETECTOR_LOAD_FAILED",
      "PROCESSING_FAILED",
      "UNEXPECTED",
      "SOMETHING_NEW",
    ]) {
      expect(problemAreaFor(code, overlay, 8), code).toBeNull();
    }
  });

  it("outlines nothing without a code or an overlay", () => {
    expect(problemAreaFor(undefined, { landmarksPx: landmarks }, 8)).toBeNull();
    expect(problemAreaFor("HAND_TILTED", null, 8)).toBeNull();
    expect(problemAreaFor("HAND_TILTED", { landmarksPx: [] }, 8)).toBeNull();
  });
});
