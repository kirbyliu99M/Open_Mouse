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
  it("the named limits: 0.99 for the two lengths, 0.985 for the width, 1.10 for all three", () => {
    expect(PARALLAX_GUARD).toEqual({
      minLengthRatio: 0.99,
      minWidthRatio: 0.985,
      maxRatio: 1.1,
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
const NOMINAL = nominalFocalPxFromLongEdge(FRAME.height)!;
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
    const guarded = guardCorrection(corrected, KIRBY_LIKE.landmarksPx, h);
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
        const guarded = guardCorrection(corrected, scene.landmarksPx, h);
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
    const guarded = guardCorrection(uncorrected, scene.landmarksPx, h);
    expect(guarded.corrected).toBe(uncorrected);
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
      ...over,
    };
  }

  it("the failing frame: measured uncorrected, submitted parallaxCorrected false / focalSource none, refusal kept for the log", async () => {
    const out = await finishPaperEdge(input(KIRBY_LIKE));
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
