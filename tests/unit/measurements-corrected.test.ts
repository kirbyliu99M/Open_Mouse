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
  HAND_LENGTH_SETTLED_MM,
  MAX_CORRECTION_PASSES,
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
  correctLandmarksByHandLength,
  handLengthFromSheetMm,
  measurementsFromSheetMm,
} from "../../src/client/geometry/measurements";
import {
  REFERENCE_HAND_LENGTH_MM,
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
// assume, to show the passes do not depend on the model being exact.
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

/**
 * A photo of the hand: the exact synthetic camera hangs `distanceMm` above the
 * sheet's origin (tilt only turns it; it does not move it off that point).
 * With `offsetMm` the hand is moved so the middle of its wrist-to-fingertip
 * line sits that far from the point under the camera, in sheet mm; without it
 * the hand stays where `MM_LANDMARKS` puts it.
 */
function sceneOf(
  lengthMm: number,
  tiltDeg: number,
  truthHeightsMm: readonly number[],
  options: { distanceMm?: number; offsetMm?: Point2 } = {},
) {
  const camera = buildSyntheticCamera({
    tiltDeg,
    distanceMm: options.distanceMm ?? DISTANCE_MM,
    fPx: F_PX,
  });
  const h = buildH(camera);
  const shape = handOfLength(lengthMm);
  const { offsetMm } = options;
  const hand = offsetMm
    ? shape.map((p) => ({
        x: p.x - (shape[0].x + shape[12].x) / 2 + offsetMm.x,
        y: p.y - (shape[0].y + shape[12].y) / 2 + offsetMm.y,
      }))
    : shape;
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

// Where the hand is, relative to the point under the camera, matters: the
// parallax of a height error grows with the distance from that point. Tilt does
// not move the camera (see `sceneOf`), so 0 and 20 degrees give the same
// numbers; both are kept as a check that the recovered pose is what matters.
const TILTS_DEG = [0, 20];
const CAMERA_HEIGHTS_MM = [350, 450];
const OFFSETS_MM: readonly Point2[] = [
  { x: 0, y: 0 },
  { x: 0, y: -80 },
  { x: 0, y: -160 }, // along the hand's axis, as far as the review found
  { x: 0, y: 160 },
  { x: 160, y: 0 }, // across it
];

describe("correctLandmarksByHandLength: passes until the heights and the length agree", () => {
  for (const lengthMm of [160, 190, 220]) {
    for (const [truthName, truthHeights] of [
      ["v2 heights for that hand", landmarkHeightsMm(lengthMm)],
      ["v1 table (not the v2 model)", V1_HEIGHTS_MM],
    ] as const) {
      it(`${lengthMm} mm hand at the ${truthName}: settled before the cap, and one more pass changes the hand length by under 0.01 mm (0 and 20 deg tilt, camera 350 and 450 mm up, hand 0 to 160 mm off its axis)`, () => {
        for (const tiltDeg of TILTS_DEG) {
          for (const distanceMm of CAMERA_HEIGHTS_MM) {
            for (const offsetMm of OFFSETS_MM) {
              const label = `${tiltDeg} deg, ${distanceMm} mm, offset ${offsetMm.x},${offsetMm.y}`;
              const { camera, h, landmarksPx } = sceneOf(
                lengthMm,
                tiltDeg,
                truthHeights,
                { distanceMm, offsetMm },
              );
              const result = correctLandmarksByHandLength(
                landmarksPx,
                h,
                camera.intrinsics,
              );
              expect(result.passes, label).toBeLessThan(MAX_CORRECTION_PASSES);
              expect(result.converged, label).toBe(true);

              // One more pass, worked out here: heights for the length just
              // measured, then measure again.
              const length = handLengthFromSheetMm(result.points);
              const more = correctLandmarks(
                landmarksPx,
                h,
                camera.intrinsics,
                landmarkHeightsMm(length),
              );
              expect(
                Math.abs(handLengthFromSheetMm(more) - length),
                label,
              ).toBeLessThan(0.01);
              // ...and the heights are the ones of the length they say.
              expect(result.heightsMm, label).toEqual(
                landmarkHeightsMm(result.handLengthMm),
              );
              expect(
                Math.abs(length - result.handLengthMm),
                label,
              ).toBeLessThan(HAND_LENGTH_SETTLED_MM);
              if (truthName.startsWith("v2")) {
                // The model is exact here, so the true length comes back.
                expect(Math.abs(length - lengthMm), label).toBeLessThan(0.01);
              }
            }
          }
        }
      });
    }
  }

  it("needs more than two passes for a hand far from the camera's axis: two fixed passes would leave 0.1 mm or more", () => {
    // 220 mm hand, camera 350 mm up, the hand 160 mm from the point under it.
    const { camera, h, landmarksPx } = sceneOf(
      220,
      20,
      landmarkHeightsMm(220),
      { distanceMm: 350, offsetMm: { x: 0, y: -160 } },
    );
    const lengthAfter = (heights: readonly number[]) =>
      handLengthFromSheetMm(
        correctLandmarks(landmarksPx, h, camera.intrinsics, heights),
      );
    const first = lengthAfter(REFERENCE_LANDMARK_HEIGHTS_MM);
    const second = lengthAfter(landmarkHeightsMm(first));
    const third = lengthAfter(landmarkHeightsMm(second));
    expect(Math.abs(first - 220)).toBeGreaterThan(2);
    expect(Math.abs(third - second)).toBeGreaterThan(0.1);

    const result = correctLandmarksByHandLength(
      landmarksPx,
      h,
      camera.intrinsics,
    );
    expect(result.passes).toBeGreaterThan(2);
    expect(result.converged).toBe(true);
    expect(Math.abs(handLengthFromSheetMm(result.points) - 220)).toBeLessThan(
      0.01,
    );
  });

  it("at the cap it does not throw: it returns the last pass with converged false", () => {
    // The same far-off hand, but the cap set to two passes, which is not enough.
    const { camera, h, landmarksPx } = sceneOf(
      220,
      20,
      landmarkHeightsMm(220),
      { distanceMm: 350, offsetMm: { x: 0, y: -160 } },
    );
    const capped = correctLandmarksByHandLength(
      landmarksPx,
      h,
      camera.intrinsics,
      { maxPasses: 2 },
    );
    expect(capped.passes).toBe(2);
    expect(capped.converged).toBe(false);
    // Still a complete, usable result: heights for the length it scaled to,
    // and the points back-projected at them.
    expect(capped.points).toHaveLength(21);
    expect(capped.heightsMm).toEqual(landmarkHeightsMm(capped.handLengthMm));
    expect(capped.points).toEqual(
      correctLandmarks(landmarksPx, h, camera.intrinsics, capped.heightsMm),
    );
    // It is the unsettled state the flag says: the length measured from the
    // points is 0.1 mm or more from the one the heights were scaled to.
    expect(
      Math.abs(handLengthFromSheetMm(capped.points) - capped.handLengthMm),
    ).toBeGreaterThan(0.1);

    // One pass is the reference heights, whatever the hand.
    const single = correctLandmarksByHandLength(
      landmarksPx,
      h,
      camera.intrinsics,
      { maxPasses: 1 },
    );
    expect(single.passes).toBe(1);
    expect(single.converged).toBe(false);
    expect(single.heightsMm).toEqual([...REFERENCE_LANDMARK_HEIGHTS_MM]);

    // The default cap settles the same hand.
    const byDefault = correctLandmarksByHandLength(
      landmarksPx,
      h,
      camera.intrinsics,
    );
    expect(byDefault.converged).toBe(true);
    expect(byDefault.passes).toBeLessThan(MAX_CORRECTION_PASSES);
  });

  it("refuses a maxPasses that is not an integer of 1 or more", () => {
    const { camera, h, landmarksPx } = sceneOf(190, 20, landmarkHeightsMm(190));
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () =>
          correctLandmarksByHandLength(landmarksPx, h, camera.intrinsics, {
            maxPasses: bad,
          }),
        String(bad),
      ).toThrow(RangeError);
    }
  });

  it("reports the length the heights are scaled to, the heights, the points and the pass count", () => {
    const { camera, h, landmarksPx } = sceneOf(160, 20, landmarkHeightsMm(160));
    const result = correctLandmarksByHandLength(
      landmarksPx,
      h,
      camera.intrinsics,
    );
    expect(result.passes).toBeGreaterThan(1);
    expect(result.heightsMm).toHaveLength(21);
    expect(result.heightsMm).toEqual(landmarkHeightsMm(result.handLengthMm));
    expect(result.handLengthMm).toBeCloseTo(160, 1);
    expect(result.points).toEqual(
      correctLandmarks(landmarksPx, h, camera.intrinsics, result.heightsMm),
    );
  });

  it("is exact for a 190 mm hand in one pass: the reference heights are already the right ones", () => {
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
    expect(result.passes).toBe(1);
    expect(result.converged).toBe(true);
    expect(result.handLengthMm).toBe(REFERENCE_HAND_LENGTH_MM);
    expect(result.heightsMm).toEqual([...REFERENCE_LANDMARK_HEIGHTS_MM]);
    result.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(hand[i].x, 6);
      expect(p.y).toBeCloseTo(hand[i].y, 6);
    });
  });

  it("throws a RangeError when a pass gives no usable hand length", () => {
    const { camera, h, landmarksPx } = sceneOf(190, 20, landmarkHeightsMm(190));
    const broken = landmarksPx.map((p, i) =>
      i === 12 ? { x: Number.NaN, y: p.y } : p,
    );
    expect(() =>
      correctLandmarksByHandLength(broken, h, camera.intrinsics),
    ).toThrow(RangeError);
  });
});

