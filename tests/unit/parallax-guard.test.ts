/**
 * V3.2 F16 (candidate, 未拍板): the parallax correction's safety check.
 *
 * Kirby's preview-6 "後傾" scan (實測, 2026-10-23): a hand-placed frame whose
 * homography gave a focal estimate of 894 px judged reliable but outside the
 * prior's range, so the nominal 1442 px was used, and the hand came out
 * 185.7 mm uncorrected, 205.4 mm corrected (palm length 94.3 -> 101.3, palm
 * width 66.5 -> 60.8). His numbers are used here only as scenario values.
 *
 * The pinhole scenes below are SIMULATED (模擬): they reproduce the same
 * pattern from geometry alone (tests/unit/helpers/oblique-scene.ts).
 */
import { describe, expect, it } from "vitest";
import { PARALLAX_GUARD } from "../../src/client/camera/constants";
import { estimateFocalFromHomography } from "../../src/client/geometry/focal-from-homography";
import {
  estimateHomography,
  type Homography,
  type Point2,
} from "../../src/client/geometry/homography";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
} from "../../src/client/geometry/measurements";
import { recoverCameraPose } from "../../src/client/geometry/camera-pose";
import { nominalFocalPxFromLongEdge } from "../../src/client/geometry/nominalFocalShadow";
import { focalWithinPrior } from "../../src/client/geometry/parallax";
import {
  focalCorroborated,
  judgeParallaxCorrection,
  type GuardedLengths,
} from "../../src/client/geometry/parallaxGuard";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import type { SheetQuadDetection } from "../../src/client/paper/detect";
import {
  finishPaperEdge,
  guardCorrection,
  type PaperEdgeFinishInput,
} from "../../src/client/photo/paperEdgeFinish";
import { buildExifJpeg, TAG } from "./helpers/exif-jpeg";
import { buildObliqueScene, OBLIQUE_PAPER_MM } from "./helpers/oblique-scene";
import { buildShadowScene } from "./helpers/shadow-scene";

const lengths = (
  handLengthMm: number,
  palmLengthMm: number,
  palmWidthMm: number,
): GuardedLengths => ({ handLengthMm, palmLengthMm, palmWidthMm });

describe("judgeParallaxCorrection (pure)", () => {
  it("the named limits: 0.99 for the two lengths, 0.985 for the width, 1.10 for all three, the focal estimate within 0.85-1.4 of the one used", () => {
    expect(PARALLAX_GUARD).toEqual({
      minLengthRatio: 0.99,
      minWidthRatio: 0.985,
      maxRatio: 1.1,
      focalAgreement: { min: 0.85, max: 1.4 },
    });
  });

  it("Kirby's failing scan (scenario values): refused, the hand made longer", () => {
    const verdict = judgeParallaxCorrection(
      lengths(185.7, 94.3, 66.5),
      lengths(205.4, 101.3, 60.8),
    );
    expect(verdict.accept).toBe(false);
    if (verdict.accept) return;
    expect(verdict.reason).toBe("lengthened");
    expect(verdict.field).toBe("handLength");
    expect(verdict.ratios.handLength).toBeCloseTo(185.7 / 205.4, 12);
    expect(verdict.ratios.palmWidth).toBeCloseTo(66.5 / 60.8, 12);
  });

  it("every ratio Kirby's other eight scans showed (1.018-1.056, width 0.990-1.058) and R7's simulated ones (to 1.080) passes", () => {
    for (const k of [1.018, 1.02, 1.04, 1.056, 1.06, 1.08]) {
      for (const kw of [0.99, 1.0, 1.035, 1.058]) {
        const v = judgeParallaxCorrection(
          lengths(190 * k, 100 * k, 80 * kw),
          lengths(190, 100, 80),
        );
        expect(v.accept).toBe(true);
      }
    }
  });

  it("the ends are included; just past them is refused, with the reason and the field", () => {
    const at = (kL: number, kP: number, kW: number) =>
      judgeParallaxCorrection(
        lengths(200 * kL, 100 * kP, 80 * kW),
        lengths(200, 100, 80),
      );
    expect(at(0.99, 1.04, 1.04).accept).toBe(true);
    expect(at(1.1, 1.1, 0.985).accept).toBe(true);
    expect(at(0.9899, 1.04, 1.04)).toMatchObject({
      accept: false,
      reason: "lengthened",
      field: "handLength",
    });
    expect(at(1.04, 0.9899, 1.04)).toMatchObject({
      accept: false,
      reason: "lengthened",
      field: "palmLength",
    });
    expect(at(1.04, 1.04, 0.9849)).toMatchObject({
      accept: false,
      reason: "lengthened",
      field: "palmWidth",
    });
    expect(at(1.04, 1.1001, 1.04)).toMatchObject({
      accept: false,
      reason: "over_shortened",
      field: "palmLength",
    });
    expect(at(1.04, 1.04, 1.1001)).toMatchObject({
      accept: false,
      reason: "over_shortened",
      field: "palmWidth",
    });
  });

  it("a ratio that cannot be worked out is refused, never accepted", () => {
    expect(
      judgeParallaxCorrection(lengths(190, 100, 80), lengths(0, 100, 80)),
    ).toMatchObject({ accept: false, reason: "not_finite" });
    expect(
      judgeParallaxCorrection(lengths(190, NaN, 80), lengths(190, 100, 80)),
    ).toMatchObject({
      accept: false,
      reason: "not_finite",
      field: "palmLength",
    });
  });
});

