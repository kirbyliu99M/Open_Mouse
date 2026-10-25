/**
 * Shadow mode must be invisible to the person: the same scan with the shadow
 * computation on, off, throwing or answering nonsense gives byte-for-byte the
 * same measurements, submission, warnings, overlay, parallax flag and focal
 * record. Drives the real `finishPaperEdge` on a pinhole scene whose true
 * numbers are known (tests/unit/helpers/shadow-scene.ts).
 *
 * Since landmark-raw-v3 (V3.2 candidate, design R7) the nominal prior is the
 * correction of a photo with nothing better, and the shadow is turned round:
 * the UNCORRECTED lengths beside the reported ones (`computeUncorrectedShadow`).
 * All numbers SIMULATED (模擬).
 */
import { describe, expect, it, vi } from "vitest";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import type { SheetQuadDetection } from "../../src/client/paper/detect";
import {
  finishPaperEdge,
  type PaperEdgeFinishInput,
} from "../../src/client/photo/paperEdgeFinish";
import {
  computeUncorrectedShadow,
  NOMINAL_FOCAL_EQUIV_MM_STILL,
  nominalFocalPxFromLongEdge,
} from "../../src/client/geometry/nominalFocalShadow";
import { centrePrincipalPoint } from "../../src/client/geometry/camera-pose";
import { estimateFocalFromHomography } from "../../src/client/geometry/focal-from-homography";
import { FOCAL_PRIOR_RANGE } from "../../src/client/geometry/parallax";
import { buildExifJpeg, TAG } from "./helpers/exif-jpeg";
import { buildR6Scene } from "./helpers/r6-scene";
import { buildShadowScene } from "./helpers/shadow-scene";

const FRAME = { width: 1080, height: 1440 };

const scene = buildShadowScene({
  width: FRAME.width,
  height: FRAME.height,
  fPx: nominalFocalPxFromLongEdge(FRAME.height)!,
  tiltDeg: 8,
  cameraHeightMm: 420,
  offsetMm: { x: 10, y: -20 },
});

const quad: SheetQuadDetection = {
  corners: scene.corners,
  cornersSeen: 4,
  cornersFound: [true, true, true, true],
  partialCorners: scene.corners,
  minSideCoverage: 1,
  edgeFitResidualPx: 0.2,
  worstSideIndex: 0,
  paperRegionFound: true,
};

const JPEG_WITH_EXIF = buildExifJpeg({
  exif: [
    // The scene's own lens (the prior's 35 mm equivalent since F17).
    { tag: TAG.focalLengthIn35mmFilm, value: { type: "short", value: 18 } },
  ],
});

function input(over: Partial<PaperEdgeFinishInput> = {}): PaperEdgeFinishInput {
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
    // A frame of the live video has no EXIF, and the camera passes the
    // stream's long edge (here the frame's own), which gives it the video
    // frame's 18 mm prior (F17 review).
    readJpegBytes: async () => null,
    focalReferenceLongEdgePx: FRAME.height,
    ...over,
  };
}

/** Everything the person, the server and the log's measured fields can see. */
function visible(f: Awaited<ReturnType<typeof finishPaperEdge>>) {
  const { shadowPrior: _shadowPrior, ...rest } = f;
  void _shadowPrior;
  return rest;
}

