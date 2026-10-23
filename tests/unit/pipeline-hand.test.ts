/**
 * Drives the REAL `runPhotoPipeline` for all three calibrations (printed
 * sheet, blank paper, typed hand length) with only the browser-bound inputs
 * faked: the decoded bitmap, MediaPipe, ArUco, card and paper detection, and
 * the canvas. Everything downstream (homography, measurements, gates,
 * submission assembly) is the shipped code, so these tests fail if any
 * pipeline stops taking its hand decision from `resolvePipelineHand`.
 *
 * Geometry: 3 px per mm, origin at the sheet's top-left, so the homography
 * the pipelines build is exactly a 1/3 scale and the synthetic hand keeps its
 * millimetre dimensions.
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
import { detectMarkers } from "../../src/client/photo/markers";
import { detectCardCorners } from "../../src/client/photo/card";
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  runPhotoPipeline,
  type CalibrationInput,
  type RunPhotoPipelineInput,
} from "../../src/client/photo/pipeline";
import { computeSheetLayout } from "../../src/client/sheet/layout";
import { buildAttemptRecord } from "../../src/client/camera/attemptLog";
import { photoStagesFor } from "../../src/lib/particles/loading";
import { en as paperStageCopyEn } from "../../src/lib/copy/paper-stage";
import { ID1_CARD_MM, SHEET } from "../../src/lib/contracts/measurement";

const S = 3; // px per mm
const A4_W_MM = 210;
const A4_H_MM = 297;
const WIDTH = A4_W_MM * S;
const HEIGHT = A4_H_MM * S;

// The same synthetic hand as tests/unit/measurements.test.ts (mm), placed well
// inside the sheet. Its middle finger is straight and it is 190 mm long.
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
  x: (x + 20) * S,
  y: (y + 40) * S,
}));

type Hand = "left" | "right";
type Detected = Hand | null;

const CALIBRATIONS: readonly {
  readonly name: string;
  readonly calibration: CalibrationInput | undefined;
}[] = [
  { name: "printed sheet", calibration: undefined },
  {
    name: "blank paper",
    calibration: { method: "paper-edge", paperSize: "a4" },
  },
  {
    name: "typed hand length",
    calibration: { method: "user-length", handLengthMm: 190 },
  },
];

function arrange(detected: Detected) {
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: () => undefined } as unknown as ImageBitmap,
    width: WIDTH,
    height: HEIGHT,
  });
  vi.mocked(detectHandLandmarks).mockResolvedValue({
    landmarksPx: LANDMARKS_PX,
    handedness: detected,
    confidence: 0.95,
  });
  // Printed sheet: the four flat-flap markers seen at exactly 3 px per mm.
  vi.mocked(detectMarkers).mockReturnValue(
    computeSheetLayout()
      .markers.filter((m) =>
        (SHEET.flatMarkerIds as readonly number[]).includes(m.id),
      )
      .map((m) => ({
        id: m.id,
        corners: m.corners.map((c) => ({ x: c.x * S, y: c.y * S })) as never,
      })),
  );
  const cardW = ID1_CARD_MM.width * S;
  const cardH = ID1_CARD_MM.height * S;
  vi.mocked(detectCardCorners).mockReturnValue([
    { x: 60, y: 60 },
    { x: 60 + cardW, y: 60 },
    { x: 60 + cardW, y: 60 + cardH },
    { x: 60, y: 60 + cardH },
  ]);
  // Blank paper: a whole A4 sheet filling the frame.
  const corners = [
    { x: 0, y: 0 },
    { x: WIDTH, y: 0 },
    { x: WIDTH, y: HEIGHT },
    { x: 0, y: HEIGHT },
  ] as const;
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
}

function run(
  calibration: CalibrationInput | undefined,
  extra: Partial<RunPhotoPipelineInput>,
) {
  return runPhotoPipeline({
    file: new File([new Uint8Array([1, 2, 3])], "hand.jpg", {
      type: "image/jpeg",
    }),
    hand: "right",
    calibration,
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // pipeline.ts reads pixels through a canvas: a flat grey frame is enough
  // (a blurry frame is only a warning).
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

describe.each(CALIBRATIONS)("$name pipeline", ({ calibration }) => {
  it("measures a valid photo (sanity: the fixtures pass every other gate)", async () => {
    arrange("right");
    const result = await run(calibration, { handExplicit: true });
    expect(result.status).toBe("ok");
  });

  it("on auto, submits the detected hand and never compares it", async () => {
    arrange("left");
    const result = await run(calibration, {
      hand: "right",
      handExplicit: false,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.submission.hand).toBe("left");
  });

  it("on auto, follows the detected hand whichever hand was the default", async () => {
    arrange("right");
    const result = await run(calibration, {
      hand: "left",
      handExplicit: false,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.submission.hand).toBe("right");
  });

  it("with a hand the user chose, keeps it when the photo agrees", async () => {
    arrange("left");
    const result = await run(calibration, { hand: "left", handExplicit: true });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.submission.hand).toBe("left");
  });

  it("with a hand the user chose, stops a photo of the other hand with HANDEDNESS_MISMATCH", async () => {
    arrange("left");
    const result = await run(calibration, {
      hand: "right",
      handExplicit: true,
      handednessFixInstruction: "tap the hand button below",
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    const mismatch = result.errors.find(
      (e) => e.code === "HANDEDNESS_MISMATCH",
    );
    expect(mismatch?.message).toContain("you selected right");
    expect(mismatch?.message).toContain("tap the hand button below");
  });

  it("treats a caller that never says as having chosen its hand", async () => {
    arrange("left");
    const result = await run(calibration, { hand: "right" });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.map((e) => e.code)).toContain("HANDEDNESS_MISMATCH");
  });

  it("on auto, never says 'you selected' about a hand nobody selected", async () => {
    arrange("left");
    const result = await run(calibration, {
      hand: "right",
      handExplicit: false,
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("you selected");
    expect(text).not.toContain("HANDEDNESS_MISMATCH");
  });

  it("with a hand the user chose, a photo with no handedness label is stopped as unreadable too, never submitted as chosen", async () => {
    arrange(null);
    const result = await run(calibration, {
      hand: "right",
      handExplicit: true,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.map((e) => e.code)).toContain(
      "LOW_LANDMARK_CONFIDENCE",
    );
    // There is nothing detected to disagree with, so it is not a mismatch.
    expect(result.errors.map((e) => e.code)).not.toContain(
      "HANDEDNESS_MISMATCH",
    );
  });

  it("on auto, a photo with no handedness label is blocked as unreadable, not as a mismatch", async () => {
    arrange(null);
    const result = await run(calibration, {
      hand: "right",
      handExplicit: false,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.map((e) => e.code)).toContain(
      "LOW_LANDMARK_CONFIDENCE",
    );
    expect(result.errors.map((e) => e.code)).not.toContain(
      "HANDEDNESS_MISMATCH",
    );
  });
});

/**
 * `onStage` (V3.2 U1): the loader's ring follows the real steps. Each run
 * reports its steps in `photoStagesFor`'s order, and a listener, present,
 * absent or throwing, changes nothing about the result or the detector calls.
 */
