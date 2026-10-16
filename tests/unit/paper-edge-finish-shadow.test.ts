/**
 * Shadow mode must be invisible to the person: the same scan with the shadow
 * computation on, off, throwing or answering nonsense gives byte-for-byte the
 * same measurements, submission, warnings, overlay, parallax flag and focal
 * record. Drives the real `finishPaperEdge` on a pinhole scene whose true
 * numbers are known (tests/unit/helpers/shadow-scene.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import type { SheetQuadDetection } from "../../src/client/paper/detect";
import {
  finishPaperEdge,
  type PaperEdgeFinishInput,
} from "../../src/client/photo/paperEdgeFinish";
import { computeNominalFocalShadow } from "../../src/client/geometry/nominalFocalShadow";
import { buildExifJpeg, TAG } from "./helpers/exif-jpeg";
import { buildShadowScene } from "./helpers/shadow-scene";

const FRAME = { width: 1080, height: 1440 };

const scene = buildShadowScene({
  width: FRAME.width,
  height: FRAME.height,
  fPx: (26 / 43.27) * Math.hypot(FRAME.width, FRAME.height),
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
    { tag: TAG.focalLengthIn35mmFilm, value: { type: "short", value: 26 } },
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
    // A frame of the live video has no EXIF.
    readJpegBytes: async () => null,
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
  it("the frame path (no EXIF): the scan is measured without parallax correction and the shadow says by how much it would differ", async () => {
    const on = await finishPaperEdge(input());
    expect(on.result.status).toBe("ok");
    expect(on.parallaxCorrected).toBe(false);
    expect(on.focal).toEqual({ source: "none", px: null });
    expect(on.shadowPrior).not.toBeNull();
    const delta = on.shadowPrior!.handLengthDeltaMm!;
    // The audit's simulation: a hand about 6 mm long without the correction.
    expect(delta).toBeLessThan(-5);
    expect(delta).toBeGreaterThan(-7);
    if (on.result.status !== "ok") throw new Error("not ok");
    // The shadow is the 190 mm hand the scene was built from.
    expect(on.result.measurements.handLengthMm + delta).toBeCloseTo(
      scene.trueHandLengthMm,
      1,
    );
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
    // The EXIF here is the same 26 mm as the prior: the two agree.
    expect(on.shadowPrior!.handLengthDeltaMm!).toBeCloseTo(0, 1);
  });

  it("a shadow computation that throws changes nothing", async () => {
    const off = await finishPaperEdge(input({ shadowPrior: false }));
    const boom = vi.fn(() => {
      throw new Error("shadow exploded");
    });
    const thrown = await finishPaperEdge(input({ computeShadow: boom }));
    expect(boom).toHaveBeenCalledTimes(1);
    expect(thrown.shadowPrior).toEqual({ handLengthDeltaMm: null });
    expect(visible(thrown)).toEqual(visible(off));
  });

  it.each([
    ["null", () => null],
    ["NaN", () => ({ shadowHandLengthMm: 1, handLengthDeltaMm: Number.NaN })],
    [
      "Infinity",
      () => ({ shadowHandLengthMm: 1, handLengthDeltaMm: Infinity }),
    ],
    ["not an object", () => 42 as never],
  ])(
    "a shadow answer of %s becomes a null delta and changes nothing",
    async (_name, answer) => {
      const off = await finishPaperEdge(input({ shadowPrior: false }));
      const got = await finishPaperEdge(
        input({ computeShadow: answer as typeof computeNominalFocalShadow }),
      );
      expect(got.shadowPrior).toEqual({ handLengthDeltaMm: null });
      expect(visible(got)).toEqual(visible(off));
    },
  );

  it("is handed the whole photo's size for the prior and the analysed image's size for the principal point, and the shown hand length", async () => {
    const seen = vi.fn(computeNominalFocalShadow);
    const cropped = await finishPaperEdge(
      input({
        decoded: { width: 1500, height: 2000 },
        crop: { x: 210, y: 0, width: 1080, height: 2000 },
        computeShadow: seen,
      }),
    );
    expect(seen).toHaveBeenCalledTimes(1);
    const arg = seen.mock.calls[0][0];
    expect(arg.focalFrame).toEqual({ width: 1500, height: 2000 });
    expect(arg.principalFrame).toEqual({ width: 1080, height: 2000 });
    expect(arg.landmarksPx).toEqual(scene.landmarksPx);
    expect(arg.landmarksPx).not.toBe(scene.landmarksPx);
    if (cropped.result.status !== "ok") throw new Error("not ok");
    expect(arg.reportedHandLengthMm).toBe(
      cropped.result.measurements.handLengthMm,
    );
  });

  it("a shadow that scribbles on its input leaves the scan's points alone", async () => {
    const before = JSON.stringify(scene.landmarksPx);
    const off = await finishPaperEdge(input({ shadowPrior: false }));
    const scribbler = ((arg: { landmarksPx: { x: number; y: number }[] }) => {
      arg.landmarksPx[3].x = 1;
      arg.landmarksPx.length = 0;
      return null;
    }) as unknown as typeof computeNominalFocalShadow;
    const got = await finishPaperEdge(input({ computeShadow: scribbler }));
    expect(JSON.stringify(scene.landmarksPx)).toBe(before);
    expect(visible(got)).toEqual(visible(off));
  });

  it("runs only for a measured scan: no shadow where the run ended in an error", async () => {
    const seen = vi.fn(computeNominalFocalShadow);
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