// ── The failing situation, reproduced (模擬) ──────────────────────────────

const FRAME = { width: 1080, height: 1920 };
/**
 * The PRE-F17 nominal prior on this frame (26 mm equivalent, 1442 px), passed
 * explicitly: every F16 scene below was built around it, and the guard's
 * mechanism does not depend on which prior the pipeline uses today. The
 * F17 prior (18 mm, 998 px) is `F17_PRIOR`, re-checked at the end.
 */
const NOMINAL = (26 / 43.27) * 1.25 * FRAME.height;
const F17_PRIOR = nominalFocalPxFromLongEdge(FRAME.height)!;
/** The long edge that makes the pipeline's own prior the pre-F17 1442 px. */
const LONG_EDGE_FOR_26MM = (FRAME.height * 26) / 18;
const PRINCIPAL = { cx: FRAME.width / 2, cy: FRAME.height / 2 };
const SHEET_MM: readonly Point2[] = [
  { x: 0, y: 0 },
  { x: OBLIQUE_PAPER_MM.width, y: 0 },
  { x: OBLIQUE_PAPER_MM.width, y: OBLIQUE_PAPER_MM.height },
  { x: 0, y: OBLIQUE_PAPER_MM.height },
];
const homographyOf = (corners: readonly Point2[]): Homography =>
  estimateHomography(corners.map((src, i) => ({ src, dst: SHEET_MM[i] })));
const len = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const aspectOf = (c: readonly Point2[]) =>
  (len(c[0], c[1]) + len(c[3], c[2])) / (len(c[0], c[3]) + len(c[1], c[2]));

/**
 * A frame whose sheet, as the homography sees it, implies a focal length of
 * 894 px: a camera of that focal length tilted 25 degrees back towards the
 * wrist. The sheet then reads 0.770 wide over tall (A4 is 0.707; Kirby's
 * frame read 0.7745). Whether his 894 px came from the lens or from corners
 * placed off the sheet's (a manual frame) is not known (不確定): the guard
 * does not need to know, because in both cases the correction is made with a
 * focal length the homography disagrees with.
 */
const KIRBY_LIKE = buildObliqueScene({
  width: FRAME.width,
  height: FRAME.height,
  fPx: 894,
  tiltDeg: 25,
  azimuthDeg: -80,
  distanceMm: 380,
  handScale: 0.95,
});

