import { describe, expect, it } from "vitest";
import {
  applyHomography,
  estimateHomography,
  type Point2,
  type PointCorrespondence,
} from "../../src/client/geometry/homography";
import {
  correctLandmarks,
  landmarkHeightsMm,
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

// A synthetic hand, laid out directly in sheet mm (same shape as
// measurements.test.ts's fixture: index finger deliberately curled),
// paired with the v2 heights for a hand of its own length, so each joint sits
// at its estimated real-world height above the sheet, not on the sheet plane.
const MM_LANDMARKS: readonly Point2[] = [
  { x: 100, y: 0 }, // 0 wrist
  { x: 85, y: 20 }, // 1 thumb CMC
  { x: 70, y: 45 }, // 2 thumb MCP
  { x: 55, y: 65 }, // 3 thumb IP
  { x: 45, y: 85 }, // 4 thumb TIP
  { x: 80, y: 100 }, // 5 index MCP
  { x: 75, y: 135 }, // 6 index PIP
  { x: 65, y: 150 }, // 7 index DIP
  { x: 55, y: 145 }, // 8 index TIP
  { x: 100, y: 105 }, // 9 middle MCP
  { x: 100, y: 140 }, // 10 middle PIP
  { x: 100, y: 165 }, // 11 middle DIP
  { x: 100, y: 190 }, // 12 middle TIP
  { x: 130, y: 99 }, // 13 ring MCP
  { x: 131, y: 133 }, // 14 ring PIP
  { x: 131, y: 157 }, // 15 ring DIP
  { x: 131, y: 177 }, // 16 ring TIP
  { x: 160, y: 98 }, // 17 pinky MCP
  { x: 162, y: 122 }, // 18 pinky PIP
  { x: 163, y: 140 }, // 19 pinky DIP
  { x: 163, y: 155 }, // 20 pinky TIP
];

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const TRUE_HAND_LENGTH_MM = dist(MM_LANDMARKS[0], MM_LANDMARKS[12]);
const HEIGHTS_MM = landmarkHeightsMm(TRUE_HAND_LENGTH_MM);

function buildCameraAndHomography(camera: SyntheticCamera) {
  const correspondences: PointCorrespondence[] = SHEET_MM_MARKER_CORNERS.map(
    (mm) => ({ src: projectSheetMm(camera, mm, 0), dst: mm }),
  );
  return estimateHomography(correspondences);
}

function projectLandmarks(camera: SyntheticCamera): Point2[] {
  return MM_LANDMARKS.map((mm, i) => projectSheetMm(camera, mm, HEIGHTS_MM[i]));
}

// Deterministic PRNG (mulberry32) + Box-Muller, matching
// homography.test.ts's noise test so the noisy case here is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe("correctLandmarks", () => {
  it("uncorrected (straight-through-homography) hand length is inflated by a real, material amount", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildCameraAndHomography(camera);
    const landmarksPx = projectLandmarks(camera);

    const uncorrected = landmarksPx.map((p) => applyHomography(h, p));
    const uncorrectedLength = dist(uncorrected[0], uncorrected[12]);
    const inflationMm = uncorrectedLength - TRUE_HAND_LENGTH_MM;

    // The wrist (20 mm) and middle-fingertip (6 mm) landmarks sit at
    // different heights above the sheet at a ~450 mm shot with a 20°
    // tilt — issue #16 predicts a multi-mm inflation, not a rounding
    // error. This is the "prove the problem is real" assertion.
    expect(inflationMm).toBeGreaterThan(2);
    expect(inflationMm).toBeLessThan(20);
  });

  it("corrected measurements recover the truth within 0.3 mm (known/EXIF-equivalent focal)", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildCameraAndHomography(camera);
    const landmarksPx = projectLandmarks(camera);

    // "EXIF-focal path": the caller already knows fPx exactly (as if read
    // from EXIF), so intrinsics are exact and only H comes from marker
    // detection.
    const corrected = correctLandmarks(
      landmarksPx,
      h,
      camera.intrinsics,
      HEIGHTS_MM,
    );

    for (let i = 0; i < MM_LANDMARKS.length; i++) {
      expect(corrected[i].x).toBeCloseTo(MM_LANDMARKS[i].x, 1); // 1 dp ~ 0.05mm resolution
      expect(corrected[i].y).toBeCloseTo(MM_LANDMARKS[i].y, 1);
    }
    const correctedLength = dist(corrected[0], corrected[12]);
    expect(Math.abs(correctedLength - TRUE_HAND_LENGTH_MM)).toBeLessThan(0.3);
  });

  it("corrected measurements stay accurate across a range of tilts and distances", () => {
    for (const tiltDeg of [10, 15, 20, 30]) {
      for (const distanceMm of [350, 450, 550]) {
        const camera = buildSyntheticCamera({ tiltDeg, distanceMm, fPx: F_PX });
        const h = buildCameraAndHomography(camera);
        const landmarksPx = projectLandmarks(camera);
        const corrected = correctLandmarks(
          landmarksPx,
          h,
          camera.intrinsics,
          HEIGHTS_MM,
        );
        const correctedLength = dist(corrected[0], corrected[12]);
        expect(Math.abs(correctedLength - TRUE_HAND_LENGTH_MM)).toBeLessThan(
          0.3,
        );
      }
    }
  });

  it("stays within 1 mm of the truth with 0.3 px pixel noise on markers and landmarks", () => {
    const rand = mulberry32(20260922);
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const noiseStdPx = 0.3;
    const noisyPoint = (p: Point2): Point2 => ({
      x: p.x + gaussian(rand) * noiseStdPx,
      y: p.y + gaussian(rand) * noiseStdPx,
    });

    const noisyCorrespondences: PointCorrespondence[] =
      SHEET_MM_MARKER_CORNERS.map((mm) => ({
        src: noisyPoint(projectSheetMm(camera, mm, 0)),
        dst: mm,
      }));
    const noisyH = estimateHomography(noisyCorrespondences);

    const noisyLandmarksPx = projectLandmarks(camera).map(noisyPoint);

    // Known focal (EXIF-equivalent) — this is the pipeline's noise-
    // robustness case per issue #16; the homography-focal path's own
    // noise sensitivity is a separate concern from parallax correction.
    const corrected = correctLandmarks(
      noisyLandmarksPx,
      noisyH,
      camera.intrinsics,
      HEIGHTS_MM,
    );
    const correctedLength = dist(corrected[0], corrected[12]);
    expect(Math.abs(correctedLength - TRUE_HAND_LENGTH_MM)).toBeLessThan(1);
  });

  it("throws when landmarks and heights have mismatched lengths", () => {
    const camera = buildSyntheticCamera({
      tiltDeg: TILT_DEG,
      distanceMm: DISTANCE_MM,
      fPx: F_PX,
    });
    const h = buildCameraAndHomography(camera);
    const landmarksPx = projectLandmarks(camera);
    expect(() =>
      correctLandmarks(landmarksPx, h, camera.intrinsics, [1, 2, 3]),
    ).toThrow(/same length/);
  });
});