describe("finishPaperEdge shadow mode", () => {
  it("the frame path (no EXIF): since v3 the scan is corrected (nominal prior, or a homography estimate inside its range) and the shadow says how long the uncorrected one reads", async () => {
    const on = await finishPaperEdge(input());
    expect(on.result.status).toBe("ok");
    expect(on.parallaxCorrected).toBe(true);
    expect(["nominal", "homography"]).toContain(on.focal?.source);
    expect(on.shadowPrior).not.toBeNull();
    if (on.result.status !== "ok") throw new Error("not ok");
    // The prior here is the scene's true focal length (a 4 : 3 frame): the
    // corrected hand is the 190 mm hand the scene was built from.
    expect(on.result.measurements.handLengthMm).toBeCloseTo(
      scene.trueHandLengthMm,
      0,
    );
    const delta = on.shadowPrior!.handLengthDeltaMm!;
    // The audit's simulation: about 6 mm long without the correction.
    expect(delta).toBeGreaterThan(5);
    expect(delta).toBeLessThan(7);
    expect(on.shadowPrior!.uncorrected!.handLengthMm).toBeCloseTo(
      on.result.measurements.handLengthMm + delta,
      9,
    );
    expect(on.shadowPrior!.reported).toEqual({
      handLengthMm: on.result.measurements.handLengthMm,
      palmLengthMm: on.result.measurements.palmLengthMm,
      palmWidthMm: on.result.measurements.palmWidthMm,
    });
    expect(on.result.submission.calibration).toMatchObject({
      parallaxCorrected: true,
      focalSource: on.focal?.source,
    });
  });

  it("the prior is taken on the whole decoded photo's long edge, or on the long edge the caller passes", async () => {
    const own = await finishPaperEdge(input());
    if (own.focal?.source === "nominal") {
      expect(own.focal.px).toBe(nominalFocalPxFromLongEdge(FRAME.height));
    }
    // A long edge far off the truth (the stream's of a frame cut on its long
    // side, say): the prior moves with it, unless a homography estimate
    // inside the range wins.
    const passed = await finishPaperEdge(
      input({ focalReferenceLongEdgePx: 1920 }),
    );
    expect(["nominal", "homography"]).toContain(passed.focal?.source);
    if (passed.focal?.source === "nominal") {
      expect(passed.focal.px).toBe(nominalFocalPxFromLongEdge(1920));
    }
    // Not passed: a still (an upload with no EXIF), the still lens (26 mm)
    // on the decoded photo's own long edge (F17 review).
    const still = await finishPaperEdge(
      input({ focalReferenceLongEdgePx: undefined }),
    );
    expect(["nominal", "homography"]).toContain(still.focal?.source);
    if (still.focal?.source === "nominal") {
      expect(still.focal.px).toBe(
        nominalFocalPxFromLongEdge(FRAME.height, NOMINAL_FOCAL_EQUIV_MM_STILL),
      );
    }
  });

  it("on and off give the same measurements, submission, warnings, overlay, parallax flag and focal (deep equality)", async () => {
    const on = await finishPaperEdge(input());
    const off = await finishPaperEdge(input({ shadowPrior: false }));
    expect(off.shadowPrior).toBeNull();
    expect(on.shadowPrior).not.toBeNull();
    expect(visible(on)).toEqual(visible(off));
    // Field by field, the ones the brief names.
    if (on.result.status !== "ok" || off.result.status !== "ok")
      throw new Error("not ok");
    expect(on.result.measurements).toEqual(off.result.measurements);
    expect(on.result.submission).toEqual(off.result.submission);
    expect(on.parallaxCorrected).toBe(off.parallaxCorrected);
    expect(on.focal).toEqual(off.focal);
    expect(JSON.stringify(visible(on))).toBe(JSON.stringify(visible(off)));
  });

  it("with an EXIF focal length too (the correction runs; the shadow still leaves it alone)", async () => {
    const withExif = input({ readJpegBytes: async () => JPEG_WITH_EXIF });
    const on = await finishPaperEdge(withExif);
    const off = await finishPaperEdge({ ...withExif, shadowPrior: false });
    expect(on.parallaxCorrected).toBe(true);
    expect(on.focal?.source).toBe("exif");
    expect(visible(on)).toEqual(visible(off));
    // Uncorrected minus reported: the same ~6 mm as the frame path.
    expect(on.shadowPrior!.handLengthDeltaMm!).toBeGreaterThan(5);
    expect(on.shadowPrior!.handLengthDeltaMm!).toBeLessThan(7);
  });

  it("a shadow computation that throws changes nothing", async () => {
    const off = await finishPaperEdge(input({ shadowPrior: false }));
    const boom = vi.fn(() => {
      throw new Error("shadow exploded");
    });
    const thrown = await finishPaperEdge(input({ computeShadow: boom }));
    expect(boom).toHaveBeenCalledTimes(1);
    expect(thrown.shadowPrior).toEqual({
      handLengthDeltaMm: null,
      uncorrected: null,
      reported: null,
      homographyFocal: null,
    });
    expect(visible(thrown)).toEqual(visible(off));
  });

  it.each([
    ["null", () => null],
    [
      "NaN",
      () => ({
        uncorrected: {
          handLengthMm: Number.NaN,
          palmLengthMm: 1,
          palmWidthMm: 1,
        },
        handLengthDeltaMm: Number.NaN,
        homographyFocal: { px: Number.NaN, reliable: true },
      }),
    ],
    [
      "Infinity",
      () => ({
        uncorrected: {
          handLengthMm: Infinity,
          palmLengthMm: 1,
          palmWidthMm: 1,
        },
        handLengthDeltaMm: Infinity,
        homographyFocal: null,
      }),
    ],
    ["not an object", () => 42 as never],
  ])(
    "a shadow answer of %s becomes a null delta and changes nothing",
    async (_name, answer) => {
      const off = await finishPaperEdge(input({ shadowPrior: false }));
      const got = await finishPaperEdge(
        input({ computeShadow: answer as typeof computeUncorrectedShadow }),
      );
      expect(got.shadowPrior?.handLengthDeltaMm).toBeNull();
      expect(got.shadowPrior?.uncorrected).toBeNull();
      expect(got.shadowPrior?.homographyFocal).toBeNull();
      expect(visible(got)).toEqual(visible(off));
    },
  );

  it("is handed the analysed image's size for the principal point, copies of the landmarks and the reported lengths", async () => {
    const seen = vi.fn(computeUncorrectedShadow);
    const cropped = await finishPaperEdge(
      input({
        decoded: { width: 1500, height: 2000 },
        crop: { x: 210, y: 0, width: 1080, height: 2000 },
        computeShadow: seen,
        // A cropped still (the camera's takePhoto picture): no stream edge.
        focalReferenceLongEdgePx: undefined,
      }),
    );
    expect(seen).toHaveBeenCalledTimes(1);
    const arg = seen.mock.calls[0][0];
    expect(arg.principalFrame).toEqual({ width: 1080, height: 2000 });
    expect(arg.landmarksPx).toEqual(scene.landmarksPx);
    expect(arg.landmarksPx).not.toBe(scene.landmarksPx);
    if (cropped.result.status !== "ok") throw new Error("not ok");
    expect(arg.reported).toEqual({
      handLengthMm: cropped.result.measurements.handLengthMm,
      palmLengthMm: cropped.result.measurements.palmLengthMm,
      palmWidthMm: cropped.result.measurements.palmWidthMm,
    });
    // The prior is the whole decoded photo's (2000 px long edge), not the
    // crop's, at the still lens (F17 review).
    if (cropped.focal?.source === "nominal") {
      expect(cropped.focal.px).toBe(
        nominalFocalPxFromLongEdge(2000, NOMINAL_FOCAL_EQUIV_MM_STILL),
      );
    }
  });

  it("a shadow that scribbles on its input leaves the scan's points alone", async () => {
    const before = JSON.stringify(scene.landmarksPx);
    const off = await finishPaperEdge(input({ shadowPrior: false }));
    const scribbler = ((arg: { landmarksPx: { x: number; y: number }[] }) => {
      arg.landmarksPx[3].x = 1;
      arg.landmarksPx.length = 0;
      return null;
    }) as unknown as typeof computeUncorrectedShadow;
    const got = await finishPaperEdge(input({ computeShadow: scribbler }));
    expect(JSON.stringify(scene.landmarksPx)).toBe(before);
    expect(visible(got)).toEqual(visible(off));
  });

  it("runs only for a measured scan: no shadow where the run ended in an error", async () => {
    const seen = vi.fn(computeUncorrectedShadow);
    const failed = await finishPaperEdge(
      input({
        hand: {
          landmarksPx: scene.landmarksPx,
          handedness: "right",
          confidence: 0.05,
        },
        computeShadow: seen,
      }),
    );
    expect(failed.result.status).toBe("error");
    expect(failed.shadowPrior).toBeNull();
    expect(seen).not.toHaveBeenCalled();
  });
});