describe("the 185.7 -> 205.4 mm correction, reproduced (模擬)", () => {
  const h = homographyOf(KIRBY_LIKE.corners);

  it("the situation: the homography's estimate is reliable, about 894 px, refused by the range check, so the nominal prior is used", () => {
    expect(aspectOf(KIRBY_LIKE.corners)).toBeGreaterThan(0.765);
    expect(aspectOf(KIRBY_LIKE.corners)).toBeLessThan(0.775);
    const estimate = estimateFocalFromHomography(h, PRINCIPAL)!;
    expect(estimate.reliable).toBe(true);
    expect(estimate.fPx).toBeCloseTo(894, 0);
    expect(focalWithinPrior(estimate.fPx, NOMINAL)).toBe(false);
    const corrected = computeCorrectedHandMeasurements(
      KIRBY_LIKE.landmarksPx,
      h,
      {
        exifFocalPx: null,
        widthPx: FRAME.width,
        heightPx: FRAME.height,
        nominalFocalPx: NOMINAL,
      },
    );
    expect(corrected.focalSource).toBe("nominal");
    expect(corrected.fPx).toBeCloseTo(1442, 0);
  });

  it("the failure: corrected with 1442 px the hand and the palm come out LONGER than uncorrected, the width much narrower (Kirby: 0.904 / 0.931 / 1.094)", () => {
    const uncorrected = computeHandMeasurements(KIRBY_LIKE.landmarksPx, h);
    const corrected = computeCorrectedHandMeasurements(
      KIRBY_LIKE.landmarksPx,
      h,
      {
        exifFocalPx: null,
        widthPx: FRAME.width,
        heightPx: FRAME.height,
        nominalFocalPx: NOMINAL,
      },
    ).measurements;
    const kL = uncorrected.handLengthMm / corrected.handLengthMm;
    const kP = uncorrected.palmLengthMm / corrected.palmLengthMm;
    const kW = uncorrected.palmWidthMm / corrected.palmWidthMm;
    // Simulated: 0.919 / 0.954 / 1.099.
    expect(kL).toBeLessThan(0.93);
    expect(kP).toBeLessThan(0.97);
    expect(kW).toBeGreaterThan(1.08);
    // About 16 mm too long against the true hand; the uncorrected hand is within 1 mm of it.
    expect(
      corrected.handLengthMm - KIRBY_LIKE.trueHandLengthMm,
    ).toBeGreaterThan(12);
    expect(
      Math.abs(uncorrected.handLengthMm - KIRBY_LIKE.trueHandLengthMm),
    ).toBeLessThan(1);
  });

  it("the mechanism: with the wrong focal length the pose puts the camera far off on the wrist's side, and higher", () => {
    const wrong = recoverCameraPose(h, { fPx: NOMINAL, ...PRINCIPAL });
    const right = recoverCameraPose(h, { fPx: 894, ...PRINCIPAL });
    // World Y is up the page (camera-pose.ts): sheet y = -Yw. The wrist is at sheet y = 60.
    const sheetY = (pose: typeof wrong) => -pose.cameraCentreWorld[1];
    expect(sheetY(right)).toBeGreaterThan(-30);
    expect(sheetY(wrong)).toBeLessThan(-150);
    expect(wrong.cameraHeightMm).toBeGreaterThan(right.cameraHeightMm + 80);
  });

  it("with the focal length the homography agrees with, the same photo corrects the normal way (ratios above 1)", () => {
    const uncorrected = computeHandMeasurements(KIRBY_LIKE.landmarksPx, h);
    const right = computeCorrectedHandMeasurements(KIRBY_LIKE.landmarksPx, h, {
      exifFocalPx: 894,
      widthPx: FRAME.width,
      heightPx: FRAME.height,
    });
    expect(
      judgeParallaxCorrection(uncorrected, right.measurements).accept,
    ).toBe(true);
    expect(right.measurements.handLengthMm).toBeCloseTo(
      KIRBY_LIKE.trueHandLengthMm,
      0,
    );
  });

  it("the guard: the correction is refused and the uncorrected numbers are used, with the reason", () => {
    const corrected = computeCorrectedHandMeasurements(
      KIRBY_LIKE.landmarksPx,
      h,
      {
        exifFocalPx: null,
        widthPx: FRAME.width,
        heightPx: FRAME.height,
        nominalFocalPx: NOMINAL,
      },
    );
    const guarded = guardCorrection(
      corrected,
      KIRBY_LIKE.landmarksPx,
      h,
      PRINCIPAL,
    );
    expect(guarded.corrected).toEqual({
      measurements: computeHandMeasurements(KIRBY_LIKE.landmarksPx, h),
      parallaxCorrected: false,
      focalSource: "none",
      fPx: null,
      heightsMm: null,
    });
    expect(guarded.refusal).toMatchObject({
      refused: true,
      reason: "lengthened",
      field: "handLength",
      refusedFocal: { source: "nominal", px: NOMINAL },
    });
  });
});

describe("normal corrections are untouched (模擬)", () => {
  const scenes = [
    // The frame path: the nominal prior is the scene's own focal length.
    { fPx: NOMINAL, tiltDeg: 0, cameraHeightMm: 450 },
    { fPx: NOMINAL, tiltDeg: 5, cameraHeightMm: 420 },
    { fPx: NOMINAL, tiltDeg: 10, cameraHeightMm: 380 },
  ];

  for (const s of scenes) {
    it(`tilt ${s.tiltDeg} deg, ${s.cameraHeightMm} mm: the very same result object back, no refusal; the ratios are 1.02-1.06`, () => {
      const scene = buildShadowScene({
        width: FRAME.width,
        height: FRAME.height,
        ...s,
      });
      const h = homographyOf(scene.corners);
      for (const exifFocalPx of [null, s.fPx]) {
        const corrected = computeCorrectedHandMeasurements(
          scene.landmarksPx,
          h,
          {
            exifFocalPx,
            widthPx: FRAME.width,
            heightPx: FRAME.height,
            nominalFocalPx: NOMINAL,
          },
        );
        expect(corrected.parallaxCorrected).toBe(true);
        const guarded = guardCorrection(
          corrected,
          scene.landmarksPx,
          h,
          PRINCIPAL,
        );
        expect(guarded.corrected).toBe(corrected);
        expect(guarded.refusal).toBeNull();
        const v = judgeParallaxCorrection(
          computeHandMeasurements(scene.landmarksPx, h),
          corrected.measurements,
        );
        if (!v.accept) throw new Error("refused");
        expect(v.ratios.handLength).toBeGreaterThan(1.02);
        expect(v.ratios.handLength).toBeLessThan(1.06);
      }
    });
  }

  it("a scan with no correction is returned as it came", () => {
    const scene = buildShadowScene({
      width: FRAME.width,
      height: FRAME.height,
      fPx: NOMINAL,
      tiltDeg: 0,
      cameraHeightMm: 450,
    });
    const h = homographyOf(scene.corners);
    const uncorrected = computeCorrectedHandMeasurements(scene.landmarksPx, h, {
      exifFocalPx: null,
      widthPx: FRAME.width,
      heightPx: FRAME.height,
    });
    expect(uncorrected.parallaxCorrected).toBe(false);
    const guarded = guardCorrection(
      uncorrected,
      scene.landmarksPx,
      h,
      PRINCIPAL,
    );
    expect(guarded.corrected).toBe(uncorrected);
    expect(guarded.refusal).toBeNull();
  });
});

