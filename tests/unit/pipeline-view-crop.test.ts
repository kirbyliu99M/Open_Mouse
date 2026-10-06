/**
 * Drives the REAL `runPhotoPipeline` (paper-edge) with a `previewView`: the part
 * of the stream the person saw on screen, which the photo is cropped to before
 * anything is detected (src/client/camera/visibleView.ts). Only the
 * browser-bound inputs are faked (the decoded bitmap, `createImageBitmap`,
 * MediaPipe, the paper detector and the canvas), the same way
 * tests/unit/pipeline-hand.test.ts does; the crop wiring, the gates, the EXIF
 * focal length, the parallax-corrected measurements and the overlay are the
 * shipped code.
 *
 * The three things a crop must not damage each have an assertion that fails if
 * it is wired wrong (the review of this change mutated each of them and no
 * test noticed):
 *   1. the EXIF focal length in pixels comes from the WHOLE decoded photo's size;
 *   2. the principal point is the analysed (cropped) image's centre;
 *   3. the overlay is reported in the WHOLE decoded photo's pixels.
 * The strongest check is the invariance test: the same scene analysed whole and
 * analysed cropped gives the same measurements and the same overlay.
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
import { computeCorrectedHandMeasurements } from "../../src/client/geometry/measurements";
import {
  runPhotoPipeline,
  type PipelineResult,
  type RunPhotoPipelineInput,
} from "../../src/client/photo/pipeline";
import { visibleRectInStream } from "../../src/client/camera/visibleView";
import { buildExifJpeg, TAG } from "./helpers/exif-jpeg";

const DECODED = { width: 2250, height: 3000 };
const STREAM = { width: 1080, height: 1440 };
const PHONE = { width: 390, height: 844 };
/** What the screen showed of that stream, carried to the 2250x3000 photo (visibleView.test.ts). */
const CROP = { x: 432, y: 0, width: 1386, height: 3000 };

const S = 5.9; // px per mm in the whole photo
const PAPER_X0 = 520;
const PAPER_Y0 = 250;
const A4 = { width: 210, height: 297 };
const PAPER_FULL = [
  { x: PAPER_X0, y: PAPER_Y0 },
  { x: PAPER_X0 + A4.width * S, y: PAPER_Y0 },
  { x: PAPER_X0 + A4.width * S, y: PAPER_Y0 + A4.height * S },
  { x: PAPER_X0, y: PAPER_Y0 + A4.height * S },
] as const;

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
];
const HAND_FULL = HAND_MM.map(([x, y]) => ({
  x: PAPER_X0 + (x + 20) * S,
  y: PAPER_Y0 + (y + 40) * S,
}));

const EXIF_35MM = 26;
const JPEG = buildExifJpeg({
  exif: [
    {
      tag: TAG.focalLengthIn35mmFilm,
      value: { type: "short", value: EXIF_35MM },
    },
  ],
});
/** What the focal length is for the WHOLE decoded photo (and what it would wrongly be for the crop). */
const focalFor = (size: { width: number; height: number }) =>
  (EXIF_35MM / 43.27) * Math.hypot(size.width, size.height);

const shift = (p: { x: number; y: number }, dx: number, dy: number) => ({
  x: p.x + dx,
  y: p.y + dy,
});

interface Seen {
  imageDataSizes: { width: number; height: number }[];
  bitmapCrops: unknown[][];
  closed: ReturnType<typeof vi.fn>;
}
let seen: Seen;

/** Arranges the mocks for a photo analysed as `crop` (or as the whole photo). */
function arrange(crop: { x: number; y: number } | null) {
  const dx = crop ? -crop.x : 0;
  const dy = crop ? -crop.y : 0;
  seen = { imageDataSizes: [], bitmapCrops: [], closed: vi.fn() };
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: seen.closed } as unknown as ImageBitmap,
    width: DECODED.width,
    height: DECODED.height,
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (...args: unknown[]) => {
      seen.bitmapCrops.push(args);
      return {
        width: args[3],
        height: args[4],
        close: () => undefined,
      } as unknown as ImageBitmap;
    }),
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
    file: new File([JPEG as BlobPart], "capture.jpg", { type: "image/jpeg" }),
    hand: "right",
    handExplicit: true,
    calibration: { method: "paper-edge", paperSize: "a4" },
    ...extra,
  });
}

const VIEW = {
  stream: STREAM,
  visibleInStream: visibleRectInStream(STREAM, PHONE)!,
};

