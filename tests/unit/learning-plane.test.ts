import { describe, expect, it } from "vitest";
import { centrePrincipalPoint } from "../../src/client/geometry/camera-pose";
import {
  applyHomography,
  type Homography,
} from "../../src/client/geometry/homography";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
  measurementsFromSheetMm,
} from "../../src/client/geometry/measurements";
import {
  LANDMARK_HEIGHTS_MM_VERSION,
  LANDMARK_HEIGHT_RATIOS,
  correctLandmarks,
  landmarkHeightsMm,
} from "../../src/client/geometry/parallax";
import {
  buildPlane,
  homographyToRows,
  recomputePlane,
  rowsToHomography,
  type PlaneCalibration,
  type PlaneInput,
} from "../../src/lib/learning/plane";
import { independentSceneCamera } from "./helpers/independent-scene";
import {
  TRUE_HAND_LENGTH_MM,
  TRUE_PALM_WIDTH_MM,
  independentShot,
  syntheticShot,
} from "./helpers/learning-scene";

const NO_FIT = { reprojectionErrorMm: null, edgeFitResidualMm: null };

function input(
  shot: ReturnType<typeof syntheticShot>,
  extra: Partial<PlaneInput> = {},
): PlaneInput {
  return {
    method: "markers",
    homography: shot.markerHomography,
    fit: NO_FIT,
    landmarksPx: shot.landmarksPx,
    exifFocalPx: shot.exifFocalPx,
    imageSize: shot.imageSize,
    parallax: true,
    ...extra,
  };
}

/** What a saved log gives back: JSON, with nothing else attached. */
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("buildPlane: a parallax-corrected plane", () => {
  const shot = syntheticShot();
  const built = buildPlane(input(shot))!;

  it("records the homography, the settings the correction used, and 21 points", () => {
    expect(built.plane.method).toBe("markers");
    expect(built.plane.homography).toEqual(
      homographyToRows(shot.markerHomography),
    );
    expect(built.plane.landmarksSheetMm).toHaveLength(21);
    expect(built.plane.parallax).toMatchObject({
      corrected: true,
      focalSource: "exif",
      focalPx: shot.exifFocalPx,
      exifFocalPx: shot.exifFocalPx,
      principalPoint: {
        cx: shot.imageSize.width / 2,
        cy: shot.imageSize.height / 2,
      },
      imageSize: shot.imageSize,
      heightsVersion: "landmark-heights-v2",
      error: null,
    });
    expect(built.plane.parallax!.heightsVersion).toBe(
      LANDMARK_HEIGHTS_MM_VERSION,
    );
  });

  it("records the 21 heights the correction used: the v2 ratios times this photo's hand length", () => {
    const heights = built.plane.parallax!.heightsMm;
    expect(heights).toHaveLength(21);
    for (let i = 0; i < 21; i++) {
      expect(heights[i]).toBeCloseTo(
        LANDMARK_HEIGHT_RATIOS[i]! * TRUE_HAND_LENGTH_MM,
        6,
      );
    }
  });

  it("records different heights for a different hand: they follow the photo's own hand length, not a constant", () => {
    for (const handLengthMm of [160, 220]) {
      const shot = syntheticShot({ handLengthMm });
      const heights = buildPlane(input(shot))!.plane.parallax!.heightsMm;
      // The heights are scaled to the hand length the first pass measured
      // (through the reference heights), worked out here on its own.
      const firstPass = correctLandmarks(
        shot.landmarksPx,
        shot.markerHomography,
        {
          fPx: shot.exifFocalPx,
          ...centrePrincipalPoint(shot.imageSize.width, shot.imageSize.height),
        },
        landmarkHeightsMm(190),
      );
      const firstLength = Math.hypot(
        firstPass[0]!.x - firstPass[12]!.x,
        firstPass[0]!.y - firstPass[12]!.y,
      );
      // It reads the 160 and 220 mm hands about 0.75 mm short and 1 mm long.
      expect(Math.abs(firstLength - handLengthMm)).toBeGreaterThan(0.5);
      expect(Math.abs(firstLength - handLengthMm)).toBeLessThan(1.5);
      for (let i = 0; i < 21; i++) {
        expect(heights[i]).toBeCloseTo(
          LANDMARK_HEIGHT_RATIOS[i]! * firstLength,
          9,
        );
        // ...so within 1 % of the ratios times the true length.
        expect(
          Math.abs(
            heights[i]! / (LANDMARK_HEIGHT_RATIOS[i]! * handLengthMm) - 1,
          ),
        ).toBeLessThan(0.01);
      }
    }
  });

  it("gives exactly the numbers the product's blank-paper function gives, and records the heights it used", () => {
    const product = computeCorrectedHandMeasurements(
      shot.landmarksPx,
      shot.markerHomography,
      {
        exifFocalPx: shot.exifFocalPx,
        widthPx: shot.imageSize.width,
        heightPx: shot.imageSize.height,
      },
    );
    expect(built.measurements).toEqual(product.measurements);
    expect(built.plane.parallax!.heightsMm).toEqual(product.heightsMm);
  });

  it("is parallax-corrected: close to the true hand, where the uncorrected path reads long", () => {
    const uncorrected = computeHandMeasurements(
      shot.landmarksPx,
      shot.markerHomography,
    );
    expect(uncorrected.handLengthMm).toBeGreaterThan(TRUE_HAND_LENGTH_MM + 1);
    expect(
      Math.abs(built.measurements!.handLengthMm - TRUE_HAND_LENGTH_MM),
    ).toBeLessThan(0.3);
    expect(
      Math.abs(built.measurements!.palmWidthMm - TRUE_PALM_WIDTH_MM),
    ).toBeLessThan(0.3);
  });

  it("records the points the measurements come from: they are not the flat projection", () => {
    const flat = shot.landmarksPx.map((p) =>
      applyHomography(shot.markerHomography, p),
    );
    const points = built.plane.landmarksSheetMm!;
    expect(points).not.toEqual(flat);
    // The wrist stands 20 mm up, so correcting it moves it by millimetres.
    expect(
      Math.hypot(points[0]!.x - flat[0]!.x, points[0]!.y - flat[0]!.y),
    ).toBeGreaterThan(1);
  });
});