describe("focalCorroborated (pure)", () => {
  it("a focal length from EXIF is always backed, whatever the estimate", () => {
    for (const estimate of [null, 1, 894, 1442, NaN, 1e9])
      expect(focalCorroborated("exif", 1442, estimate)).toBe(true);
  });

  it("otherwise the estimate must exist and be within 0.85-1.4 of the one used, ends included", () => {
    expect(focalCorroborated("nominal", 1000, 850)).toBe(true);
    expect(focalCorroborated("nominal", 1000, 1400)).toBe(true);
    expect(focalCorroborated("nominal", 1000, 1000)).toBe(true);
    expect(focalCorroborated("nominal", 1000, 849.9)).toBe(false);
    expect(focalCorroborated("nominal", 1000, 1400.1)).toBe(false);
    expect(focalCorroborated("homography", 1000, 849.9)).toBe(false);
    expect(focalCorroborated("nominal", 1000, null)).toBe(false);
    expect(focalCorroborated("nominal", 1000, NaN)).toBe(false);
    expect(focalCorroborated("nominal", 1000, 0)).toBe(false);
    expect(focalCorroborated("nominal", 0, 1000)).toBe(false);
    // Kirby's failing scan (實測 values): 894 px against the nominal 1442 px.
    expect(focalCorroborated("nominal", 1442, 894)).toBe(false);
  });
});

const inFrame = (corners: readonly Point2[]) =>
  corners.every(
    (p) => p.x >= 0 && p.x <= FRAME.width && p.y >= 0 && p.y <= FRAME.height,
  );

function correctOblique(
  scene: ReturnType<typeof buildObliqueScene>,
  exifFocalPx: number | null,
) {
  const h = homographyOf(scene.corners);
  const corrected = computeCorrectedHandMeasurements(scene.landmarksPx, h, {
    exifFocalPx,
    widthPx: FRAME.width,
    heightPx: FRAME.height,
    nominalFocalPx: NOMINAL,
  });
  const uncorrected = computeHandMeasurements(scene.landmarksPx, h);
  const guarded = guardCorrection(corrected, scene.landmarksPx, h, PRINCIPAL);
  return { corrected, uncorrected, guarded };
}

describe("right corrections of a camera tilted 30-40 degrees are kept (模擬)", () => {
  // The ratio alone would refuse these: the basis numbers of constants.ts.
  const BASIS = [
    { tiltDeg: 30, azimuthDeg: -90, ratio: 0.988 },
    { tiltDeg: 35, azimuthDeg: -90, ratio: 0.98 },
    { tiltDeg: 40, azimuthDeg: -90, ratio: 0.971 },
    { tiltDeg: 40, azimuthDeg: 90, ratio: 1.105 },
  ];
  for (const b of BASIS) {
    it(`true focal length, ${b.tiltDeg} deg towards the ${b.azimuthDeg < 0 ? "wrist" : "fingertips"}, 450 mm: the hand-length ratio reads ${b.ratio}, outside the limits`, () => {
      const scene = buildObliqueScene({
        ...FRAME,
        fPx: NOMINAL,
        tiltDeg: b.tiltDeg,
        azimuthDeg: b.azimuthDeg,
        distanceMm: 450,
      });
      expect(inFrame(scene.corners)).toBe(true);
      const { corrected, uncorrected } = correctOblique(scene, null);
      const v = judgeParallaxCorrection(uncorrected, corrected.measurements);
      expect(v.accept).toBe(false);
      expect(v.ratios.handLength).toBeCloseTo(b.ratio, 3);
    });
  }

  for (const tiltDeg of [30, 35, 40])
    for (const azimuthDeg of [-90, 90])
      for (const exif of [false, true])
        it(`${tiltDeg} deg, azimuth ${azimuthDeg}, ${exif ? "EXIF" : "no EXIF (nominal)"}: the very same correction back, the hand within 0.5 mm of the true one`, () => {
          const scene = buildObliqueScene({
            ...FRAME,
            fPx: NOMINAL,
            tiltDeg,
            azimuthDeg,
            distanceMm: 450,
          });
          expect(inFrame(scene.corners)).toBe(true);
          const { corrected, guarded } = correctOblique(
            scene,
            exif ? NOMINAL : null,
          );
          expect(corrected.focalSource).toBe(exif ? "exif" : "nominal");
          expect(guarded.corrected).toBe(corrected);
          expect(guarded.refusal).toBeNull();
          expect(
            Math.abs(
              corrected.measurements.handLengthMm - scene.trueHandLengthMm,
            ),
          ).toBeLessThan(0.5);
        });
});

