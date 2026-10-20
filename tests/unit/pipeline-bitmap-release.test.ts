/**
 * Every way out of `runPhotoPipeline` closes the decoded `ImageBitmap` (and,
 * for a paper-edge crop, the cropped one) exactly once, and never while a
 * detector is still reading it. A bitmap holds a full-size picture in memory
 * until it is closed; before, only a successful paper-edge crop closed the
 * decoded one, so every other run (all of the error returns, the typed-length
 * and printed-sheet flows) left it to the garbage collector.
 *
 * Only the browser-bound inputs are faked, as in pipeline-view-crop.test.ts;
 * the control flow under test is the shipped code.
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

import { decodePhoto, PhotoDecodeError } from "../../src/client/photo/decode";
import { detectHandLandmarks } from "../../src/client/photo/landmarks";
import { detectMarkers } from "../../src/client/photo/markers";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  runPhotoPipeline,
  type RunPhotoPipelineInput,
} from "../../src/client/photo/pipeline";
import { buildExifJpeg, TAG } from "./helpers/exif-jpeg";

/** An ImageBitmap that records how often it was closed. */
class FakeBitmap {
  closeCalls = 0;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  get isClosed() {
    return this.closeCalls > 0;
  }
  close() {
    this.closeCalls += 1;
  }
}

const DECODED = { width: 2250, height: 3000 };
const STREAM = { width: 1080, height: 1440 };
// The part of the stream the screen showed: a crop of the decoded photo.
const VISIBLE = { x: 144, y: 0, width: 792, height: 1440 };

const S = 5.9;
const X0 = 520;
const Y0 = 250;
const PAPER = [
  { x: X0, y: Y0 },
  { x: X0 + 210 * S, y: Y0 },
  { x: X0 + 210 * S, y: Y0 + 297 * S },
  { x: X0, y: Y0 + 297 * S },
] as const;
const HAND_MM: [number, number][] = [
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
const HAND = HAND_MM.map(([x, y]) => ({
  x: X0 + (x + 20) * S,
  y: Y0 + (y + 40) * S,
}));
const JPEG = buildExifJpeg({
  exif: [
    { tag: TAG.focalLengthIn35mmFilm, value: { type: "short", value: 26 } },
  ],
});

let decoded: FakeBitmap;
let cropped: FakeBitmap[];
/** Whether the bitmap each hand detection was handed was already closed when it read it. */
let readAfterClose: boolean[];

function arrange(options: { hand?: boolean; paper?: boolean } = {}) {
  const { hand = true, paper = true } = options;
  decoded = new FakeBitmap(DECODED.width, DECODED.height);
  cropped = [];
  readAfterClose = [];
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: decoded as unknown as ImageBitmap,
    ...DECODED,
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(
      async (
        _source: unknown,
        _x: number,
        _y: number,
        w: number,
        h: number,
      ) => {
        const bitmap = new FakeBitmap(w, h);
        cropped.push(bitmap);
        return bitmap as unknown as ImageBitmap;
      },
    ),
  );
  const corners = PAPER.map((p) => ({ ...p })) as unknown as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  vi.mocked(detectPaperQuad).mockReturnValue({
    corners: paper ? corners : null,
    cornersSeen: paper ? 4 : 0,
    cornersFound: [paper, paper, paper, paper],
    partialCorners: corners,
    minSideCoverage: 1,
    edgeFitResidualPx: 0.3,
    worstSideIndex: 0,
    paperRegionFound: paper,
  });
  vi.mocked(detectHandLandmarks).mockImplementation(async (bitmap) => {
    readAfterClose.push((bitmap as unknown as FakeBitmap).isClosed);
    return hand
      ? { landmarksPx: HAND, handedness: "right", confidence: 0.95 }
      : null;
  });
  vi.mocked(detectMarkers).mockReturnValue([]);
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

const VIEW = { stream: STREAM, visibleInStream: VISIBLE };

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

describe("paper-edge flow", () => {
  it("whole photo, success: the decoded bitmap is closed once, after the hand was read", async () => {
    arrange();
    const result = await run();
    expect(result.status).toBe("ok");
    expect(decoded.closeCalls).toBe(1);
    expect(readAfterClose).toEqual([false]);
  });

  it("cropped, success: the decoded bitmap is freed early, once; the cropped one at the end, once", async () => {
    arrange();
    const result = await run({ previewView: VIEW });
    expect(result.status).toBe("ok");
    expect(decoded.closeCalls).toBe(1);
    expect(cropped).toHaveLength(1);
    expect(cropped[0]!.closeCalls).toBe(1);
    // The hand detector read the cropped bitmap while it was still open.
    expect(readAfterClose).toEqual([false]);
  });

  it("a crop that cannot be made: the decoded bitmap is closed once", async () => {
    arrange();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("no memory");
      }),
    );
    const result = await run({ previewView: VIEW });
    expect(result.status).toBe("ok");
    expect(decoded.closeCalls).toBe(1);
  });

  it("no paper found (early error return), whole and cropped", async () => {
    arrange({ paper: false });
    expect((await run()).status).toBe("error");
    expect(decoded.closeCalls).toBe(1);

    arrange({ paper: false });
    expect((await run({ previewView: VIEW })).status).toBe("error");
    expect(decoded.closeCalls).toBe(1);
    expect(cropped.map((b) => b.closeCalls)).toEqual([1]);
  });

  it("no hand found (error return), cropped", async () => {
    arrange({ hand: false });
    const result = await run({ previewView: VIEW });
    expect(result.status).toBe("error");
    expect(decoded.closeCalls).toBe(1);
    expect(cropped.map((b) => b.closeCalls)).toEqual([1]);
  });

  it("the hand detector throws: the run rejects, and both bitmaps are still closed once", async () => {
    arrange();
    vi.mocked(detectHandLandmarks).mockRejectedValue(new Error("wasm crashed"));
    await expect(run({ previewView: VIEW })).rejects.toThrow("wasm crashed");
    expect(decoded.closeCalls).toBe(1);
    expect(cropped.map((b) => b.closeCalls)).toEqual([1]);
  });

  it("the canvas is unavailable while reading pixels, cropped: both closed once", async () => {
    arrange();
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    await expect(run({ previewView: VIEW })).rejects.toThrow("2D canvas");
    expect(decoded.closeCalls).toBe(1);
    expect(cropped.map((b) => b.closeCalls)).toEqual([1]);
  });
});

