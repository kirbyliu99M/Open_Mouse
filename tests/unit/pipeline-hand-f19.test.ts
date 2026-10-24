/**
 * V3.2 F19 review (2026-10-25): how `runPhotoPipeline` wires the detector's
 * second call with the hand's 21 landmarks (secondLook.ts). The pure
 * planSecondLook / adoptSecondLook have their own tests; these drive the REAL
 * pipeline with only the browser-bound inputs faked (decode, MediaPipe, the
 * paper detector, the canvas), so a wrong `firstOk`, a second call without
 * `handLandmarksPx`, or a second answer taken when it should not be, fails
 * here. Every detection here is hand-built (no pixels).
 *
 * Geometry: 3 px per mm, an A4 sheet filling the frame, the hand inside it
 * (the sheet holds the palm, so F17's palm look never applies).
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
import {
  detectPaperQuad,
  type EdgeFitRecord,
  type SheetQuadDetection,
} from "../../src/client/paper/detect";
import { runPhotoPipeline } from "../../src/client/photo/pipeline";
import { buildAttemptRecord } from "../../src/client/camera/attemptLog";

const S = 3; // px per mm
const WIDTH = 210 * S;
const HEIGHT = 297 * S;

// The same synthetic hand as pipeline-hand.test.ts (mm), well inside the sheet.
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
const LANDMARKS_PX = HAND_MM.map(([x, y]) => ({
  x: (x! + 20) * S,
  y: (y! + 40) * S,
}));

const CORNERS = [
  { x: 0, y: 0 },
  { x: WIDTH, y: 0 },
  { x: WIDTH, y: HEIGHT },
  { x: 0, y: HEIGHT },
] as const;

function fit(over: Partial<EdgeFitRecord> = {}): EdgeFitRecord {
  return {
    sideResidualsPx: [0.1, 0.1, 0.3, 0.1],
    sideEndsSeen: [true, true, true, true],
    excludedPoints: 0,
    handMask: false,
    piecesJoined: 1,
    ...over,
  };
}

/** A found sheet; `residualPx` 0.3 is flat, 30 (10 mm at 3 px/mm) reads PAPER_CURLED. */
function sheet(
  residualPx: number,
  edgeFit: EdgeFitRecord | undefined,
): SheetQuadDetection {
  return {
    corners: CORNERS,
    cornersSeen: 4,
    cornersFound: [true, true, true, true],
    partialCorners: CORNERS,
    minSideCoverage: 1,
    edgeFitResidualPx: residualPx,
    worstSideIndex: 2,
    paperRegionFound: true,
    sideCoverages: [1, 1, 1, 1],
    ...(edgeFit ? { edgeFit } : {}),
  };
}

function arrange(withHand: boolean) {
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: () => undefined } as unknown as ImageBitmap,
    width: WIDTH,
    height: HEIGHT,
  });
  vi.mocked(detectHandLandmarks).mockResolvedValue(
    withHand
      ? { landmarksPx: LANDMARKS_PX, handedness: "right", confidence: 0.95 }
      : null,
  );
}

function run() {
  return runPhotoPipeline({
    file: new File([new Uint8Array([1, 2, 3])], "hand.jpg", {
      type: "image/jpeg",
    }),
    hand: "right",
    handExplicit: true,
    calibration: { method: "paper-edge", paperSize: "a4" },
  });
}