describe("correctLandmarksByHandLength: a hand whose length is cut short (curled fingers)", () => {
  // L is the wrist-to-middle-fingertip distance, so a curled middle finger
  // shortens it and the heights shrink with it. That is a limit of the method
  // (docs/research/landmark-heights-v2.md), pinned here so it is not changed
  // by accident: the recorded heights of a grip photo are an unreliable
  // estimate, not a measurement.
  it("scales the heights down in proportion to the shortened length", () => {
    const flat = sceneOf(190, 20, landmarkHeightsMm(190));
    // The middle finger (landmarks 10-12) folded to 40 % of its length about
    // its base joint (9), the rest of the hand and the heights left as they were.
    const base = flat.hand[9];
    const curledHand = flat.hand.map((p, i) =>
      i >= 10 && i <= 12
        ? { x: base.x + (p.x - base.x) * 0.4, y: base.y + (p.y - base.y) * 0.4 }
        : p,
    );
    const curledPx = curledHand.map((mm, i) =>
      projectSheetMm(flat.camera, mm, landmarkHeightsMm(190)[i]),
    );

    const flatResult = correctLandmarksByHandLength(
      flat.landmarksPx,
      flat.h,
      flat.camera.intrinsics,
    );
    const curledResult = correctLandmarksByHandLength(
      curledPx,
      flat.h,
      flat.camera.intrinsics,
    );
    // The tip is much closer to the wrist, so L is much shorter...
    expect(curledResult.handLengthMm).toBeLessThan(
      flatResult.handLengthMm * 0.8,
    );
    // ...and every height is that same fraction of the flat hand's.
    const ratio = curledResult.handLengthMm / flatResult.handLengthMm;
    curledResult.heightsMm.forEach((height, i) => {
      expect(height).toBeCloseTo(flatResult.heightsMm[i] * ratio, 6);
    });
    expect(curledResult.heightsMm[0]).toBeLessThan(
      flatResult.heightsMm[0] * 0.8,
    );
  });
});

describe("computeCorrectedHandMeasurements: heights follow the hand, and options.heightsMm still overrides", () => {
  it("measures a 160 mm and a 220 mm hand to within 0.01 mm with the default heights", () => {
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
      ).toBeLessThan(0.01);
      // The heights it reports are the ones of this hand, not of a 190 mm hand.
      expect(result.heightsMm).toHaveLength(21);
      expect(result.heightsMm![0]).toBeCloseTo(
        landmarkHeightsMm(lengthMm)[0],
        1,
      );
      expect(result.heightsMm![0]).not.toBeCloseTo(20, 0);
    }
  });

  it("uses options.heightsMm as given, in a single pass, and reports it", () => {
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