describe("recomputePlane: only the record", () => {
  const shot = syntheticShot();
  const built = buildPlane(input(shot))!;
  const saved = roundTrip(built.plane);

  it("reproduces the live points and measurements exactly, from JSON alone", () => {
    const again = recomputePlane(roundTrip(shot.landmarksPx), saved);
    expect(again.points).toEqual(built.plane.landmarksSheetMm);
    expect(again.measurements).toEqual(built.measurements);
  });

  it("reads the recorded heights, not the product's current constants", () => {
    const flatHeights = {
      ...saved,
      parallax: {
        ...saved.parallax!,
        heightsMm: saved.parallax!.heightsMm.map(() => 0),
      },
    };
    const again = recomputePlane(shot.landmarksPx, flatHeights);
    expect(again.points).not.toEqual(built.plane.landmarksSheetMm);
  });

  it("reads the recorded focal length", () => {
    const other = {
      ...saved,
      parallax: { ...saved.parallax!, focalPx: saved.parallax!.focalPx! * 1.5 },
    };
    expect(recomputePlane(shot.landmarksPx, other).points).not.toEqual(
      built.plane.landmarksSheetMm,
    );
  });

  it("reads the recorded homography", () => {
    const scaled = {
      ...saved,
      homography: saved.homography.map((row, r) =>
        r < 2 ? row.map((v) => v * 1.1) : row,
      ),
    };
    expect(
      recomputePlane(shot.landmarksPx, scaled).measurements!.handLengthMm,
    ).toBeGreaterThan(built.measurements!.handLengthMm * 1.05);
  });

  it("refuses a record that says 'corrected' but has no focal length, and a malformed matrix", () => {
    expect(() =>
      recomputePlane(shot.landmarksPx, {
        ...saved,
        parallax: { ...saved.parallax!, focalPx: null },
      }),
    ).toThrow(/focal length/);
    expect(() =>
      recomputePlane(shot.landmarksPx, { ...saved, homography: [[1, 0, 0]] }),
    ).toThrow(/3x3/);
    expect(() =>
      rowsToHomography([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, Number.NaN],
      ]),
    ).toThrow(/3x3/);
  });
});

