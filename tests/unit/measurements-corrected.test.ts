import { describe, expect, it } from "vitest";
import {
  MEASUREMENT_DEFINITIONS,
  handMeasurementsSchema,
} from "../../src/lib/contracts/measurement";
import {
  estimateHomography,
  type Point2,
  type PointCorrespondence,
} from "../../src/client/geometry/homography";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
  correctLandmarksByHandLength,
  handLengthFromSheetMm,
  measurementsFromSheetMm,
} from "../../src/client/geometry/measurements";
import {
  REFERENCE_LANDMARK_HEIGHTS_MM,
  correctLandmarks,
  landmarkHeightsMm,
  resolveFocalPx,
} from "../../src/client/geometry/parallax";
import {
  SHEET_MM_MARKER_CORNERS,
  buildSyntheticCamera,
  projectSheetMm,
  type SyntheticCamera,
} from "./helpers/synthetic-camera";

const F_PX = 3800;
const DISTANCE_MM = 450;
const TILT_DEG = 20;
const WIDTH_PX = 3024;
const HEIGHT_PX = 4032;

const MM_LANDMARKS: readonly Point2[] = [
  { x: 100, y: 0 },
  { x: 85, y: 20 },
  { x: 70, y: 45 },
  { x: 55, y: 65 },
  { x: 45, y: 85 },
  { x: 80, y: 100 },
  { x: 75, y: 135 },
  { x: 65, y: 150 },
  { x: 55, y: 145 },
  { x: 100, y: 105 },
  { x: 100, y: 140 },
  { x: 100, y: 165 },
  { x: 100, y: 190 },
  { x: 130, y: 99 },
  { x: 131, y: 133 },
  { x: 131, y: 157 },
  { x: 131, y: 177 },
  { x: 160, y: 98 },
  { x: 162, y: 122 },
  { x: 163, y: 140 },
  { x: 163, y: 155 },
];

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
const TRUE_HAND_LENGTH_MM = dist(MM_LANDMARKS[0], MM_LANDMARKS[12]);
const HEIGHTS_MM = landmarkHeightsMm(TRUE_HAND_LENGTH_MM);

function buildH(camera: SyntheticCamera) {
  const correspondences: PointCorrespondence[] = SHEET_MM_MARKER_CORNERS.map(
    (mm) => ({ src: projectSheetMm(camera, mm, 0), dst: mm }),
  );
  return estimateHomography(correspondences);
}

function projectLandmarks(camera: SyntheticCamera): Point2[] {
  return MM_LANDMARKS.map((mm, i) => projectSheetMm(camera, mm, HEIGHTS_MM[i]));
}

describe("computeCorrectedHandMeasurements", () => {
  it("with an EXIF focal length, corrects handLengthMm close to the truth and reports source 'exif'", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildH(camera);
    const landmarksPx = projectLandmarks(camera);

    const result = computeCorrectedHandMeasurements(landmarksPx, h, {
      exifFocalPx: F_PX,
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
    });

    expect(result.parallaxCorrected).toBe(true);
    expect(result.focalSource).toBe("exif");
    expect(
      Math.abs(result.measurements.handLengthMm - TRUE_HAND_LENGTH_MM),
    ).toBeLessThan(0.3);
    expect(handMeasurementsSchema.safeParse(result.measurements).success).toBe(
      true,
    );
  });

  it("falls back to the homography-focal estimate when no EXIF focal length is given, at a well-conditioned tilt", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildH(camera);
    const landmarksPx = projectLandmarks(camera);

    const result = computeCorrectedHandMeasurements(landmarksPx, h, {
      exifFocalPx: null,
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
    });

    expect(result.parallaxCorrected).toBe(true);
    expect(result.focalSource).toBe("homography");
    expect(
      Math.abs(result.measurements.handLengthMm - TRUE_HAND_LENGTH_MM),
    ).toBeLessThan(0.3);
  });

  it("applies no correction (parallaxCorrected: false) when there is no EXIF and the view is near fronto-parallel", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: 0.5,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildH(camera);
    const landmarksPx = projectLandmarks(camera);

    const result = computeCorrectedHandMeasurements(landmarksPx, h, {
      exifFocalPx: null,
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
    });

    expect(result.parallaxCorrected).toBe(false);
    expect(result.focalSource).toBe("none");
    expect(result.heightsMm).toBeNull();
    // The uncorrected path — matches computeHandMeasurements exactly.
    const uncorrected = computeHandMeasurements(landmarksPx, h);
    expect(result.measurements.handLengthMm).toBeCloseTo(
      uncorrected.handLengthMm,
      9,
    );
  });

  it("computeHandMeasurements (the original uncorrected path) is unchanged by this integration", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildH(camera);
    const landmarksPx = projectLandmarks(camera);
    const uncorrected = computeHandMeasurements(landmarksPx, h);
    // Still inflated relative to the truth — proves this path really is uncorrected.
    expect(uncorrected.handLengthMm).toBeGreaterThan(TRUE_HAND_LENGTH_MM + 1);
  });
});