function log(result: Awaited<ReturnType<typeof run>>) {
  return buildAttemptRecord({
    at: "2026-10-25T00:00:00.000Z",
    userAgent: "test",
    capture: {
      method: "canvas",
      photoWidth: WIDTH,
      photoHeight: HEIGHT,
      photoKb: 900,
      previewWidth: null,
      previewHeight: null,
    },
    outcome: { kind: "result", result },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(detectPaperQuad).mockReset();
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

describe("F19 — the pipeline's second call with the hand", () => {
  it("hand known, first answer PAPER_CURLED, the masked second passes: two calls, the second carries the 21 landmarks, its answer is measured from and recorded", async () => {
    arrange(true);
    const masked = fit({
      sideResidualsPx: [0.1, 0.1, 0.2, 0.1],
      excludedPoints: 240,
      handMask: true,
    });
    vi.mocked(detectPaperQuad).mockImplementation((_f, _p, options) =>
      options?.handLandmarksPx ? sheet(0.3, masked) : sheet(30, fit()),
    );
    const result = await run();
    const calls = vi.mocked(detectPaperQuad).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![2]).not.toHaveProperty("handLandmarksPx");
    expect(calls[1]![2]?.handLandmarksPx).toStrictEqual(LANDMARKS_PX);
    // The sheet holds the palm: no F17 palm look.
    expect(calls[1]![2]).not.toHaveProperty("palmPointsPx");
    expect(result.status).toBe("ok");
    expect(result.diagnostics?.paperEdgeFit?.edgeFit).toStrictEqual(masked);
    expect(result.diagnostics?.paperEdgeFit?.secondLook).toMatchObject({
      palm: false,
      handMask: true,
      used: true,
    });
    expect(result.diagnostics?.paperEdgeFit?.secondLook).not.toHaveProperty(
      "notUsed",
    );
    const record = log(result);
    expect(record.paperEdgeFit?.handMask).toBe(true);
    expect(record.paperEdgeFit?.excludedPoints).toBe(240);
  });

  it("hand known, first answer passes: one call, no second look", async () => {
    arrange(true);
    vi.mocked(detectPaperQuad).mockReturnValue(sheet(0.3, fit()));
    const result = await run();
    expect(vi.mocked(detectPaperQuad)).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
    expect(result.diagnostics?.paperEdgeFit).toStrictEqual({
      edgeFit: fit(),
      secondLook: null,
    });
  });

  it("no hand in the photo: one call, and no edge-fit diagnostics when the detection carries none (as before F19)", async () => {
    arrange(false);
    vi.mocked(detectPaperQuad).mockReturnValue(sheet(30, undefined));
    const result = await run();
    expect(vi.mocked(detectPaperQuad)).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).not.toHaveProperty("paperEdgeFit");
    expect(result.diagnostics).not.toHaveProperty("paperChoice");
  });

  it("hand known, both answers PAPER_CURLED: the first stands, the log says the recorded fit used no mask and keeps the masked one's numbers apart", async () => {
    arrange(true);
    vi.mocked(detectPaperQuad).mockImplementation((_f, _p, options) =>
      options?.handLandmarksPx
        ? sheet(
            27,
            fit({
              sideResidualsPx: [0.1, 0.1, 9, 0.1],
              excludedPoints: 180,
              handMask: true,
            }),
          )
        : sheet(30, fit({ sideResidualsPx: [0.1, 0.1, 10, 0.1] })),
    );
    const result = await run();
    expect(vi.mocked(detectPaperQuad)).toHaveBeenCalledTimes(2);
    if (result.status !== "error") throw new Error("expected an error");
    expect(result.errors.map((e) => e.code)).toContain("PAPER_CURLED");
    const diag = result.diagnostics?.paperEdgeFit;
    expect(diag?.edgeFit?.handMask).toBe(false);
    expect(diag?.secondLook?.used).toBe(false);
    expect(diag?.secondLook?.notUsed).toStrictEqual({
      cornersSeen: 4,
      sideResidualsPx: [0.1, 0.1, 9, 0.1],
      excludedPoints: 180,
      piecesJoined: 1,
    });
    const record = log(result);
    expect(record.paperEdgeFit?.handMask).toBe(false);
    expect(record.paperEdgeFit?.excludedPoints).toBe(0);
    expect(record.paperEdgeFit?.secondLook?.notUsed?.excludedPoints).toBe(180);
  });

  it("hand known, no sheet at first, the masked second finds all four corners but fails a gate: taken (it has corners, the first had none)", async () => {
    arrange(true);
    vi.mocked(detectPaperQuad).mockImplementation((_f, _p, options) =>
      options?.handLandmarksPx
        ? sheet(30, fit({ handMask: true, piecesJoined: 2 }))
        : ({
            corners: null,
            cornersSeen: 0,
            cornersFound: [false, false, false, false],
            partialCorners: [null, null, null, null],
            minSideCoverage: 0,
            edgeFitResidualPx: 0,
            worstSideIndex: null,
            paperRegionFound: false,
            failureStage: "region_split",
          } as SheetQuadDetection),
    );
    const result = await run();
    expect(vi.mocked(detectPaperQuad)).toHaveBeenCalledTimes(2);
    if (result.status !== "error") throw new Error("expected an error");
    expect(result.errors.map((e) => e.code)).toContain("PAPER_CURLED");
    expect(result.diagnostics?.paperEdgeFit?.secondLook?.used).toBe(true);
    expect(result.diagnostics?.paperEdgeFit?.edgeFit?.piecesJoined).toBe(2);
  });
});