describe("buildPlane: when the correction does not apply", () => {
  it("uses the focal length estimated from a well-tilted homography when the photo has no EXIF", () => {
    const shot = syntheticShot();
    const built = buildPlane(input(shot, { exifFocalPx: null }))!;
    expect(built.plane.parallax).toMatchObject({
      corrected: true,
      focalSource: "homography",
      exifFocalPx: null,
    });
    expect(built.plane.parallax!.focalPx).toBeCloseTo(shot.exifFocalPx, -1);
    expect(
      Math.abs(built.measurements!.handLengthMm - TRUE_HAND_LENGTH_MM),
    ).toBeLessThan(0.5);
  });

  it("applies no correction, and says so, for a fronto-parallel photo with no EXIF", () => {
    const shot = syntheticShot({ tiltDeg: 0.5 });
    const built = buildPlane(input(shot, { exifFocalPx: null }))!;
    expect(built.plane.parallax).toMatchObject({
      corrected: false,
      focalSource: "none",
      focalPx: null,
    });
    const flat = shot.landmarksPx.map((p) =>
      applyHomography(shot.markerHomography, p),
    );
    expect(built.plane.landmarksSheetMm).toEqual(flat);
    expect(built.measurements).toEqual(
      computeHandMeasurements(shot.landmarksPx, shot.markerHomography),
    );
    // ...and the record still reproduces itself.
    expect(
      recomputePlane(shot.landmarksPx, roundTrip(built.plane)).measurements,
    ).toEqual(built.measurements);
  });

  it("records the plane and the focal choice when no hand was found", () => {
    const shot = syntheticShot();
    const built = buildPlane(input(shot, { landmarksPx: null }))!;
    expect(built.plane.homography).toHaveLength(3);
    expect(built.plane.landmarksSheetMm).toBeNull();
    expect(built.measurements).toBeNull();
    expect(built.plane.parallax).toMatchObject({
      corrected: false,
      focalSource: "exif",
    });
  });

  it("records 21 zero heights when nothing was lifted off the sheet (no correction, or no hand)", () => {
    const flat = buildPlane(
      input(syntheticShot({ tiltDeg: 0.5 }), { exifFocalPx: null }),
    )!;
    const noHand = buildPlane(input(syntheticShot(), { landmarksPx: null }))!;
    for (const built of [flat, noHand]) {
      expect(built.plane.parallax!.corrected).toBe(false);
      expect(built.plane.parallax!.heightsMm).toEqual(Array(21).fill(0));
      expect(built.plane.parallax!.heightsVersion).toBe(
        LANDMARK_HEIGHTS_MM_VERSION,
      );
    }
  });

  it("keeps the points but reports no measurements for a pose outside the contract's ranges", () => {
    const shot = syntheticShot();
    // A fist: every landmark pulled halfway to the wrist, so the hand is too short.
    const wrist = shot.landmarksPx[0]!;
    const fist = shot.landmarksPx.map((p) => ({
      x: wrist.x + (p.x - wrist.x) * 0.4,
      y: wrist.y + (p.y - wrist.y) * 0.4,
    }));
    const built = buildPlane(input(shot, { landmarksPx: fist }))!;
    expect(built.measurements).toBeNull();
    expect(built.plane.landmarksSheetMm).toHaveLength(21);
    expect(built.plane.parallax!.corrected).toBe(true);
  });

  it("does not throw on a degenerate homography; it records the reason and no points", () => {
    const shot = syntheticShot();
    const singular: Homography = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ];
    const built = buildPlane(input(shot, { homography: singular }))!;
    expect(built.measurements).toBeNull();
    expect(built.plane.landmarksSheetMm).toBeNull();
    // Only the error's class name: its message can quote values.
    expect(built.plane.parallax!.error).toBe("RangeError");
  });

  it("also records only the class name when the focal length cannot be recovered (no EXIF focal length, degenerate homography)", () => {
    const shot = syntheticShot();
    const singular: Homography = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ];
    const built = buildPlane(
      input(shot, { homography: singular, exifFocalPx: null }),
    )!;
    expect(built.measurements).toBeNull();
    expect(built.plane.landmarksSheetMm).toBeNull();
    expect(built.plane.parallax).toMatchObject({
      corrected: false,
      focalSource: "none",
      focalPx: null,
      error: "RangeError",
    });
  });

  it("gives no plane at all for a homography that is not finite", () => {
    const shot = syntheticShot();
    const broken = [
      [1, 0, 0],
      [0, Number.NaN, 0],
      [0, 0, 1],
    ] as unknown as Homography;
    expect(buildPlane(input(shot, { homography: broken }))).toBeNull();
  });

  it("reports a wrong landmark count as a recorded error, not a crash", () => {
    const shot = syntheticShot();
    const built = buildPlane(
      input(shot, { landmarksPx: shot.landmarksPx.slice(0, 20) }),
    )!;
    expect(built.measurements).toBeNull();
    expect(built.plane.landmarksSheetMm).toBeNull();
    expect(built.plane.parallax!.error).toBe("RangeError");
    // Not the message, which says how many landmarks it got and wanted.
    expect(built.plane.parallax!.error).not.toMatch(/landmark|height|\d/i);
  });
});