describe("resolveFocalPx", () => {
  it("prefers EXIF over the homography estimate even when both are available", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildH(camera);
    const resolved = resolveFocalPx({
      exifFocalPx: 4200, // deliberately different from the camera's real f, to prove EXIF wins
      homography: h,
      principalPoint: { cx: camera.intrinsics.cx, cy: camera.intrinsics.cy },
    });
    expect(resolved.source).toBe("exif");
    expect(resolved.fPx).toBe(4200);
  });
});

// The v1 table: the same 21 millimetres for every hand. Written out as
// literals so a hand can be built that stands at heights the v2 model does not
// assume, to show the two passes do not depend on the model being exact.
const V1_HEIGHTS_MM = [
  20, 18, 15, 11, 6, 13, 10, 8, 6, 13, 10, 8, 6, 13, 10, 8, 6, 13, 10, 8, 6,
];

/** The test hand scaled about its wrist to a wrist-to-middle-fingertip length. */
function handOfLength(lengthMm: number): Point2[] {
  const wrist = MM_LANDMARKS[0];
  const k = lengthMm / TRUE_HAND_LENGTH_MM;
  return MM_LANDMARKS.map((p) => ({
    x: wrist.x + (p.x - wrist.x) * k,
    y: wrist.y + (p.y - wrist.y) * k,
  }));
}

function sceneOf(
  lengthMm: number,
  tiltDeg: number,
  truthHeightsMm: readonly number[],
) {
  const camera = buildSyntheticCamera({
    tiltDeg,
    distanceMm: DISTANCE_MM,
    fPx: F_PX,
  });
  const h = buildH(camera);
  const hand = handOfLength(lengthMm);
  const landmarksPx = hand.map((mm, i) =>
    projectSheetMm(camera, mm, truthHeightsMm[i]),
  );
  return { camera, h, hand, landmarksPx };
}

describe("hand length, as the heights are scaled to it", () => {
  it("is the contract's own handLengthMm definition: landmark 0 (wrist) to landmark 12 (middle fingertip)", () => {
    // If the contract ever changes this definition, this test fails on purpose:
    // the heights would then be scaled to a different length than the ratios
    // (Garrett's wrist crease to fingertip) assume, and that is a decision.
    expect(MEASUREMENT_DEFINITIONS.handLengthMm).toBe("distance(0, 12)");
    const points = handOfLength(173);
    expect(handLengthFromSheetMm(points)).toBeCloseTo(
      Math.hypot(points[0].x - points[12].x, points[0].y - points[12].y),
      12,
    );
    expect(handLengthFromSheetMm(points)).toBeCloseTo(173, 9);
  });

  it("is the same number measurementsFromSheetMm reports as handLengthMm", () => {
    const points = handOfLength(173);
    expect(handLengthFromSheetMm(points)).toBe(
      measurementsFromSheetMm(points).handLengthMm,
    );
  });

  it("does not enforce the contract's ranges: it is an intermediate value", () => {
    const fist = handOfLength(60); // below the contract's 100 mm minimum
    expect(() => measurementsFromSheetMm(fist)).toThrow();
    expect(handLengthFromSheetMm(fist)).toBeCloseTo(60, 9);
  });
});