const STAGE_RUNS = [
  { name: "printed sheet", calibration: undefined, method: "printed-sheet" },
  {
    name: "blank paper",
    calibration: { method: "paper-edge", paperSize: "a4" },
    method: "paper-edge",
  },
  {
    name: "typed hand length",
    calibration: { method: "user-length", handLengthMm: 190 },
    method: "user-length",
  },
] as const satisfies readonly {
  name: string;
  calibration: CalibrationInput | undefined;
  method: Parameters<typeof photoStagesFor>[0];
}[];

describe.each(STAGE_RUNS)(
  "$name pipeline: onStage",
  ({ calibration, method }) => {
    it("reports its steps once each, in photoStagesFor's order", async () => {
      arrange("right");
      const seen: string[] = [];
      const result = await run(calibration, {
        handExplicit: true,
        onStage: (stage) => seen.push(stage),
      });
      expect(result.status).toBe("ok");
      expect(seen).toEqual([...photoStagesFor(method)]);
    });

    it("a listener that throws changes neither the result nor the detector calls", async () => {
      arrange("right");
      const plain = await run(calibration, { handExplicit: true });
      const plainHandCalls = vi.mocked(detectHandLandmarks).mock.calls.length;
      const plainPaperCalls = vi.mocked(detectPaperQuad).mock.calls.length;

      vi.clearAllMocks();
      arrange("right");
      const listened = await run(calibration, {
        handExplicit: true,
        onStage: () => {
          throw new Error("the loader broke");
        },
      });
      expect(vi.mocked(detectHandLandmarks).mock.calls.length).toBe(
        plainHandCalls,
      );
      expect(vi.mocked(detectPaperQuad).mock.calls.length).toBe(
        plainPaperCalls,
      );
      expect(plainHandCalls).toBe(1);
      // Timings differ run to run; everything else is the same.
      const strip = (r: unknown) =>
        JSON.parse(
          JSON.stringify(r, (key, value) =>
            /Ms$/.test(key) && typeof value === "number" ? 0 : value,
          ),
        );
      expect(strip(listened)).toEqual(strip(plain));
    });
  },
);