describe("buildPlane: a strip plane (side page)", () => {
  it("records the strip homography and the flat projection, with no parallax settings and no measurements", () => {
    const shot = syntheticShot();
    const built = buildPlane(
      input(shot, { method: "strip-markers", parallax: false }),
    )!;
    expect(built.plane.method).toBe("strip-markers");
    expect(built.plane.parallax).toBeNull();
    expect(built.measurements).toBeNull();
    expect(built.plane.landmarksSheetMm).toEqual(
      shot.landmarksPx.map((p) => applyHomography(shot.markerHomography, p)),
    );
  });
});

describe("an independent synthetic scene, rendered to pixels", () => {
  const shot = independentShot();

  it("the paper is found by the real detector (precondition)", () => {
    expect(shot.quad.corners).not.toBeNull();
    expect(shot.quad.cornersSeen).toBe(4);
  });

  it("the projector used for the hand agrees with the generator's own paper-to-image homography at height zero", () => {
    const h = shot.paperToImage;
    const camera = independentSceneCamera(shot.scene);
    for (const [x, y] of [
      [0, 0],
      [210, 0],
      [105, 148.5],
      [30, 250],
    ] as const) {
      const w = h[6]! * x + h[7]! * y + h[8]!;
      const exact = {
        x: (h[0]! * x + h[1]! * y + h[2]!) / w,
        y: (h[3]! * x + h[4]! * y + h[5]!) / w,
      };
      const projected = camera.project(x, y, 0);
      expect(projected.x).toBeCloseTo(exact.x, 6);
      expect(projected.y).toBeCloseTo(exact.y, 6);
    }
    // ...and a point 20 mm up lands elsewhere (toward the image centre's far side).
    expect(camera.project(105, 148.5, 20)).not.toEqual(
      camera.project(105, 148.5, 0),
    );
  });

  it("through the paper edges: a saved record reproduces the live mm values and both sit near the truth", () => {
    const built = buildPlane({
      method: "paper-edge",
      homography: shot.paperHomography,
      fit: NO_FIT,
      landmarksPx: shot.landmarksPx,
      exifFocalPx: shot.exifFocalPx,
      imageSize: shot.imageSize,
      parallax: true,
    })!;
    const saved = roundTrip(built.plane);
    const again = recomputePlane(roundTrip(shot.landmarksPx), saved);

    expect(again.points).toEqual(built.plane.landmarksSheetMm);
    expect(again.measurements).toEqual(built.measurements);
    expect(built.plane.parallax!.corrected).toBe(true);
    expect(
      Math.abs(built.measurements!.handLengthMm - TRUE_HAND_LENGTH_MM),
    ).toBeLessThan(0.5);
    expect(
      Math.abs(built.measurements!.palmWidthMm - TRUE_PALM_WIDTH_MM),
    ).toBeLessThan(0.5);

    // The correction matters here: the flat projection is off by millimetres.
    const flat = computeHandMeasurements(
      shot.landmarksPx,
      shot.paperHomography,
    );
    expect(flat.handLengthMm - TRUE_HAND_LENGTH_MM).toBeGreaterThan(1.5);
  });
});

describe("recomputePlane: the two branches that used to be untested", () => {
  const shot = syntheticShot();

  it("a strip plane (no parallax record) recomputes its points and gives no measurements, like buildPlane", () => {
    const built = buildPlane(
      input(shot, { method: "strip-markers", parallax: false }),
    )!;
    expect(built.measurements).toBeNull();
    const again = recomputePlane(shot.landmarksPx, roundTrip(built.plane));
    expect(again.points).toEqual(built.plane.landmarksSheetMm);
    // A full, plausible hand in this plane would measure fine; the plane says it must not.
    expect(again.measurements).toBeNull();
  });

  it("a pose outside the contract's ranges keeps its points and gives no measurements (the catch branch)", () => {
    const wrist = shot.landmarksPx[0]!;
    const fist = shot.landmarksPx.map((p) => ({
      x: wrist.x + (p.x - wrist.x) * 0.4,
      y: wrist.y + (p.y - wrist.y) * 0.4,
    }));
    const built = buildPlane(input(shot, { landmarksPx: fist }))!;
    expect(built.measurements).toBeNull();
    const again = recomputePlane(fist, roundTrip(built.plane));
    expect(again.points).toHaveLength(21);
    expect(again.points).toEqual(built.plane.landmarksSheetMm);
    expect(again.measurements).toBeNull();
  });

  it("a recorded plane whose landmarks are fine still measures (so the null above is the plane's doing)", () => {
    const built = buildPlane(input(shot))!;
    expect(
      recomputePlane(shot.landmarksPx, roundTrip(built.plane)).measurements,
    ).not.toBeNull();
  });
});

