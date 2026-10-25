/**
 * V3.2 F19 review (2026-10-25): how `runPhotoPipeline` gives the paper
 * detector the hand's 21 landmarks. Since the second review the hand is found
 * BEFORE the sheet and its landmarks go with the FIRST (and, without F17's
 * palm look, only) paper call, by the live viewfinder's rule
 * (`paperHandHint`), so the preview and the photo are judged by one
 * detection. These drive the REAL pipeline with only the browser-bound inputs
 * faked (decode, MediaPipe, the paper detector, the canvas). Every detection
 * here is hand-built (no pixels); `pipeline-live-consistency-f19.test.ts`
 * runs the real detector on rendered scenes.
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

describe("F19 review — the pipeline's paper call carries the hand", () => {
  it("hand known: ONE call, carrying the 21 landmarks; its answer is measured from and recorded", async () => {
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
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]?.handLandmarksPx).toStrictEqual(LANDMARKS_PX);
    // The sheet holds the palm: no F17 palm look.
    expect(calls[0]![2]).not.toHaveProperty("palmPointsPx");
    expect(result.status).toBe("ok");
    expect(result.diagnostics?.paperEdgeFit).toStrictEqual({
      edgeFit: masked,
      secondLook: null,
    });
    const record = log(result);
    expect(record.paperEdgeFit?.handMask).toBe(true);
    expect(record.paperEdgeFit?.excludedPoints).toBe(240);
  });

  it("hand known, the masked answer reads PAPER_CURLED: no second call without the mask, the photo is refused (as the live preview would read it)", async () => {
    arrange(true);
    vi.mocked(detectPaperQuad).mockImplementation((_f, _p, options) =>
      options?.handLandmarksPx
        ? sheet(30, fit({ handMask: true, excludedPoints: 180 }))
        : sheet(0.3, fit()),
    );
    const result = await run();
    expect(vi.mocked(detectPaperQuad)).toHaveBeenCalledTimes(1);
    if (result.status !== "error") throw new Error("expected an error");
    expect(result.errors.map((e) => e.code)).toContain("PAPER_CURLED");
    expect(result.diagnostics?.paperEdgeFit?.edgeFit?.handMask).toBe(true);
    expect(result.diagnostics?.paperEdgeFit?.secondLook).toBeNull();
  });

  it("no hand in the photo: one call without landmarks, and no edge-fit diagnostics when the detection carries none (as before F19)", async () => {
    arrange(false);
    vi.mocked(detectPaperQuad).mockReturnValue(sheet(30, undefined));
    const result = await run();
    const calls = vi.mocked(detectPaperQuad).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).not.toHaveProperty("handLandmarksPx");
    expect(result.diagnostics).not.toHaveProperty("paperEdgeFit");
    expect(result.diagnostics).not.toHaveProperty("paperChoice");
  });

  it("the palm off the frame: no landmarks (the live viewfinder's rule)", async () => {
    vi.mocked(decodePhoto).mockResolvedValue({
      bitmap: { close: () => undefined } as unknown as ImageBitmap,
      width: WIDTH,
      height: HEIGHT,
    });
    vi.mocked(detectHandLandmarks).mockResolvedValue({
      landmarksPx: LANDMARKS_PX.map((p) => ({ x: p.x + WIDTH, y: p.y })),
      handedness: "right",
      confidence: 0.95,
    });
    vi.mocked(detectPaperQuad).mockReturnValue(sheet(0.3, fit()));
    await run();
    const calls = vi.mocked(detectPaperQuad).mock.calls;
    expect(calls[0]![2]).not.toHaveProperty("handLandmarksPx");
  });

  it("F17: a sheet that does not hold the palm is looked at again with the palm AND the same landmarks; not taken without a palm choice", async () => {
    arrange(true);
    const small = {
      ...sheet(0.3, fit({ handMask: true })),
      corners: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
        { x: 0, y: 30 },
      ] as const,
    } as unknown as SheetQuadDetection;
    vi.mocked(detectPaperQuad).mockReturnValue(small);
    const result = await run();
    const calls = vi.mocked(detectPaperQuad).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![2]?.handLandmarksPx).toStrictEqual(LANDMARKS_PX);
    expect(calls[1]![2]?.handLandmarksPx).toStrictEqual(LANDMARKS_PX);
    expect(calls[1]![2]?.palmPointsPx).toBeDefined();
    expect(result.diagnostics?.paperEdgeFit?.secondLook).toMatchObject({
      palm: true,
      handMask: true,
      used: false,
    });
  });

  it("the loader's steps keep their order: decoded, paper, hand", async () => {
    arrange(true);
    vi.mocked(detectPaperQuad).mockReturnValue(sheet(0.3, fit()));
    const stages: string[] = [];
    await runPhotoPipeline({
      file: new File([new Uint8Array([1, 2, 3])], "hand.jpg", {
        type: "image/jpeg",
      }),
      hand: "right",
      handExplicit: true,
      calibration: { method: "paper-edge", paperSize: "a4" },
      onStage: (stage) => stages.push(stage),
    });
    expect(stages).toStrictEqual(["decoded", "paper", "hand"]);
  });
});
