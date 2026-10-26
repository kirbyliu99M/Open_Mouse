/**
 * V3.3 WP1b: `finishPaperEdge` reports the placement record beside the
 * result, never in it. The same scan with or without MediaPipe's world
 * landmarks and z gives byte-for-byte the same result, parallax flag, focal
 * record and shadow; the record is read off the points the measurement used.
 * All numbers SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import type { SheetQuadDetection } from "../../src/client/paper/detect";
import {
  finishPaperEdge,
  type PaperEdgeFinishInput,
} from "../../src/client/photo/paperEdgeFinish";
import { nominalFocalPxFromLongEdge } from "../../src/client/geometry/nominalFocalShadow";
import { computeHandPlacement } from "../../src/client/photo/handPlacement";
import { correctLandmarks } from "../../src/client/geometry/parallax";
import { computeCorrectedHandMeasurements } from "../../src/client/geometry/measurements";
import { centrePrincipalPoint } from "../../src/client/geometry/camera-pose";
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
    readJpegBytes: async () => null,
    focalReferenceLongEdgePx: FRAME.height,
    ...over,
  };
}

const WORLD = Array.from({ length: 21 }, (_, i) => ({
  x: 0.004 * (i % 5),
  y: -0.009 * Math.floor(i / 5) - 0.001 * i,
  z: 0.0002 * i,
}));

describe("finishPaperEdge placement record", () => {
  it("does not change the result: same bytes with and without world landmarks and z", async () => {
    const plain = await finishPaperEdge(input());
    const withWorld = await finishPaperEdge(
      input({
        hand: {
          landmarksPx: scene.landmarksPx,
          handedness: "right",
          confidence: 0.95,
          worldLandmarks: WORLD,
          landmarkZ: Array.from({ length: 21 }, (_, i) => -0.001 * i),
        },
      }),
    );
    expect(JSON.stringify(withWorld.result)).toBe(JSON.stringify(plain.result));
    expect(withWorld.parallaxCorrected).toBe(plain.parallaxCorrected);
    expect(withWorld.focal).toStrictEqual(plain.focal);
    expect(withWorld.shadowPrior).toStrictEqual(plain.shadowPrior);
    expect(withWorld.parallaxGuard).toStrictEqual(plain.parallaxGuard);
    expect(plain.placement?.world.planarityRmsMm).toBeNull();
    expect(withWorld.placement?.world.planarityRmsMm).not.toBeNull();
    expect(withWorld.placement?.zWristMinusMcp).not.toBeNull();
  });

  it("is read off the measurement's own corrected points", async () => {
    const f = await finishPaperEdge(input());
    expect(f.result.status).toBe("ok");
    expect(f.parallaxCorrected).toBe(true);
    const p = f.placement!;
    expect(p.corrected).toBe(true);
    // Recompute what the measurement did: its focal length, the analysed
    // frame's centre, and the heights of the hand length it settled on.
    const fPx = f.focal!.px!;
    expect(fPx).toBeGreaterThan(0);
    const homography = input().paperEval.geometry!.homography;
    const again = computeCorrectedHandMeasurements(
      scene.landmarksPx,
      homography,
      { exifFocalPx: fPx, widthPx: FRAME.width, heightPx: FRAME.height },
    );
    expect(again.measurements).toStrictEqual(
      f.result.status === "ok" ? f.result.measurements : null,
    );
    const points = correctLandmarks(
      scene.landmarksPx,
      homography,
      { fPx, ...centrePrincipalPoint(FRAME.width, FRAME.height) },
      again.heightsMm!,
    );
    expect(p.placement).toStrictEqual(computeHandPlacement(points, "a4"));
    expect(p.camDistMm!).toBeGreaterThan(300);
    expect(p.frameEdge).not.toBeNull();
    // The landmarks themselves were not touched.
    expect(f.result.overlay.landmarksPx).toStrictEqual(scene.landmarksPx);
  });

  it("is absent where the run did not end in a measurement", async () => {
    const f = await finishPaperEdge(
      input({ hand: { landmarksPx: [], handedness: null, confidence: 0.1 } }),
    );
    expect(f.result.status).toBe("error");
    expect(f.placement ?? null).toBeNull();
  });
});
