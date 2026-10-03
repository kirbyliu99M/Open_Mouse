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
    bitmap: {} as ImageBitmap,
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
