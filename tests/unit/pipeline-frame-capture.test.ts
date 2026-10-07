/**
 * The pipeline with a FRAME OF THE VIDEO (scan v2 frame capture): a canvas
 * JPEG, cut to the part of the stream that was on screen, with no EXIF. The
 * parallax correction reads the photo's EXIF focal length, which a canvas
 * frame does not have. These tests drive the real `runPhotoPipeline` (the
 * browser parts faked, as in tests/unit/pipeline-view-crop.test.ts) and check
 * the path that has no EXIF: nothing throws, nothing is cropped (the frame is
 * already the part on screen), `parallaxCorrected` says what really happened,
 * and the submission is valid.
 *
 * What it costs: with no EXIF focal length the correction runs only when the
 * sheet's own perspective fixes a focal length (a tilted view, `reliable`);
 * for a phone held flat above the sheet it does not run, and the hand length
 * is the uncorrected one (a little high: the landmarks are above the sheet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/photo/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/photo/decode")>()),
  decodePhoto: vi.fn(),
}));
vi.mock("../../src/client/photo/landmarks", () => ({
  detectHandLandmarks: vi.fn(),
}));
vi.mock("../../src/client/photo/markers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/photo/markers")>()),
  detectMarkers: vi.fn(),
}));
vi.mock("../../src/client/photo/card", () => ({
  detectCardCorners: vi.fn(),
}));
vi.mock("../../src/client/paper/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/paper/detect")>()),
  detectPaperQuad: vi.fn(),
}));

import { decodePhoto } from "../../src/client/photo/decode";
import { detectHandLandmarks } from "../../src/client/photo/landmarks";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import { assumedFocalPxFromFov } from "../../src/client/paper/orientation";
import {
  assumedSampleFocalPx,
  visibleRegionInStream,
} from "../../src/client/camera/visibleView";
import { buildPaperHomography } from "../../src/client/paper/homography";
import {
  applyHomography,
  invert3x3,
  type Point2,
} from "../../src/client/geometry/homography";
import {
  computeCorrectedHandMeasurements,
  computeHandMeasurements,
} from "../../src/client/geometry/measurements";
import { scanSubmissionSchema } from "../../src/lib/contracts/measurement";
import {
  runPhotoPipeline,
  type PipelineResult,
} from "../../src/client/photo/pipeline";

// The frame the shutter took: the part of a stream that was on screen.
const FRAME = { width: 580, height: 1088 };
const A4 = { width: 210, height: 297 };

// The synthetic hand of tests/unit/measurements.test.ts (mm), 190 mm long.
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
].map(([x, y]) => ({ x: x + 20, y: y + 40 }));

type Corners = readonly [Point2, Point2, Point2, Point2];

/** A sheet seen flat from above, filling most of the frame. */
const FRONTAL: Corners = [
  { x: 50, y: 150 },
  { x: 50 + A4.width * 2.5, y: 150 },
  { x: 50 + A4.width * 2.5, y: 150 + A4.height * 2.5 },
  { x: 50, y: 150 + A4.height * 2.5 },
];
/** The same sheet seen with the phone tilted: a trapezoid, so the sheet fixes a focal length. */
const TILTED: Corners = [
  { x: 120, y: 190 },
  { x: 520, y: 120 },
  { x: 560, y: 1010 },
  { x: 40, y: 940 },
];

function landmarksFor(corners: Corners): Point2[] {
  // Where the hand's millimetres land in the picture: through the inverse of
  // the sheet's own homography.
  const back = invert3x3(buildPaperHomography(corners, "a4"));
  return HAND_MM.map((p) => applyHomography(back, p));
}

function arrange(corners: Corners, landmarks: readonly Point2[]) {
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: () => undefined } as unknown as ImageBitmap,
    width: FRAME.width,
    height: FRAME.height,
  });
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
    landmarksPx: landmarks,
    handedness: "right",
    confidence: 0.95,
  });
}