describe("a focal length off by 10-30 %, tilted 15-30 degrees, no EXIF (模擬)", () => {
  for (const k of [0.9, 1.1, 1.2, 1.3])
    for (const tiltDeg of [15, 20, 25, 30])
      for (const azimuthDeg of [-90, 90])
        it(`true focal ${k} x nominal, ${tiltDeg} deg, azimuth ${azimuthDeg}, 420 mm: kept`, () => {
          const scene = buildObliqueScene({
            ...FRAME,
            fPx: NOMINAL * k,
            tiltDeg,
            azimuthDeg,
            distanceMm: 420,
          });
          const { corrected, guarded } = correctOblique(scene, null);
          expect(corrected.focalSource).toBe("nominal");
          // The correction's own error (up to about 8 mm here, from the
          // focal length being off) is what it was before F16: the guard
          // only decides whether to use it.
          expect(guarded.corrected).toBe(corrected);
          expect(guarded.refusal).toBeNull();
        });

  it("1.2 x nominal, 30 deg towards the fingertips: ratio 1.101, kept, because it takes the hand from +15.5 mm to -3.3 mm", () => {
    const scene = buildObliqueScene({
      ...FRAME,
      fPx: NOMINAL * 1.2,
      tiltDeg: 30,
      azimuthDeg: 90,
      distanceMm: 420,
    });
    const { corrected, uncorrected, guarded } = correctOblique(scene, null);
    expect(
      judgeParallaxCorrection(uncorrected, corrected.measurements).ratios
        .handLength,
    ).toBeCloseTo(1.101, 3);
    expect(uncorrected.handLengthMm - scene.trueHandLengthMm).toBeCloseTo(
      15.5,
      1,
    );
    expect(
      corrected.measurements.handLengthMm - scene.trueHandLengthMm,
    ).toBeCloseTo(-3.3, 1);
    expect(guarded.corrected).toBe(corrected);
  });

  it("0.8 x nominal, 20 deg towards the wrist: ratio 0.978, refused, because the correction is worse (+5.2 mm against +0.8 mm)", () => {
    const scene = buildObliqueScene({
      ...FRAME,
      fPx: NOMINAL * 0.8,
      tiltDeg: 20,
      azimuthDeg: -90,
      distanceMm: 420,
    });
    const { corrected, uncorrected, guarded } = correctOblique(scene, null);
    expect(
      corrected.measurements.handLengthMm - scene.trueHandLengthMm,
    ).toBeCloseTo(5.2, 1);
    expect(uncorrected.handLengthMm - scene.trueHandLengthMm).toBeCloseTo(
      0.8,
      1,
    );
    expect(guarded.refusal).toMatchObject({
      reason: "lengthened",
      field: "handLength",
    });
    expect(guarded.refusal!.ratios.handLength).toBeCloseTo(0.978, 3);
    expect(guarded.corrected.measurements).toEqual(uncorrected);
  });
});

describe("corners placed off the sheet's (模擬)", () => {
  const scene = buildShadowScene({
    width: FRAME.width,
    height: FRAME.height,
    fPx: NOMINAL,
    tiltDeg: 5,
    cameraHeightMm: 420,
  });
  /** The two corners of one edge moved `px` inwards, along the edge. */
  const nudge = (edge: "top" | "bottom", px: number) =>
    scene.corners.map((p, i) => {
      const onEdge = edge === "top" ? i < 2 : i >= 2;
      if (!onEdge) return p;
      return { x: p.x + (i === 0 || i === 3 ? px : -px), y: p.y };
    });
  const guardOn = (corners: readonly Point2[]) => {
    const h = homographyOf(corners);
    const corrected = computeCorrectedHandMeasurements(scene.landmarksPx, h, {
      exifFocalPx: null,
      widthPx: FRAME.width,
      heightPx: FRAME.height,
      nominalFocalPx: NOMINAL,
    });
    return {
      estimate: estimateFocalFromHomography(h, PRINCIPAL),
      guarded: guardCorrection(corrected, scene.landmarksPx, h, PRINCIPAL),
    };
  };

  it("60 px in on the top edge: no focal estimate, the palm width reads 1.10-1.12, refused as over_shortened", () => {
    const { estimate, guarded } = guardOn(nudge("top", 60));
    expect(estimate).toBeNull();
    expect(guarded.refusal).toMatchObject({
      reason: "over_shortened",
      field: "palmWidth",
    });
    expect(guarded.refusal!.ratios.palmWidth).toBeGreaterThan(1.1);
    expect(guarded.refusal!.ratios.palmWidth).toBeLessThan(1.12);
  });

  it("40 px in on the bottom edge: no focal estimate, the hand made longer, refused", () => {
    const { estimate, guarded } = guardOn(nudge("bottom", 40));
    expect(estimate).toBeNull();
    expect(guarded.refusal).toMatchObject({
      reason: "lengthened",
      field: "handLength",
    });
  });
});