describe("correctLandmarksByHandLength: two passes, the second at the heights of the first pass's hand length", () => {
  for (const lengthMm of [160, 190, 220]) {
    for (const tiltDeg of [0, 20]) {
      for (const [truthName, truthHeights] of [
        ["v2 heights for that hand", landmarkHeightsMm(lengthMm)],
        ["v1 table (not the v2 model)", V1_HEIGHTS_MM],
      ] as const) {
        it(`${lengthMm} mm hand, ${tiltDeg} deg tilt, standing at the ${truthName}: one more pass changes the hand length by under 0.05 mm`, () => {
          const { camera, h, landmarksPx } = sceneOf(
            lengthMm,
            tiltDeg,
            truthHeights,
          );
          const result = correctLandmarksByHandLength(
            landmarksPx,
            h,
            camera.intrinsics,
          );
          const length2 = handLengthFromSheetMm(result.points);

          // A third pass, worked out here: heights for the length just
          // measured, then measure again.
          const third = correctLandmarks(
            landmarksPx,
            h,
            camera.intrinsics,
            landmarkHeightsMm(length2),
          );
          const length3 = handLengthFromSheetMm(third);
          expect(Math.abs(length3 - length2)).toBeLessThan(0.05);
        });
      }
    }
  }

  it("makes the second pass matter: the first pass alone is off by 0.2 mm or more for a 160 or 220 mm hand, and the two passes by under 0.05 mm", () => {
    for (const lengthMm of [160, 220]) {
      const { camera, h, landmarksPx } = sceneOf(
        lengthMm,
        20,
        landmarkHeightsMm(lengthMm),
      );
      const first = correctLandmarks(
        landmarksPx,
        h,
        camera.intrinsics,
        REFERENCE_LANDMARK_HEIGHTS_MM,
      );
      expect(Math.abs(handLengthFromSheetMm(first) - lengthMm)).toBeGreaterThan(
        0.2,
      );
      const result = correctLandmarksByHandLength(
        landmarksPx,
        h,
        camera.intrinsics,
      );
      expect(
        Math.abs(handLengthFromSheetMm(result.points) - lengthMm),
      ).toBeLessThan(0.05);
    }
  });

  it("reports the first pass's hand length and the heights scaled to it", () => {
    const { camera, h, landmarksPx } = sceneOf(160, 20, landmarkHeightsMm(160));
    const first = correctLandmarks(
      landmarksPx,
      h,
      camera.intrinsics,
      REFERENCE_LANDMARK_HEIGHTS_MM,
    );
    const result = correctLandmarksByHandLength(
      landmarksPx,
      h,
      camera.intrinsics,
    );
    expect(result.handLengthMm).toBe(handLengthFromSheetMm(first));
    expect(result.heightsMm).toEqual(landmarkHeightsMm(result.handLengthMm));
    expect(result.points).toEqual(
      correctLandmarks(landmarksPx, h, camera.intrinsics, result.heightsMm),
    );
  });

  it("is exact for a 190 mm hand: the first pass already used the right heights", () => {
    const { camera, h, hand, landmarksPx } = sceneOf(
      190,
      20,
      landmarkHeightsMm(190),
    );
    const result = correctLandmarksByHandLength(
      landmarksPx,
      h,
      camera.intrinsics,
    );
    expect(result.handLengthMm).toBeCloseTo(190, 9);
    result.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(hand[i].x, 6);
      expect(p.y).toBeCloseTo(hand[i].y, 6);
    });
  });

  it("throws a RangeError when the first pass gives no usable hand length", () => {
    const { camera, h, landmarksPx } = sceneOf(190, 20, landmarkHeightsMm(190));
    const broken = landmarksPx.map((p, i) =>
      i === 12 ? { x: Number.NaN, y: p.y } : p,
    );
    expect(() =>
      correctLandmarksByHandLength(broken, h, camera.intrinsics),
    ).toThrow(RangeError);
  });
});

describe("computeCorrectedHandMeasurements: heights follow the hand, and options.heightsMm still overrides", () => {
  it("measures a 160 mm and a 220 mm hand to within 0.05 mm with the default (two-pass) heights", () => {
    for (const lengthMm of [160, 220]) {
      const { h, landmarksPx } = sceneOf(
        lengthMm,
        20,
        landmarkHeightsMm(lengthMm),
      );
      const result = computeCorrectedHandMeasurements(landmarksPx, h, {
        exifFocalPx: F_PX,
        widthPx: WIDTH_PX,
        heightPx: HEIGHT_PX,
      });
      expect(
        Math.abs(result.measurements.handLengthMm - lengthMm),
      ).toBeLessThan(0.05);
      // The heights it reports are the ones of this hand, not of a 190 mm hand.
      expect(result.heightsMm).toHaveLength(21);
      expect(result.heightsMm![0]).toBeCloseTo(
        landmarkHeightsMm(lengthMm)[0],
        0,
      );
      expect(result.heightsMm![0]).not.toBeCloseTo(20, 0);
    }
  });

  it("uses options.heightsMm as given, without a second pass, and reports it", () => {
    const { camera, h, landmarksPx } = sceneOf(160, 20, V1_HEIGHTS_MM);
    const result = computeCorrectedHandMeasurements(landmarksPx, h, {
      exifFocalPx: F_PX,
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      heightsMm: V1_HEIGHTS_MM,
    });
    expect(result.heightsMm).toEqual(V1_HEIGHTS_MM);
    // The hand stands at exactly those heights, so it is recovered exactly...
    expect(Math.abs(result.measurements.handLengthMm - 160)).toBeLessThan(0.01);
    expect(result.measurements).toEqual(
      measurementsFromSheetMm(
        correctLandmarks(landmarksPx, h, camera.intrinsics, V1_HEIGHTS_MM),
      ),
    );
    // ...while the default heights, for the same photo, give another number.
    const byDefault = computeCorrectedHandMeasurements(landmarksPx, h, {
      exifFocalPx: F_PX,
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
    });
    expect(
      Math.abs(
        byDefault.measurements.handLengthMm - result.measurements.handLengthMm,
      ),
    ).toBeGreaterThan(0.2);
  });
});