/** A JPEG with no EXIF at all, as a canvas makes it (SOI, EOI). */
const noExif = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "frame.jpg", {
    type: "image/jpeg",
  });

function run(
  file: File = noExif(),
  extra: { focalReferenceWidthPx?: number } = {},
) {
  return runPhotoPipeline({
    file,
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

function reference(corners: Corners, landmarks: readonly Point2[]) {
  const quad = {
    corners: corners as never,
    cornersSeen: 4 as const,
    cornersFound: [true, true, true, true] as const,
    partialCorners: corners as never,
    minSideCoverage: 1,
    edgeFitResidualPx: 0.3,
    worstSideIndex: 0 as const,
    paperRegionFound: true,
  };
  const { geometry } = evaluatePaperEdgeCalibration(quad, "a4", false);
  return {
    homography: geometry!.homography,
    corrected: computeCorrectedHandMeasurements(
      landmarks,
      geometry!.homography,
      {
        exifFocalPx: null,
        widthPx: FRAME.width,
        heightPx: FRAME.height,
      },
    ),
  };
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
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      throw new Error("a frame is not cropped again");
    }),
  );
});

describe("paper-edge pipeline with a frame of the video (no EXIF, no previewView)", () => {
  it("measures it: ok, nothing cropped, the overlay is in the frame's own pixels", async () => {
    const landmarks = landmarksFor(FRONTAL);
    arrange(FRONTAL, landmarks);
    const result = ok(await run());
    expect(vi.mocked(createImageBitmap)).not.toHaveBeenCalled();
    expect(result.diagnostics?.fovCrop).toBeNull();
    expect(result.diagnostics?.view).toBeNull();
    expect(result.diagnostics?.analysed).toEqual(FRAME);
    expect(result.overlay.imageWidth).toBe(FRAME.width);
    expect(result.overlay.imageHeight).toBe(FRAME.height);
    expect(result.overlay.landmarksPx).toEqual(landmarks);
    expect(result.overlay.paperCorners).toEqual(FRONTAL);
  });

  it("a sheet seen flat from above cannot fix a focal length: parallaxCorrected is false and the measurements are the uncorrected ones", async () => {
    const landmarks = landmarksFor(FRONTAL);
    arrange(FRONTAL, landmarks);
    const result = ok(await run());
    const { homography, corrected } = reference(FRONTAL, landmarks);
    expect(corrected.parallaxCorrected).toBe(false);
    expect(result.diagnostics?.parallaxCorrected).toBe(false);
    // No correction: no focal length either, and the measured numbers are the result's own.
    expect(result.diagnostics?.focal).toEqual({ source: "none", px: null });
    expect(result.diagnostics?.measured).toEqual({
      handLengthMm: result.measurements.handLengthMm,
      palmWidthMm: result.measurements.palmWidthMm,
    });
    expect(result.submission.calibration).toMatchObject({
      method: "paper-edge",
      parallaxCorrected: false,
    });
    expect(result.measurements).toEqual(
      computeHandMeasurements(landmarks, homography),
    );
    // The synthetic hand is 190 mm long, and without the correction it reads 190.
    expect(result.measurements.handLengthMm).toBeCloseTo(190, 6);
  });

  it("a tilted view: whatever the focal policy decides, the flag says it and the measurements are the reference's", async () => {
    const landmarks = landmarksFor(TILTED);
    arrange(TILTED, landmarks);
    const result = ok(await run());
    const { corrected } = reference(TILTED, landmarks);
    expect(result.diagnostics?.parallaxCorrected).toBe(
      corrected.parallaxCorrected,
    );
    expect(result.diagnostics?.focal).toEqual({
      source: corrected.focalSource,
      px: corrected.fPx,
    });
    expect(result.diagnostics?.measured).toEqual({
      handLengthMm: corrected.measurements.handLengthMm,
      palmWidthMm: corrected.measurements.palmWidthMm,
    });
    expect(result.submission.calibration).toMatchObject({
      parallaxCorrected: corrected.parallaxCorrected,
    });
    expect(result.measurements).toEqual(corrected.measurements);
  });

  it("a run that stops before it measures has no measured numbers and no focal length", async () => {
    arrange(FRONTAL, landmarksFor(FRONTAL));
    vi.mocked(detectHandLandmarks).mockResolvedValue(null);
    const result = await run();
    expect(result.status).toBe("error");
    expect(result.diagnostics?.measured).toEqual({
      handLengthMm: null,
      palmWidthMm: null,
    });
    expect(result.diagnostics?.focal).toBeNull();
  });

  it("the submission is valid for the contract, with or without the correction", async () => {
    for (const corners of [FRONTAL, TILTED]) {
      arrange(corners, landmarksFor(corners));
      const result = ok(await run());
      expect(() => scanSubmissionSchema.parse(result.submission)).not.toThrow();
    }
  });

  it("no EXIF of any kind does not make it throw: empty bytes, junk bytes, a JPEG with nothing in it", async () => {
    const landmarks = landmarksFor(FRONTAL);
    for (const bytes of [
      new Uint8Array([]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([0xff, 0xd8]),
      new Uint8Array([
        0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9,
      ]),
    ]) {
      arrange(FRONTAL, landmarks);
      const result = await run(
        new File([bytes as BlobPart], "frame.jpg", { type: "image/jpeg" }),
      );
      expect(result.status).toBe("ok");
      expect(result.diagnostics?.parallaxCorrected).toBe(false);
    }
  });
});

describe("the paper detector's assumed focal length: a frame cut before the pipeline carries the stream's width", () => {
  // The S25 after #132: a 1088x1088 stream on a 412x772 screen. The frame is
  // 580x1088 (FRAME); the live loop assumed its focal length from the whole
  // stream's 1088 px (777 px), the pipeline would from the frame's 580 (414 px).
  const stream = { width: 1088, height: 1088 };
  const region = visibleRegionInStream(stream, { width: 412, height: 772 })!;
  const hintOfFirstDetection = () => {
    const call = vi.mocked(detectPaperQuad).mock.calls[0];
    return call[2]?.focalPxHint;
  };

  it("not passed (an upload, the camera's photo): from the frame's own width, as before", async () => {
    arrange(FRONTAL, landmarksFor(FRONTAL));
    ok(await run());
    expect(hintOfFirstDetection()).toBe(assumedFocalPxFromFov(FRAME.width));
    expect(hintOfFirstDetection()).toBeCloseTo(414, 0);
  });

  it("passed (a frame of the video): the live loop's number for the same pixels, 777 px", async () => {
    arrange(FRONTAL, landmarksFor(FRONTAL));
    ok(await run(noExif(), { focalReferenceWidthPx: stream.width }));
    const hint = hintOfFirstDetection()!;
    // What the live loop assumed for these pixels, from sample pixels back to frame pixels.
    const sample = { width: 342, height: 640 };
    const live = assumedSampleFocalPx(stream, region.visible, sample);
    expect(hint).toBeCloseTo(live * (region.visible.width / sample.width), 9);
    expect(hint).toBeCloseTo(777, 0);
  });

  it("only the detector's hint moves: the result is the same measurement either way", async () => {
    const landmarks = landmarksFor(TILTED);
    arrange(TILTED, landmarks);
    const without = ok(await run());
    arrange(TILTED, landmarks);
    const withReference = ok(
      await run(noExif(), { focalReferenceWidthPx: stream.width }),
    );
    expect(withReference.measurements).toEqual(without.measurements);
    expect(withReference.diagnostics?.parallaxCorrected).toBe(
      without.diagnostics?.parallaxCorrected,
    );
    expect(withReference.diagnostics?.paper).toEqual(
      without.diagnostics?.paper,
    );
  });
});