/** The measurements the pipeline must produce for the scene, worked out here from the maths, not from the pipeline. */
function reference(options: {
  focalFrame: { width: number; height: number };
  principalFrame: { width: number; height: number };
  corners: readonly { x: number; y: number }[];
  landmarks: readonly { x: number; y: number }[];
}) {
  const quad = {
    corners: options.corners as never,
    cornersSeen: 4 as const,
    cornersFound: [true, true, true, true] as const,
    partialCorners: options.corners as never,
    minSideCoverage: 1,
    edgeFitResidualPx: 0.3,
    worstSideIndex: 0 as const,
    paperRegionFound: true,
  };
  const { geometry } = evaluatePaperEdgeCalibration(quad, "a4", false);
  return computeCorrectedHandMeasurements(
    options.landmarks,
    geometry!.homography,
    {
      exifFocalPx: focalFor(options.focalFrame),
      widthPx: options.principalFrame.width,
      heightPx: options.principalFrame.height,
    },
  );
}

function ok(result: PipelineResult) {
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("not ok");
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  seen = { imageDataSizes: [], bitmapCrops: [], closed: vi.fn() };
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          seen.imageDataSizes.push({ width: w, height: h });
          return {
            data: new Uint8ClampedArray(w * h * 4).fill(128),
            width: w,
            height: h,
          };
        },
      }),
    }),
  });
});

