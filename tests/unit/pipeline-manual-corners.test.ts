/**
 * V3.2 F2 (candidate): the REAL `runPhotoPipeline` (paper-edge) with a frame
 * the person placed (`manualPaperCorners`). Only the browser-bound inputs are
 * faked (the decoded bitmap, `createImageBitmap`, MediaPipe, the paper detector
 * and the canvas), as in pipeline-view-crop.test.ts; the frame's checks, the
 * labelling, the homography, the hand gates, the measurements and the
 * submission are the shipped code. Every scene is SIMULATED (模擬).
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
import { visibleRectInStream } from "../../src/client/camera/visibleView";
import { buildAttemptRecord } from "../../src/client/camera/attemptLog";
import {
  buildScanQuality,
  buildScanRejected,
} from "../../src/client/analytics/scanQuality";
import { scanSubmissionSchema } from "../../src/lib/contracts/measurement";
import type { Quad4 } from "../../src/client/paper/manualQuad";

const DECODED = { width: 2250, height: 3000 };
const STREAM = { width: 1080, height: 1440 };
const PHONE = { width: 390, height: 844 };
const CROP = { x: 432, y: 0, width: 1386, height: 3000 };

const S = 5.9; // px per mm in the whole photo
const PAPER_X0 = 520;
const PAPER_Y0 = 250;
const A4 = { width: 210, height: 297 };
const PAPER_FULL: Quad4 = [
  { x: PAPER_X0, y: PAPER_Y0 },
  { x: PAPER_X0 + A4.width * S, y: PAPER_Y0 },
  { x: PAPER_X0 + A4.width * S, y: PAPER_Y0 + A4.height * S },
  { x: PAPER_X0, y: PAPER_Y0 + A4.height * S },
];
const HAND_MM = [
  [100, 0],
  [85, 20],
  [70, 45],
  [55, 65],
  [45, 85],
  [80, 100],
  [75, 135],
  [65, 150],
  [55, 145],
  [100, 105],
  [100, 140],
  [100, 165],
  [100, 190],
  [130, 99],
  [131, 133],
  [131, 157],
  [131, 177],
  [160, 98],
  [162, 122],
  [163, 140],
  [163, 155],
];
const HAND_FULL = HAND_MM.map(([x, y]) => ({
  x: PAPER_X0 + (x + 20) * S,
  y: PAPER_Y0 + (y + 40) * S,
}));
const shift = (p: { x: number; y: number }, dx: number, dy: number) => ({
  x: p.x + dx,
  y: p.y + dy,
});

function arrange(crop: { x: number; y: number } | null) {
  const dx = crop ? -crop.x : 0;
  const dy = crop ? -crop.y : 0;
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    width: DECODED.width,
    height: DECODED.height,
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(
      async (...args: unknown[]) =>
        ({
          width: args[3],
          height: args[4],
          close: () => undefined,
        }) as unknown as ImageBitmap,
    ),
  );
  const corners = PAPER_FULL.map((p) => shift(p, dx, dy)) as unknown as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
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
    landmarksPx: HAND_FULL.map((p) => shift(p, dx, dy)),
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
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("not ok");
  return result;
}

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
});

describe("a placed frame through the real pipeline", () => {
  it("does not run the detector, and measures what the detector's same corners measure", async () => {
    arrange(null);
    const auto = ok(await run());
    vi.clearAllMocks();
    arrange(null);
    const manual = ok(
      await run({
        manualPaperCorners: { corners: PAPER_FULL, source: "manual" },
      }),
    );
    expect(detectPaperQuad).not.toHaveBeenCalled();
    expect(manual.measurements).toEqual(auto.measurements);
    expect(manual.overlay.paperCorners).toEqual(auto.overlay.paperCorners);
    expect(manual.measurements.handLengthMm).toBeCloseTo(190, 1);
  });

  it("the submission says where the corners came from and carries no edge numbers", async () => {
    for (const source of ["adjusted", "manual"] as const) {
      arrange(null);
      const r = ok(
        await run({ manualPaperCorners: { corners: PAPER_FULL, source } }),
      );
      expect(r.submission.calibration).toEqual({
        method: "paper-edge",
        paperSize: "a4",
        cornersSource: source,
        parallaxCorrected: expect.any(Boolean),
      });
      expect(scanSubmissionSchema.safeParse(r.submission).success).toBe(true);
    }
  });

  it("the detected path's submission is unchanged: both edge numbers, no cornersSource", async () => {
    arrange(null);
    const r = ok(await run());
    const calibration = r.submission.calibration as Record<string, unknown>;
    expect(calibration).not.toHaveProperty("cornersSource");
    expect(calibration.minSideCoverage).toBe(1);
    expect(typeof calibration.edgeFitResidualMm).toBe("number");
  });

  it("takes the corners in the whole photo's pixels when the photo is cropped to the screen", async () => {
    arrange(null);
    const whole = ok(
      await run({
        manualPaperCorners: { corners: PAPER_FULL, source: "manual" },
      }),
    );
    vi.clearAllMocks();
    arrange(CROP);
    const cropped = ok(
      await run({
        manualPaperCorners: { corners: PAPER_FULL, source: "manual" },
        previewView: {
          stream: STREAM,
          visibleInStream: visibleRectInStream(STREAM, PHONE)!,
        },
      }),
    );
    expect(cropped.overlay.paperCorners).toEqual(whole.overlay.paperCorners);
    expect(cropped.measurements.handLengthMm).toBeCloseTo(
      whole.measurements.handLengthMm,
      6,
    );
  });

  it("labels the frame itself: corners given in another order measure the same", async () => {
    arrange(null);
    const plain = ok(
      await run({
        manualPaperCorners: { corners: PAPER_FULL, source: "manual" },
      }),
    );
    arrange(null);
    const reordered = ok(
      await run({
        manualPaperCorners: {
          corners: [PAPER_FULL[2], PAPER_FULL[1], PAPER_FULL[0], PAPER_FULL[3]],
          source: "manual",
        },
      }),
    );
    expect(reordered.measurements).toEqual(plain.measurements);
  });

  it("runs the same hand gates: a hand far off the placed sheet is turned back", async () => {
    arrange(null);
    // A frame two thirds the size, at the top left: the hand reaches far off it.
    const small: Quad4 = [
      { x: PAPER_X0, y: PAPER_Y0 },
      { x: PAPER_X0 + 700, y: PAPER_Y0 },
      { x: PAPER_X0 + 700, y: PAPER_Y0 + 990 },
      { x: PAPER_X0, y: PAPER_Y0 + 990 },
    ];
    const r = await run({
      manualPaperCorners: { corners: small, source: "manual" },
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.errors.map((e) => e.code)).toContain("HAND_OUT_OF_BOUNDS");
    // The run's record holds the placed corners' angle, but the refused
    // scan's event carries no paper grade: scan_rejected cannot say the
    // corners were placed, and they are not the detector's.
    expect(r.diagnostics!.paper!.maxAngleDeviationDeg).not.toBeNull();
    const rejected = buildScanRejected({
      flow: "easy",
      attempt: 2,
      errors: r.errors,
      diagnostics: r.diagnostics,
    });
    expect(rejected).not.toHaveProperty("paperSkew");
    expect(rejected).not.toHaveProperty("paperCoverage");
    expect(rejected.codes).toContain("HAND_OUT_OF_BOUNDS");
  });

  it("refuses a frame that fails the checks before looking for a hand", async () => {
    arrange(null);
    // The points are ordered round their centre before the checks (so a
    // crossed frame comes out uncrossed); a frame squeezed to a sliver fails.
    const sliver: Quad4 = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 120 },
      { x: 100, y: 120 },
    ];
    const r = await run({
      manualPaperCorners: { corners: sliver, source: "manual" },
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.errors.map((e) => e.code)).toEqual(["PAPER_CORNER_HIDDEN"]);
    expect(detectHandLandmarks).not.toHaveBeenCalled();
  });

  it("the record says the corners were placed and has no edge numbers; no scan_quality event is built", async () => {
    arrange(null);
    const r = ok(
      await run({
        manualPaperCorners: { corners: PAPER_FULL, source: "adjusted" },
      }),
    );
    const paper = r.diagnostics!.paper!;
    expect(paper.cornersSource).toBe("adjusted");
    expect(paper.edgeFitResidualMm).toBeNull();
    expect(paper.minSideCoverage).toBeNull();
    expect(paper.sideCoverages).toBeNull();
    const record = buildAttemptRecord({
      at: "2026-10-21T00:00:00.000Z",
      userAgent: "test",
      capture: {
        method: "canvas",
        photoWidth: 2250,
        photoHeight: 3000,
        photoKb: 900,
        previewWidth: null,
        previewHeight: null,
      },
      outcome: { kind: "result", result: r },
    });
    expect(record.paper!.cornersSource).toBe("adjusted");
    expect(record.paper!.minSideCoverage).toBeNull();
    expect(record.paper!.edgeFitResidualMm).toBeNull();
    expect(
      buildScanQuality({
        flow: "easy",
        attempt: 1,
        method: "canvas",
        diagnostics: r.diagnostics,
      }),
    ).toBeNull();
  });
});

describe("photos never leave the browser", () => {
  it("a run with a placed frame makes no request, and its submission holds no picture", async () => {
    arrange(null);
    const fetchSpy = vi.fn();
    const beacon = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    const r = ok(
      await run({
        manualPaperCorners: { corners: PAPER_FULL, source: "manual" },
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    const body = JSON.stringify(r.submission);
    expect(body).not.toMatch(/blob:|data:|base64|image\//i);
    expect(Object.keys(r.submission).sort()).toEqual([
      "calibration",
      "hand",
      "measurementModelVersion",
      "measurements",
    ]);
    vi.unstubAllGlobals();
  });
});

describe("a sheet found without all four corners", () => {
  it("reports the corners it could work out, in the whole photo's pixels, for the adjustment's start", async () => {
    arrange(CROP);
    const partial = [
      shift(PAPER_FULL[0], -CROP.x, 0),
      null,
      shift(PAPER_FULL[2], -CROP.x, 0),
      shift(PAPER_FULL[3], -CROP.x, 0),
    ];
    vi.mocked(detectPaperQuad).mockReturnValue({
      corners: null,
      cornersSeen: 3,
      cornersFound: [true, false, true, true],
      partialCorners: partial as never,
      minSideCoverage: 0.5,
      edgeFitResidualPx: 0.3,
      worstSideIndex: 0,
      paperRegionFound: true,
    });
    const r = await run({
      previewView: {
        stream: STREAM,
        visibleInStream: visibleRectInStream(STREAM, PHONE)!,
      },
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.errors.map((e) => e.code)).toEqual(["PAPER_CORNER_HIDDEN"]);
    expect(r.overlay.paperPartialCorners).toEqual([
      PAPER_FULL[0],
      null,
      PAPER_FULL[2],
      PAPER_FULL[3],
    ]);
  });

  it("reports none when no sheet was found at all", async () => {
    arrange(null);
    vi.mocked(detectPaperQuad).mockReturnValue({
      corners: null,
      cornersSeen: 0,
      cornersFound: [false, false, false, false],
      partialCorners: [null, null, null, null],
      minSideCoverage: 0,
      edgeFitResidualPx: 0,
      worstSideIndex: null,
      paperRegionFound: false,
      failureStage: "no_bright_region",
    });
    const r = await run();
    expect(r.status).toBe("error");
    expect(r.overlay).not.toHaveProperty("paperPartialCorners");
  });
});