describe("blank paper pipeline: onStage when no sheet is found", () => {
  it("still reports the paper step (it was looked for) and then stops", async () => {
    arrange("right");
    vi.mocked(detectPaperQuad).mockReturnValue({
      corners: null,
      cornersSeen: 0,
      cornersFound: [false, false, false, false],
      partialCorners: [null, null, null, null],
      minSideCoverage: 0,
      edgeFitResidualPx: null,
      worstSideIndex: null,
      paperRegionFound: false,
    } as never);
    const seen: string[] = [];
    const result = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true, onStage: (stage) => seen.push(stage) },
    );
    expect(result.status).toBe("error");
    expect(seen.slice(0, 2)).toEqual(["decoded", "paper"]);
  });
});

describe("blank paper pipeline: the detector's failure stage (scan S2)", () => {
  const noSheet = (failureStage?: string) =>
    ({
      corners: null,
      cornersSeen: 0,
      cornersFound: [false, false, false, false],
      partialCorners: [null, null, null, null],
      minSideCoverage: 0,
      edgeFitResidualPx: 0,
      worstSideIndex: null,
      paperRegionFound: false,
      ...(failureStage ? { failureStage } : {}),
    }) as never;

  // V3.2 F17: with a hand in the photo and no sheet, the detector looks a
  // second time with the palm (palmChoice.ts); its answer is used only when
  // it chose another bright region, which these mocked answers never say.
  const palmLook = () => {
    const calls = vi.mocked(detectPaperQuad).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).not.toHaveProperty("palmPointsPx");
    expect(calls[1][2]?.palmPointsPx).toHaveLength(5);
  };

  it("names the stage in the English message and the detail, keeps the code; the detector looks once more with the palm (F17)", async () => {
    arrange("right");
    vi.mocked(detectPaperQuad).mockReturnValue(noSheet("region_split"));
    const result = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true },
    );
    palmLook();
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("PAPER_NOT_FOUND");
    expect(result.errors[0]!.detail).toEqual({
      kind: "paperStage",
      stage: "region_split",
    });
    expect(result.errors[0]!.message).toBe(paperStageCopyEn.regionSplit.retake);
    expect(result.diagnostics?.paper?.failureStage).toBe("region_split");
    expect(result.diagnostics?.paper?.gateFailures).toEqual([
      "PAPER_NOT_FOUND",
    ]);
  });

  it("without a stage, the failure is exactly what it was", async () => {
    arrange("right");
    vi.mocked(detectPaperQuad).mockReturnValue(noSheet());
    const result = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true },
    );
    palmLook();
    if (result.status !== "error") throw new Error("expected an error");
    expect(result.errors[0]).toEqual({
      code: "PAPER_NOT_FOUND",
      message:
        "We couldn't find a sheet of paper in this photo — place a blank A4 (or Letter) sheet flat on a plain, contrasting surface and retake.",
    });
    expect(result.diagnostics?.paper?.failureStage).toBeNull();
  });

  it("F17: no hand in the photo: the detector is asked once, as before", async () => {
    arrange("right");
    vi.mocked(detectHandLandmarks).mockResolvedValue(null);
    vi.mocked(detectPaperQuad).mockReturnValue(noSheet("region_split"));
    const result = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true },
    );
    expect(vi.mocked(detectPaperQuad)).toHaveBeenCalledTimes(1);
    if (result.status !== "error") throw new Error("expected an error");
    expect(result.errors[0]!.code).toBe("PAPER_NOT_FOUND");
    expect(result.diagnostics).not.toHaveProperty("paperChoice");
  });

  it("F17: the second look took the region that holds the palm (the window case): measured from it, and the record says why", async () => {
    arrange("right");
    // arrange's own answer: the whole A4 sheet filling the frame.
    const sheet = vi.mocked(detectPaperQuad)(
      {} as ImageData,
      "a4",
    ) as ReturnType<typeof detectPaperQuad>;
    expect(sheet.corners).not.toBeNull();
    vi.mocked(detectPaperQuad).mockClear();
    const choice = {
      reason: "palm" as const,
      candidates: 2,
      palmInside: 5,
      largestPalmInside: 0,
    };
    vi.mocked(detectPaperQuad).mockImplementation((_f, _p, options) =>
      options?.palmPointsPx
        ? { ...sheet, paperChoice: choice }
        : (noSheet("aspect_mismatch") as ReturnType<typeof detectPaperQuad>),
    );
    const result = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true },
    );
    palmLook();
    expect(result.status).toBe("ok");
    expect(result.diagnostics?.paperChoice).toEqual({ ...choice, used: true });
    expect(result.diagnostics?.paper?.paperRegionFound).toBe(true);
    expect(result.diagnostics?.paper?.failureStage).toBeNull();
    // ...and the local attempt log keeps why (never sent).
    const log = (r: typeof result) =>
      buildAttemptRecord({
        at: "2026-10-23T00:00:00.000Z",
        userAgent: "test",
        capture: {
          method: "canvas",
          photoWidth: WIDTH,
          photoHeight: HEIGHT,
          photoKb: 900,
          previewWidth: null,
          previewHeight: null,
        },
        outcome: { kind: "result", result: r },
      });
    expect(log(result).paperChoice).toEqual({ ...choice, used: true });
    // An attempt without a second look has no such field at all.
    vi.mocked(detectPaperQuad).mockReset();
    arrange("right");
    const plain = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true },
    );
    expect(log(plain)).not.toHaveProperty("paperChoice");
  });

  it("F17: a second look that kept the largest region is recorded, not used", async () => {
    arrange("right");
    const choice = {
      reason: "no_candidate_holds_palm" as const,
      candidates: 2,
      palmInside: 0,
      largestPalmInside: 0,
    };
    vi.mocked(detectPaperQuad).mockImplementation((_f, _p, options) => ({
      ...(noSheet("aspect_mismatch") as ReturnType<typeof detectPaperQuad>),
      ...(options?.palmPointsPx ? { paperChoice: choice } : {}),
    }));
    const result = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true },
    );
    palmLook();
    if (result.status !== "error") throw new Error("expected an error");
    expect(result.diagnostics?.paperChoice).toEqual({
      ...choice,
      used: false,
    });
    expect(result.diagnostics?.paper?.failureStage).toBe("aspect_mismatch");
  });

  it("a found sheet that holds the palm still calls the detector once and carries no stage", async () => {
    arrange("right");
    const result = await run(
      { method: "paper-edge", paperSize: "a4" },
      { handExplicit: true },
    );
    expect(vi.mocked(detectPaperQuad)).toHaveBeenCalledTimes(1);
    expect(result.diagnostics?.paper?.failureStage).toBeNull();
  });
});