describe("paper-edge pipeline with a previewView: the photo is cut to what was on screen", () => {
  it("crops right after decoding, once, to the screen's share, and the detectors see only that", async () => {
    arrange(CROP);
    const result = ok(await run({ previewView: VIEW }));
    expect(seen.bitmapCrops).toHaveLength(1);
    expect(seen.bitmapCrops[0].slice(1)).toEqual([
      CROP.x,
      CROP.y,
      CROP.width,
      CROP.height,
    ]);
    // The decoded bitmap is released once the cropped one exists.
    expect(seen.closed).toHaveBeenCalledTimes(1);
    // The canvas, the paper detector and the hand detector all got the cropped size.
    expect(seen.imageDataSizes).toEqual([
      { width: CROP.width, height: CROP.height },
    ]);
    const frame = vi.mocked(detectPaperQuad).mock.calls[0][0];
    expect([frame.width, frame.height]).toEqual([CROP.width, CROP.height]);
    const bitmap = vi.mocked(detectHandLandmarks).mock.calls[0][0];
    expect([bitmap.width, bitmap.height]).toEqual([CROP.width, CROP.height]);
    expect(result.diagnostics?.fovCrop).toEqual(CROP);
    expect(result.diagnostics?.analysed).toEqual({
      width: CROP.width,
      height: CROP.height,
    });
    expect(result.diagnostics?.decoded).toEqual(DECODED);
    expect(result.diagnostics?.view).toMatchObject({
      model: "same-view",
      modelApplies: true,
      stream: STREAM,
    });
  });

  it("(1) the focal length the paper detector assumes is the whole photo's, not the crop's", async () => {
    arrange(CROP);
    await run({ previewView: VIEW });
    const options = vi.mocked(detectPaperQuad).mock.calls[0][2];
    expect(options?.focalPxHint).toBeCloseTo(
      assumedFocalPxFromFov(DECODED.width),
      9,
    );
    expect(options?.focalPxHint).not.toBeCloseTo(
      assumedFocalPxFromFov(CROP.width),
      0,
    );
  });

  it("(1)(2) the measurements use the EXIF focal length of the whole photo and the cropped image's centre", async () => {
    arrange(CROP);
    const result = ok(await run({ previewView: VIEW }));
    expect(result.submission.calibration).toMatchObject({
      parallaxCorrected: true,
    });
    const corners = PAPER_FULL.map((p) => shift(p, -CROP.x, -CROP.y));
    const landmarks = HAND_FULL.map((p) => shift(p, -CROP.x, -CROP.y));
    const right = reference({
      focalFrame: DECODED,
      principalFrame: { width: CROP.width, height: CROP.height },
      corners,
      landmarks,
    });
    expect(result.measurements).toEqual(right.measurements);

    // The scene is chosen so that each wrong wiring gives a different answer:
    // these are what the pipeline would report if it were wired wrong.
    const focalFromCrop = reference({
      focalFrame: { width: CROP.width, height: CROP.height },
      principalFrame: { width: CROP.width, height: CROP.height },
      corners,
      landmarks,
    });
    const centreOfWholePhoto = reference({
      focalFrame: DECODED,
      principalFrame: DECODED,
      corners,
      landmarks,
    });
    expect(
      Math.abs(
        focalFromCrop.measurements.handLengthMm -
          right.measurements.handLengthMm,
      ),
    ).toBeGreaterThan(1e-4);
    expect(
      Math.abs(
        centreOfWholePhoto.measurements.handLengthMm -
          right.measurements.handLengthMm,
      ),
    ).toBeGreaterThan(1e-4);
  });

  it("(3) the overlay is in the whole photo's pixels: the crop's offset is put back", async () => {
    arrange(CROP);
    const result = ok(await run({ previewView: VIEW }));
    expect(result.overlay.imageWidth).toBe(DECODED.width);
    expect(result.overlay.imageHeight).toBe(DECODED.height);
    expect(result.overlay.landmarksPx).toEqual(HAND_FULL);
    expect(result.overlay.paperCorners).toEqual(PAPER_FULL);
  });

  it("the same scene analysed whole and analysed cropped gives the same measurements and the same overlay", async () => {
    arrange(null);
    const whole = ok(await run());
    arrange(CROP);
    const cropped = ok(await run({ previewView: VIEW }));
    for (const key of Object.keys(
      whole.measurements,
    ) as (keyof typeof whole.measurements)[])
      expect(cropped.measurements[key], key).toBeCloseTo(
        whole.measurements[key] as number,
        6,
      );
    expect(cropped.overlay.landmarksPx).toEqual(whole.overlay.landmarksPx);
    expect(cropped.overlay.paperCorners).toEqual(whole.overlay.paperCorners);
    expect(cropped.overlay.imageWidth).toBe(whole.overlay.imageWidth);
    expect(cropped.submission.calibration).toMatchObject({
      parallaxCorrected: true,
    });
  });

  it("a gate failure in a cropped photo also reports its overlay in the whole photo's pixels", async () => {
    arrange(CROP);
    vi.mocked(detectHandLandmarks).mockResolvedValue({
      landmarksPx: HAND_FULL.map((p) => shift(p, -CROP.x, -CROP.y)),
      handedness: "left",
      confidence: 0.95,
    });
    const result = await run({ previewView: VIEW });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.map((e) => e.code)).toContain("HANDEDNESS_MISMATCH");
    expect(result.overlay.landmarksPx).toEqual(HAND_FULL);
    expect(result.overlay.paperCorners).toEqual(PAPER_FULL);
    expect(result.overlay.imageWidth).toBe(DECODED.width);
  });

  it("without a previewView nothing is cropped", async () => {
    arrange(null);
    const result = ok(await run());
    expect(seen.bitmapCrops).toEqual([]);
    expect(seen.closed).not.toHaveBeenCalled();
    expect(seen.imageDataSizes).toEqual([DECODED]);
    expect(result.diagnostics?.fovCrop).toBeNull();
    expect(result.diagnostics?.view).toBeNull();
    // The detector is given the same focal length it would have assumed itself.
    expect(
      vi.mocked(detectPaperQuad).mock.calls[0][2]?.focalPxHint,
    ).toBeCloseTo(assumedFocalPxFromFov(DECODED.width), 9);
  });

  it("a screen that showed the whole stream, in the photo's own shape, crops nothing", async () => {
    arrange(null);
    const whole = {
      stream: STREAM,
      visibleInStream: visibleRectInStream(STREAM, {
        width: 450,
        height: 600,
      })!,
    };
    const result = ok(await run({ previewView: whole }));
    expect(seen.bitmapCrops).toEqual([]);
    expect(result.diagnostics?.fovCrop).toBeNull();
    expect(result.diagnostics?.view?.modelApplies).toBe(true);
  });

  it("a crop that cannot be made analyses the whole photo instead of failing", async () => {
    arrange(null);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("no memory");
      }),
    );
    const result = ok(await run({ previewView: VIEW }));
    expect(result.diagnostics?.fovCrop).toBeNull();
    expect(result.diagnostics?.analysed).toEqual(DECODED);
    expect(seen.closed).not.toHaveBeenCalled();
    expect(result.overlay.landmarksPx).toEqual(HAND_FULL);
  });

  it("an upright stream and a wide photo are not matched: the whole photo, with the reason in the record", async () => {
    arrange(null);
    vi.mocked(decodePhoto).mockResolvedValue({
      bitmap: { close: seen.closed } as unknown as ImageBitmap,
      width: DECODED.height,
      height: DECODED.width,
    });
    const result = await run({ previewView: VIEW });
    expect(seen.bitmapCrops).toEqual([]);
    expect(result.diagnostics?.fovCrop).toBeNull();
    expect(result.diagnostics?.view).toMatchObject({
      model: "orientation-differs",
      modelApplies: false,
    });
  });
});