describe("the EXIF path is left as it was (模擬)", () => {
  it("an EXIF focal length is never refused, even a wrong one on the Kirby-like corners (a known limit: the guard cannot see a wrong EXIF)", () => {
    const h = homographyOf(KIRBY_LIKE.corners);
    const corrected = computeCorrectedHandMeasurements(
      KIRBY_LIKE.landmarksPx,
      h,
      {
        exifFocalPx: NOMINAL,
        widthPx: FRAME.width,
        heightPx: FRAME.height,
        nominalFocalPx: NOMINAL,
      },
    );
    expect(corrected.focalSource).toBe("exif");
    expect(
      judgeParallaxCorrection(
        computeHandMeasurements(KIRBY_LIKE.landmarksPx, h),
        corrected.measurements,
      ).accept,
    ).toBe(false);
    const guarded = guardCorrection(
      corrected,
      KIRBY_LIKE.landmarksPx,
      h,
      PRINCIPAL,
    );
    expect(guarded.corrected).toBe(corrected);
    expect(guarded.refusal).toBeNull();
  });
});

describe("finishPaperEdge with the guard (模擬)", () => {
  function input(
    scene: { corners: readonly Point2[]; landmarksPx: Point2[] },
    over: Partial<PaperEdgeFinishInput> = {},
  ): PaperEdgeFinishInput {
    const quad: SheetQuadDetection = {
      corners: scene.corners as SheetQuadDetection["corners"],
      cornersSeen: 4,
      cornersFound: [true, true, true, true],
      partialCorners: scene.corners as SheetQuadDetection["partialCorners"],
      minSideCoverage: 1,
      edgeFitResidualPx: 0.2,
      worstSideIndex: 0,
      paperRegionFound: true,
    };
    return {
      quad,
      paperEval: evaluatePaperEdgeCalibration(quad, "a4", false),
      paperSize: "a4",
      hand: {
        landmarksPx: scene.landmarksPx,
        handedness: "right",
        confidence: 0.95,
      },
      request: { hand: "right", handExplicit: true },
      laplacianVariance: 150,
      decoded: FRAME,
      crop: null,
      readJpegBytes: async () => null,
      // A frame of the live video: the camera passes the stream's long edge
      // (the 18 mm video-frame prior; F17 review).
      focalReferenceLongEdgePx: Math.max(FRAME.width, FRAME.height),
      ...over,
    };
  }

  it("the failing frame (with the pre-F17 1442 px prior): measured uncorrected, submitted parallaxCorrected false / focalSource none, refusal kept for the log", async () => {
    const out = await finishPaperEdge(
      input(KIRBY_LIKE, { focalReferenceLongEdgePx: LONG_EDGE_FOR_26MM }),
    );
    expect(out.result.status).toBe("ok");
    if (out.result.status !== "ok") return;
    const h = homographyOf(KIRBY_LIKE.corners);
    expect(out.result.measurements).toEqual(
      computeHandMeasurements(KIRBY_LIKE.landmarksPx, h),
    );
    expect(out.parallaxCorrected).toBe(false);
    expect(out.focal).toEqual({ source: "none", px: null });
    expect(out.result.submission.calibration).toMatchObject({
      parallaxCorrected: false,
      focalSource: "none",
    });
    expect(out.parallaxGuard).toMatchObject({
      reason: "lengthened",
      refusedFocal: { source: "nominal" },
    });
    // The shadow's uncorrected numbers are now the reported ones.
    expect(out.shadowPrior?.handLengthDeltaMm).toBeCloseTo(0, 9);
  });

  it("a normal frame (no EXIF, and with EXIF): no refusal, still corrected", async () => {
    const scene = buildShadowScene({
      width: FRAME.width,
      height: FRAME.height,
      fPx: NOMINAL,
      tiltDeg: 5,
      cameraHeightMm: 420,
    });
    const frame = await finishPaperEdge(input(scene));
    expect(frame.parallaxGuard).toBeNull();
    expect(frame.parallaxCorrected).toBe(true);
    const exif = buildExifJpeg({
      exif: [
        { tag: TAG.focalLengthIn35mmFilm, value: { type: "short", value: 26 } },
      ],
    });
    const withExif = await finishPaperEdge(
      input(scene, { readJpegBytes: async () => exif }),
    );
    expect(withExif.focal?.source).toBe("exif");
    expect(withExif.parallaxGuard).toBeNull();
    expect(withExif.parallaxCorrected).toBe(true);
  });
});

