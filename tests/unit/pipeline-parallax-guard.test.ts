/**
 * V3.2 F16 (candidate, 未拍板): the parallax guard's refusal, end to end. The
 * REAL `runPhotoPipeline` (paper-edge) on the 185.7 -> 205.4 mm situation of
 * tests/unit/parallax-guard.test.ts, on the automatic path and on a frame
 * placed by hand (`manualPaperCorners`, the path Kirby's failing scan took),
 * and then into the local attempt log (`buildAttemptRecord`): the refusal's
 * reason must reach the log on both paths, or the next measured scan cannot
 * say why it was measured uncorrected. Only the browser-bound inputs are faked
 * (the decoded bitmap, MediaPipe, the paper detector and the canvas), as in
 * pipeline-manual-corners.test.ts. Every scene is SIMULATED (模擬).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/photo/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/photo/decode")>()),
  decodePhoto: vi.fn(),
}));
vi.mock("../../src/client/photo/landmarks", () => ({
  detectHandLandmarks: vi.fn(),
}));
vi.mock("../../src/client/paper/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/paper/detect")>()),
  detectPaperQuad: vi.fn(),
}));

import { decodePhoto } from "../../src/client/photo/decode";
import { detectHandLandmarks } from "../../src/client/photo/landmarks";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  runPhotoPipeline,
  type PipelineResult,
  type RunPhotoPipelineInput,
} from "../../src/client/photo/pipeline";
import { buildAttemptRecord } from "../../src/client/camera/attemptLog";
import { buildScanQuality } from "../../src/client/analytics/scanQuality";
import { nominalFocalPxFromLongEdge } from "../../src/client/geometry/nominalFocalShadow";
import type { Quad4 } from "../../src/client/paper/manualQuad";
import { buildObliqueScene } from "./helpers/oblique-scene";
import { buildShadowScene } from "./helpers/shadow-scene";

const FRAME = { width: 1080, height: 1920 };
const NOMINAL = nominalFocalPxFromLongEdge(FRAME.height)!;

/** tests/unit/parallax-guard.test.ts's KIRBY_LIKE (模擬): an 894 px camera tilted 25 degrees back, measured with the nominal 1442 px. */
const KIRBY_LIKE = buildObliqueScene({
  width: FRAME.width,
  height: FRAME.height,
  fPx: 894,
  tiltDeg: 25,
  azimuthDeg: -80,
  distanceMm: 380,
  handScale: 0.95,
});

/** A normal scan (模擬): the nominal camera, 5 degrees off overhead. */
const NORMAL = buildShadowScene({
  width: FRAME.width,
  height: FRAME.height,
  fPx: NOMINAL,
  tiltDeg: 5,
  cameraHeightMm: 420,
});

function arrange(scene: {
  corners: readonly { x: number; y: number }[];
  landmarksPx: readonly { x: number; y: number }[];
}) {
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    width: FRAME.width,
    height: FRAME.height,
  });
  const corners = scene.corners as unknown as Quad4;
  vi.mocked(detectPaperQuad).mockReturnValue({
    corners,
    cornersSeen: 4,
    cornersFound: [true, true, true, true],
    partialCorners: corners,
    minSideCoverage: 1,
    edgeFitResidualPx: 0.3,
    worstSideIndex: 0,
    paperRegionFound: true,
  });
  vi.mocked(detectHandLandmarks).mockResolvedValue({
    landmarksPx: [...scene.landmarksPx],
    handedness: "right",
    confidence: 0.95,
  });
}

function run(extra: Partial<RunPhotoPipelineInput> = {}) {
  return runPhotoPipeline({
    file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "c.jpg", {
      type: "image/jpeg",
    }),
    hand: "right",
    handExplicit: true,
    calibration: { method: "paper-edge", paperSize: "a4" },
    ...extra,
  });
}

function ok(result: PipelineResult) {
  expect(result.status, JSON.stringify(result)).toBe("ok");
  if (result.status !== "ok") throw new Error("not ok");
  return result;
}

const record = (result: PipelineResult) =>
  buildAttemptRecord({
    at: "2026-10-23T00:00:00.000Z",
    userAgent: "test",
    capture: {
      method: "canvas",
      photoWidth: FRAME.width,
      photoHeight: FRAME.height,
      photoKb: 900,
      previewWidth: null,
      previewHeight: null,
    },
    outcome: { kind: "result", result },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(128),
          width: w,
          height: h,
        }),
      }),
    }),
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      throw new Error("not cropped");
    }),
  );
});

const PATHS = [
  ["the automatic path", {}],
  [
    "a frame placed by hand",
    {
      manualPaperCorners: {
        corners: KIRBY_LIKE.corners as unknown as Quad4,
        source: "manual" as const,
      },
    },
  ],
] as const;

describe("a refused correction reaches the diagnostics and the attempt log (模擬)", () => {
  for (const [name, extra] of PATHS) {
    it(`${name}: measured uncorrected, the refusal in result.diagnostics and in the attempt record`, async () => {
      arrange(KIRBY_LIKE);
      const r = ok(await run(extra));
      if ("manualPaperCorners" in extra)
        expect(detectPaperQuad).not.toHaveBeenCalled();
      expect(r.diagnostics?.parallaxCorrected).toBe(false);
      expect(r.diagnostics?.focal).toEqual({ source: "none", px: null });
      expect(r.diagnostics?.parallaxGuard).toMatchObject({
        refused: true,
        reason: "lengthened",
        field: "handLength",
        refusedFocal: { source: "nominal" },
      });
      expect(r.diagnostics?.parallaxGuard?.refusedFocal.px).toBeCloseTo(
        NOMINAL,
        6,
      );
      expect(r.diagnostics?.parallaxGuard?.ratios.handLength).toBeLessThan(
        0.93,
      );
      // About the true hand, not 16 mm over it.
      expect(
        Math.abs(r.measurements.handLengthMm - KIRBY_LIKE.trueHandLengthMm),
      ).toBeLessThan(1);
      const log = record(r);
      expect(log.parallaxGuard).not.toBeNull();
      expect(log.parallaxGuard).toMatchObject({
        reason: "lengthened",
        field: "handLength",
        refusedFocal: { source: "nominal", px: Math.round(NOMINAL) },
      });
      expect(log.parallaxGuard!.ratios.handLength).toBeLessThan(0.93);
      expect(log.parallaxCorrected).toBe(false);
    });
  }

  it("a normal scan: nothing refused, null in the diagnostics and in the log, still corrected", async () => {
    arrange(NORMAL);
    const r = ok(await run());
    expect(r.diagnostics?.parallaxCorrected).toBe(true);
    expect(r.diagnostics?.parallaxGuard).toBeNull();
    expect(record(r).parallaxGuard).toBeNull();
  });

  it("known gap (未拍板, for Claude): scan_quality sends a refused correction as focalSource none, parallaxCorrected false, priorEffect within_2", async () => {
    arrange(KIRBY_LIKE);
    const r = ok(await run());
    const q = buildScanQuality({
      flow: "easy",
      attempt: 1,
      method: "canvas",
      diagnostics: r.diagnostics,
    });
    expect(q).toMatchObject({
      focalSource: "none",
      parallaxCorrected: false,
      priorEffect: "within_2",
    });
  });
});