describe("typed hand length flow", () => {
  const typed = { method: "user-length", handLengthMm: 190 } as const;

  it("a run that gets through the hand: closed once, after the hand was read", async () => {
    arrange();
    await run({ calibration: typed });
    expect(decoded.closeCalls).toBe(1);
    expect(readAfterClose).toEqual([false]);
  });

  it("no hand found: closed once", async () => {
    arrange({ hand: false });
    expect((await run({ calibration: typed })).status).toBe("error");
    expect(decoded.closeCalls).toBe(1);
  });

  it("the hand detector throws: closed once", async () => {
    arrange();
    vi.mocked(detectHandLandmarks).mockRejectedValue(new Error("boom"));
    await expect(run({ calibration: typed })).rejects.toThrow("boom");
    expect(decoded.closeCalls).toBe(1);
  });
});

describe("printed-sheet flow", () => {
  const printed = { calibration: { method: "printed-sheet" } } as const;

  it("markers missing (error return): closed once", async () => {
    arrange();
    expect((await run(printed)).status).toBe("error");
    expect(decoded.closeCalls).toBe(1);
  });

  it("the marker detector throws: closed once", async () => {
    arrange();
    vi.mocked(detectMarkers).mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(run(printed)).rejects.toThrow("boom");
    expect(decoded.closeCalls).toBe(1);
  });
});

describe("decode", () => {
  it("a photo that cannot be decoded has no bitmap to close, and says so as an error result", async () => {
    arrange();
    vi.mocked(decodePhoto).mockRejectedValue(new PhotoDecodeError("nope"));
    const result = await run();
    expect(result.status).toBe("error");
    expect(decoded.closeCalls).toBe(0);
  });
});