describe("review fixes: what the focal-backing exception lets through, pinned (模擬)", () => {
  it("CURRENT CANDIDATE DESIGN (b4be146d, 未拍板): a nominal correction whose ratios are outside the limits is KEPT when the homography's estimate is 0.889 x the nominal (inside focalAgreement), even where it makes the hand longer", () => {
    // True focal length 0.889 x nominal, tilted 40 deg straight towards the
    // wrist: the estimate is unreliable, so the nominal prior corrects it.
    const scene = buildObliqueScene({
      ...FRAME,
      fPx: NOMINAL * 0.889,
      tiltDeg: 40,
      azimuthDeg: -90,
      distanceMm: 450,
    });
    expect(inFrame(scene.corners)).toBe(true);
    const h = homographyOf(scene.corners);
    const estimate = estimateFocalFromHomography(h, PRINCIPAL)!;
    expect(estimate.reliable).toBe(false);
    expect(estimate.fPx / NOMINAL).toBeCloseTo(0.889, 3);
    const { corrected, uncorrected, guarded } = correctOblique(scene, null);
    expect(corrected.focalSource).toBe("nominal");
    const v = judgeParallaxCorrection(uncorrected, corrected.measurements);
    expect(v).toMatchObject({ accept: false, reason: "lengthened" });
    expect(v.ratios.handLength).toBeCloseTo(0.939, 3);
    // The cost of the exception: the corrected hand is +6.6 mm off, the
    // uncorrected one -5.4 mm. Under the brief's literal AC2 (refuse on the
    // ratio alone) this would be refused instead.
    expect(
      corrected.measurements.handLengthMm - scene.trueHandLengthMm,
    ).toBeCloseTo(6.6, 1);
    expect(uncorrected.handLengthMm - scene.trueHandLengthMm).toBeCloseTo(
      -5.4,
      1,
    );
    expect(guarded.corrected).toBe(corrected);
    expect(guarded.refusal).toBeNull();
  });

  it("BY CONSTRUCTION: a correction whose focal length came from this frame's own homography (not reused) is never refused, whatever its ratios: the guard's estimate is that same estimate (ratio 1)", () => {
    // Reliable, within the prior's range: resolveFocalPx picks the homography.
    const scene = buildObliqueScene({
      ...FRAME,
      fPx: NOMINAL * 0.889,
      tiltDeg: 40,
      azimuthDeg: -80,
      distanceMm: 450,
    });
    const h = homographyOf(scene.corners);
    const estimate = estimateFocalFromHomography(h, PRINCIPAL)!;
    expect(estimate.reliable).toBe(true);
    const { corrected, uncorrected, guarded } = correctOblique(scene, null);
    expect(corrected.focalSource).toBe("homography");
    expect(corrected.fPx).toBe(estimate.fPx);
    expect(focalCorroborated("homography", corrected.fPx!, estimate.fPx)).toBe(
      true,
    );
    const v = judgeParallaxCorrection(uncorrected, corrected.measurements);
    expect(v).toMatchObject({ accept: false, reason: "lengthened" });
    expect(v.ratios.handLength).toBeCloseTo(0.972, 3);
    expect(guarded.corrected).toBe(corrected);
    expect(guarded.refusal).toBeNull();
    // Here the kept correction is the right one (the true focal length).
    expect(
      Math.abs(corrected.measurements.handLengthMm - scene.trueHandLengthMm),
    ).toBeLessThan(0.5);
  });

  it("a hand-placed frame reusing the automatic round's homography focal length (1442 px) that its own homography does not back (894 px): refused, the reused focal length in the log", () => {
    const h = homographyOf(KIRBY_LIKE.corners);
    const estimate = estimateFocalFromHomography(h, PRINCIPAL)!;
    expect(estimate.fPx / NOMINAL).toBeLessThan(
      PARALLAX_GUARD.focalAgreement.min,
    );
    const corrected = computeCorrectedHandMeasurements(
      KIRBY_LIKE.landmarksPx,
      h,
      {
        exifFocalPx: null,
        widthPx: FRAME.width,
        heightPx: FRAME.height,
        nominalFocalPx: NOMINAL,
        reusedFocal: { source: "homography", fPx: NOMINAL },
      },
    );
    expect(corrected.focalSource).toBe("homography");
    expect(corrected.fPx).toBe(NOMINAL);
    const guarded = guardCorrection(
      corrected,
      KIRBY_LIKE.landmarksPx,
      h,
      PRINCIPAL,
    );
    expect(guarded.refusal).toMatchObject({
      refused: true,
      reason: "lengthened",
      field: "handLength",
      refusedFocal: { source: "homography", px: NOMINAL },
    });
    expect(guarded.corrected).toEqual({
      measurements: computeHandMeasurements(KIRBY_LIKE.landmarksPx, h),
      parallaxCorrected: false,
      focalSource: "none",
      fPx: null,
      heightsMm: null,
    });
  });
});