/**
 * The homography's own focal estimate is local evidence for design §5.3(b):
 * the stream's true focal length is read off the attempt log of the step-3
 * scans tilted about 15°. So the real `finishPaperEdge` must record the
 * estimate it made, used or not. All numbers SIMULATED (模擬).
 */
describe("finishPaperEdge records the homography focal estimate", () => {
  const TRUE_F = nominalFocalPxFromLongEdge(FRAME.height)!;
  // Pitch 15° (the step-3 tilt) plus a 4° roll: a tilt about one sheet axis
  // alone leaves h31 = 0 and the estimate is never judged reliable.
  const tilted = buildR6Scene({
    w: FRAME.width,
    h: FRAME.height,
    f: TRUE_F,
    pitchDeg: 15,
    rollDeg: 4,
  });
  const tiltedQuad: SheetQuadDetection = {
    ...quad,
    corners: tilted.corners,
    partialCorners: tilted.corners,
  };
  const tiltedEval = evaluatePaperEdgeCalibration(tiltedQuad, "a4", false);
  const tiltedInput = (
    over: Partial<PaperEdgeFinishInput> = {},
  ): PaperEdgeFinishInput =>
    input({
      quad: tiltedQuad,
      paperEval: tiltedEval,
      hand: {
        landmarksPx: [...tilted.raisedPx],
        handedness: "right",
        confidence: 0.95,
      },
      ...over,
    });
  // What the shadow should have computed: the same homography, the analysed
  // image's centre as the principal point.
  const expected = () => {
    const h = tiltedEval.geometry?.homography;
    if (!h) throw new Error("no homography");
    const e = estimateFocalFromHomography(
      h,
      centrePrincipalPoint(FRAME.width, FRAME.height),
    );
    if (!e) throw new Error("no estimate");
    return e;
  };

  it("a 15° tilt: the estimate is reliable, is used, and the log carries the same {px, reliable}", async () => {
    const e = expected();
    // Preconditions of the scene: reliable, near the truth.
    expect(e.reliable).toBe(true);
    expect(Math.abs(e.fPx / TRUE_F - 1)).toBeLessThan(0.05);
    const got = await finishPaperEdge(tiltedInput());
    expect(got.result.status).toBe("ok");
    expect(got.focal?.source).toBe("homography");
    expect(got.shadowPrior?.homographyFocal).not.toBeNull();
    expect(got.shadowPrior?.homographyFocal).toEqual({
      px: e.fPx,
      reliable: true,
    });
  });

  it("a reliable estimate that the range check turns down (the nominal prior is used) is recorded all the same", async () => {
    const e = expected();
    expect(e.reliable).toBe(true);
    // A long edge that puts the prior far above the estimate, out of range.
    const longEdge = 4000;
    const prior = nominalFocalPxFromLongEdge(longEdge);
    if (prior === null) throw new Error("no prior");
    expect(e.fPx / prior).toBeLessThan(FOCAL_PRIOR_RANGE.min);
    const got = await finishPaperEdge(
      tiltedInput({ focalReferenceLongEdgePx: longEdge }),
    );
    expect(got.result.status).toBe("ok");
    // V3.2 F16: a prior twice the focal length the homography agrees with, on
    // a 15° tilt, is the failing situation of Kirby's preview-6 scan; the
    // safety check refuses that correction (tests/unit/parallax-guard.test.ts)
    // and the log keeps which prior it was.
    expect(got.parallaxGuard).toMatchObject({
      refused: true,
      refusedFocal: { source: "nominal", px: prior },
    });
    expect(got.focal).toEqual({ source: "none", px: null });
    expect(got.shadowPrior?.homographyFocal).toEqual({
      px: e.fPx,
      reliable: true,
    });
  });
});