// What landmark-heights-v1 wrote into every plane of every log: these 21
// millimetres, the same for every photo, under this version string. Written out
// as literals on purpose, so that nothing the current build changes can move
// them.
const V1_HEIGHTS_MM = [
  20, 18, 15, 11, 6, 13, 10, 8, 6, 13, 10, 8, 6, 13, 10, 8, 6, 13, 10, 8, 6,
] as const;

describe("recomputePlane: a log written by landmark-heights-v1 is worked out with the heights it recorded", () => {
  // A 160 mm hand whose landmarks really stand at the v1 heights, as a v1
  // build's correction assumed. The v2 algorithm would assume other heights
  // for it (about 0.8 mm of hand length different, see below).
  const shot = syntheticShot({ handLengthMm: 160, heightsMm: V1_HEIGHTS_MM });
  const principalPoint = centrePrincipalPoint(
    shot.imageSize.width,
    shot.imageSize.height,
  );
  // The old record as the old build wrote it, built from the unchanged
  // primitive `correctLandmarks` (v1's buildPlane called it with the constant).
  const v1Points = correctLandmarks(
    shot.landmarksPx,
    shot.markerHomography,
    { fPx: shot.exifFocalPx, ...principalPoint },
    V1_HEIGHTS_MM,
  );
  const v1Plane: PlaneCalibration = {
    method: "markers",
    homography: homographyToRows(shot.markerHomography),
    fit: NO_FIT,
    parallax: {
      corrected: true,
      focalSource: "exif",
      focalPx: shot.exifFocalPx,
      exifFocalPx: shot.exifFocalPx,
      principalPoint,
      imageSize: shot.imageSize,
      heightsVersion: "landmark-heights-v1",
      heightsMm: [...V1_HEIGHTS_MM],
      error: null,
    },
    landmarksSheetMm: v1Points,
  };
  const saved = roundTrip(v1Plane);

  it("reproduces the recorded points and measurements exactly", () => {
    const again = recomputePlane(roundTrip(shot.landmarksPx), saved);
    expect(again.points).toEqual(saved.landmarksSheetMm);
    expect(again.measurements).toEqual(measurementsFromSheetMm(v1Points));
    // The recorded heights were the true ones, so the hand comes out true.
    expect(Math.abs(again.measurements!.handLengthMm - 160)).toBeLessThan(0.01);
  });

  it("is not replaced by the current algorithm: a v2 build of the same photo gives different numbers", () => {
    const again = recomputePlane(shot.landmarksPx, saved);
    const v2 = buildPlane(input(shot))!;
    // The v2 algorithm measures this photo's 160 mm hand about 0.76 mm long.
    expect(
      Math.abs(
        v2.measurements!.handLengthMm - again.measurements!.handLengthMm,
      ),
    ).toBeGreaterThan(0.5);
    expect(v2.plane.parallax!.heightsVersion).toBe("landmark-heights-v2");
    expect(v2.plane.parallax!.heightsMm).not.toEqual([...V1_HEIGHTS_MM]);
  });

  it("goes by the recorded heights, not by the version label", () => {
    const relabelled = {
      ...saved,
      parallax: {
        ...saved.parallax!,
        heightsVersion: LANDMARK_HEIGHTS_MM_VERSION,
      },
    };
    expect(recomputePlane(shot.landmarksPx, relabelled)).toEqual(
      recomputePlane(shot.landmarksPx, saved),
    );
    // ...and the current ratios, applied to this hand, are not what it used.
    expect(landmarkHeightsMm(160)).not.toEqual([...V1_HEIGHTS_MM]);
  });
});