describe("V3.2 F17: the guard re-checked under the 998 px prior (模擬; Kirby's measured focal values as scenario inputs)", () => {
  // Kirby's S25 homography estimates (實測, 1024 x 1920 frames, long edge 1920).
  const KIRBY_ESTIMATES = [1055, 1000.8, 902, 894, 934.6, 1153, 964];

  it("the prior is 998 px on this frame's 1920 px long edge", () => {
    expect(F17_PRIOR).toBeCloseTo(998.4, 1);
  });

  it("every one of Kirby's estimates is inside the prior's range and backed by it; under 1442 px five were outside the range and none was backed", () => {
    for (const f of KIRBY_ESTIMATES) {
      expect(focalWithinPrior(f, F17_PRIOR)).toBe(true);
      expect(focalCorroborated("nominal", F17_PRIOR, f)).toBe(true);
    }
    expect(
      KIRBY_ESTIMATES.filter((f) => !focalWithinPrior(f, NOMINAL)),
    ).toEqual([1000.8, 902, 894, 934.6, 964]);
    expect(
      KIRBY_ESTIMATES.filter((f) => !focalCorroborated("nominal", NOMINAL, f)),
    ).toEqual(KIRBY_ESTIMATES);
  });

  it("the Kirby-like frame (894 px, 25 deg back): the homography's own estimate is used, nothing refused, the hand within 0.5 mm of the true one", () => {
    const h = homographyOf(KIRBY_LIKE.corners);
    const corrected = computeCorrectedHandMeasurements(
      KIRBY_LIKE.landmarksPx,
      h,
      {
        exifFocalPx: null,
        widthPx: FRAME.width,
        heightPx: FRAME.height,
        nominalFocalPx: F17_PRIOR,
      },
    );
    expect(corrected.focalSource).toBe("homography");
    expect(corrected.fPx).toBeCloseTo(894, 0);
    const guarded = guardCorrection(
      corrected,
      KIRBY_LIKE.landmarksPx,
      h,
      PRINCIPAL,
    );
    expect(guarded.refusal).toBeNull();
    expect(guarded.corrected).toBe(corrected);
    expect(
      Math.abs(
        corrected.measurements.handLengthMm - KIRBY_LIKE.trueHandLengthMm,
      ),
    ).toBeLessThan(0.5);
  });

  it("finishPaperEdge on the same frame with its own prior: corrected, no refusal", async () => {
    const quad: SheetQuadDetection = {
      corners: KIRBY_LIKE.corners as SheetQuadDetection["corners"],
      cornersSeen: 4,
      cornersFound: [true, true, true, true],
      partialCorners:
        KIRBY_LIKE.corners as SheetQuadDetection["partialCorners"],
      minSideCoverage: 1,
      edgeFitResidualPx: 0.2,
      worstSideIndex: 0,
      paperRegionFound: true,
    };
    const out = await finishPaperEdge({
      quad,
      paperEval: evaluatePaperEdgeCalibration(quad, "a4", false),
      paperSize: "a4",
      hand: {
        landmarksPx: KIRBY_LIKE.landmarksPx,
        handedness: "right",
        confidence: 0.95,
      },
      request: { hand: "right", handExplicit: true },
      laplacianVariance: 150,
      decoded: FRAME,
      crop: null,
      readJpegBytes: async () => null,
      focalReferenceLongEdgePx: Math.max(FRAME.width, FRAME.height),
    });
    expect(out.parallaxGuard).toBeNull();
    expect(out.parallaxCorrected).toBe(true);
    expect(out.focal?.source).toBe("homography");
  });

  // Kirby's estimates as the true lens, 15-40 deg in four directions, 380 mm:
  // probe of 2026-10-23 (80 in-frame scenes, 模擬): 0 refused under 998 px
  // (largest reported error 6.6 mm, mean 1.2 mm) against 51 refused under
  // 1442 px (corrections there up to 30.7 mm off before the guard).
  for (const f of [894, 1000.8, 1153])
    for (const tiltDeg of [25, 40])
      for (const azimuthDeg of [-90, -80, 0, 90])
        it(`true focal ${f} px, ${tiltDeg} deg, azimuth ${azimuthDeg}: no refusal under the F17 prior`, () => {
          const scene = buildObliqueScene({
            ...FRAME,
            fPx: f,
            tiltDeg,
            azimuthDeg,
            distanceMm: 380,
            handScale: 0.95,
          });
          expect(inFrame(scene.corners)).toBe(true);
          const h = homographyOf(scene.corners);
          const corrected = computeCorrectedHandMeasurements(
            scene.landmarksPx,
            h,
            {
              exifFocalPx: null,
              widthPx: FRAME.width,
              heightPx: FRAME.height,
              nominalFocalPx: F17_PRIOR,
            },
          );
          expect(corrected.parallaxCorrected).toBe(true);
          const guarded = guardCorrection(
            corrected,
            scene.landmarksPx,
            h,
            PRINCIPAL,
          );
          expect(guarded.refusal).toBeNull();
          expect(
            Math.abs(
              corrected.measurements.handLengthMm - scene.trueHandLengthMm,
            ),
          ).toBeLessThan(6.7);
        });
});
