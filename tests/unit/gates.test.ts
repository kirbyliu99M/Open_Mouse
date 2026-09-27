import { describe, expect, it } from "vitest";
import {
  GATE_THRESHOLDS,
  checkMarkers,
  checkHandDetected,
  checkHandedness,
  checkLandmarkConfidence,
  checkHandInBounds,
  checkReprojectionError,
  checkCardScale,
  checkSharpness,
  computeFlatMarkerBoundsMm,
  runPhotoGates,
  type PhotoGateInput,
} from "../../src/client/photo/gates";
import { computeSheetLayout } from "../../src/client/sheet/layout";
import { SHEET } from "../../src/lib/contracts/measurement";

describe("checkMarkers", () => {
  it("passes when all four flat markers (0-3) are found", () => {
    expect(checkMarkers([0, 1, 2, 3])).toBeNull();
    expect(checkMarkers([3, 1, 0, 2])).toBeNull();
  });

  it("names a single missing marker", () => {
    const failure = checkMarkers([0, 1, 3]);
    expect(failure?.code).toBe("MARKERS_MISSING");
    expect(failure?.message).toBe(
      "Marker 2 is hidden — keep all four corner squares visible.",
    );
  });

  it("names two missing markers", () => {
    const failure = checkMarkers([0, 2]);
    expect(failure?.message).toBe(
      "Markers 1 and 3 are hidden — keep all four corner squares visible.",
    );
  });

  it("names three missing markers", () => {
    const failure = checkMarkers([2]);
    expect(failure?.message).toBe(
      "Markers 0, 1 and 3 are hidden — keep all four corner squares visible.",
    );
  });

  it("ignores upright-flap marker ids (4, 5) when checking flat markers", () => {
    const failure = checkMarkers([0, 1, 2, 3, 4, 5]);
    expect(failure).toBeNull();
  });
});

describe("checkHandDetected", () => {
  it("fails when MediaPipe found no landmarks", () => {
    const failure = checkHandDetected(0);
    expect(failure?.code).toBe("HAND_NOT_DETECTED");
    expect(failure?.message).toMatch(/couldn't find a hand/i);
  });

  it("passes when landmarks were found", () => {
    expect(checkHandDetected(21)).toBeNull();
  });
});

describe("checkHandedness", () => {
  it("passes when no hand was stated (picker not used)", () => {
    expect(checkHandedness("left", undefined)).toBeNull();
  });

  it("passes when detected matches stated", () => {
    expect(checkHandedness("right", "right")).toBeNull();
  });

  it("fails with a specific message when detected differs from stated", () => {
    const failure = checkHandedness("left", "right");
    expect(failure?.code).toBe("HANDEDNESS_MISMATCH");
    expect(failure?.message).toBe(
      "This looks like your left hand, but you selected right. Retake with your right hand, or change the hand picker.",
    );
  });

  it("uses the easy-scan instruction when supplied", () => {
    const failure = checkHandedness(
      "left",
      "right",
      "tap the hand button below",
    );
    expect(failure?.message).toContain("tap the hand button below");
  });
});

describe("checkLandmarkConfidence", () => {
  it("fails below the threshold", () => {
    const failure = checkLandmarkConfidence(0.4);
    expect(failure?.code).toBe("LOW_LANDMARK_CONFIDENCE");
  });

  it("passes at or above the threshold", () => {
    expect(
      checkLandmarkConfidence(GATE_THRESHOLDS.minLandmarkConfidence),
    ).toBeNull();
    expect(checkLandmarkConfidence(0.99)).toBeNull();
  });
});

describe("computeFlatMarkerBoundsMm", () => {
  it("matches the flat flap's known 180 mm square, centred", () => {
    const layout = computeSheetLayout();
    const bounds = computeFlatMarkerBoundsMm(layout);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(SHEET.markerLayoutOuterMm, 6);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(SHEET.markerLayoutOuterMm, 6);
  });
});

describe("checkHandInBounds", () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 180 },
    { x: 0, y: 180 },
  ];

  it("passes when every landmark is within the margin", () => {
    const landmarks = [
      { x: 10, y: 10 },
      { x: 170, y: 170 },
      { x: -50, y: 90 }, // within the 100mm margin, hand extending off the markers onto the table
    ];
    expect(checkHandInBounds(landmarks, corners)).toBeNull();
  });

  it("fails when a landmark is far outside the margin", () => {
    const landmarks = [
      { x: 10, y: 10 },
      { x: 5000, y: 5000 },
    ];
    const failure = checkHandInBounds(landmarks, corners);
    expect(failure?.code).toBe("HAND_OUT_OF_BOUNDS");
  });
});

describe("checkReprojectionError", () => {
  it("passes under the 1.0mm threshold", () => {
    expect(checkReprojectionError(0.5)).toBeNull();
  });

  it("fails at or above the 1.0mm threshold", () => {
    const failure = checkReprojectionError(1.2);
    expect(failure?.code).toBe("REPROJECTION_ERROR");
  });
});

describe("checkCardScale", () => {
  it("passes within 1% agreement", () => {
    expect(checkCardScale(1.005)).toBeNull();
    expect(checkCardScale(0.995)).toBeNull();
  });

  it("fails beyond 1% disagreement, naming the printer", () => {
    const failure = checkCardScale(1.03);
    expect(failure?.code).toBe("CARD_SCALE_MISMATCH");
    expect(failure?.message).toMatch(/printer/i);
  });
});

describe("checkSharpness", () => {
  it("is a warning, not null, below the variance threshold", () => {
    const failure = checkSharpness(5);
    expect(failure?.code).toBe("LOW_SHARPNESS");
  });

  it("passes above the threshold", () => {
    expect(checkSharpness(500)).toBeNull();
  });
});

describe("runPhotoGates", () => {
  const layout = computeSheetLayout();
  const flatMarkerCornersMm = layout.markers
    .filter((m) => (SHEET.flatMarkerIds as readonly number[]).includes(m.id))
    .flatMap((m) => m.corners);

  const goodInput: PhotoGateInput = {
    detectedMarkerIds: [0, 1, 2, 3],
    landmarkCount: 21,
    handedness: "right",
    handStated: "right",
    landmarkConfidence: 0.9,
    landmarksMm: [{ x: 90, y: 90 }],
    flatMarkerCornersMm,
    reprojectionErrorMm: 0.3,
    cardScaleRatio: 1.0,
    laplacianVariance: 300,
  };

  it("is ok for a fully clean input", () => {
    const report = runPhotoGates(goodInput);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("collects the missing-markers error and skips homography-dependent checks", () => {
    const report = runPhotoGates({
      ...goodInput,
      detectedMarkerIds: [0, 1, 2],
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("MARKERS_MISSING");
  });

  it("surfaces low sharpness as a warning while still ok", () => {
    const report = runPhotoGates({ ...goodInput, laplacianVariance: 1 });
    expect(report.ok).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].code).toBe("LOW_SHARPNESS");
  });

  it("collects multiple independent errors at once", () => {
    const report = runPhotoGates({
      ...goodInput,
      reprojectionErrorMm: 2,
      cardScaleRatio: 1.05,
    });
    expect(report.ok).toBe(false);
    const codes = report.errors.map((e) => e.code);
    expect(codes).toContain("REPROJECTION_ERROR");
    expect(codes).toContain("CARD_SCALE_MISMATCH");
  });

  it("does not check handedness/confidence when no hand was detected", () => {
    const report = runPhotoGates({
      ...goodInput,
      landmarkCount: 0,
      handedness: null,
    });
    expect(report.errors.map((e) => e.code)).toEqual(["HAND_NOT_DETECTED"]);
  });
});
