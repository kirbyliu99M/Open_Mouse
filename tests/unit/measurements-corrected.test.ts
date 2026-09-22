import { describe, expect, it } from "vitest";
import { handMeasurementsSchema } from "../../src/lib/contracts/measurement";
import {
  estimateHomography,
  type Point2,
  type PointCorrespondence,
} from "../../src/client/geometry/homography";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
} from "../../src/client/geometry/measurements";
import {
  LANDMARK_HEIGHTS_MM,
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

function buildH(camera: SyntheticCamera) {
  const correspondences: PointCorrespondence[] = SHEET_MM_MARKER_CORNERS.map(
    (mm) => ({ src: projectSheetMm(camera, mm, 0), dst: mm }),
  );
  return estimateHomography(correspondences);
}

function projectLandmarks(camera: SyntheticCamera): Point2[] {
  return MM_LANDMARKS.map((mm, i) =>
    projectSheetMm(camera, mm, LANDMARK_HEIGHTS_MM[i]),
  );
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
