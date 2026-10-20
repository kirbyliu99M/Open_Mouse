/**
 * Scan S3 (shadow mode, 未拍板 candidate): the hand-flatness reading in the
 * pipeline's diagnostics, on all three calibrations (printed sheet, blank
 * paper, typed hand length), with the same faked browser parts as
 * tests/unit/pipeline-hand.test.ts. It checks that the reading is taken from
 * the one detection that already happens (the detector is called once, as
 * before), that it is there for rejected photos too, that nothing the pipeline
 * decides or measures changes with it, and that only a grade and two ratios
 * (never a landmark) are carried.
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
vi.mock("../../src/client/photo/handFlatness", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/client/photo/handFlatness")
    >();
  return { ...actual, assessHandFlatness: vi.fn(actual.assessHandFlatness) };
});

import { decodePhoto } from "../../src/client/photo/decode";
import { detectHandLandmarks } from "../../src/client/photo/landmarks";
import { detectMarkers } from "../../src/client/photo/markers";
import { detectCardCorners } from "../../src/client/photo/card";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { assessHandFlatness } from "../../src/client/photo/handFlatness";
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

/** The reading the shipped function gives for these landmarks, beside the spy. */
async function actualAssess(landmarks: readonly { x: number; y: number }[]) {
  const actual = await vi.importActual<
    typeof import("../../src/client/photo/handFlatness")
  >("../../src/client/photo/handFlatness");
  return actual.assessHandFlatness(landmarks);
}

/** Everything the pipeline decided, without its diagnostics (timings differ run to run). */
function decision(result: Awaited<ReturnType<typeof run>>) {
  return { ...result, diagnostics: undefined };
}

describe.each(CALIBRATIONS)("$name pipeline", ({ calibration }) => {
  it("reads the flatness of the one detection, with no second detector call", async () => {
    arrange("right");
    const result = await run(calibration, { handExplicit: true });
    expect(result.status).toBe("ok");
    expect(vi.mocked(detectHandLandmarks)).toHaveBeenCalledTimes(1);
    const flatness = result.diagnostics?.hand.flatness;
    expect(flatness).toEqual(await actualAssess(LANDMARKS_PX));
    expect(flatness?.pose).not.toBe("unknown");
    expect(Number.isFinite(flatness?.reachMean)).toBe(true);
    expect(Number.isFinite(flatness?.fingerStraightMin)).toBe(true);
    // Read once, off the landmarks the detector returned.
    expect(vi.mocked(assessHandFlatness)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(assessHandFlatness).mock.calls[0][0]).toBe(LANDMARKS_PX);
  });

  it("carries a grade and two ratios and nothing else of the hand", async () => {
    arrange("right");
    const result = await run(calibration, { handExplicit: true });
    const hand = result.diagnostics!.hand;
    expect(Object.keys(hand).sort()).toEqual([
      "confidence",
      "detected",
      "flatness",
      "handedness",
    ]);
    expect(Object.keys(hand.flatness!).sort()).toEqual([
      "fingerStraightMin",
      "pose",
      "reachMean",
    ]);
    expect(JSON.stringify(hand)).not.toMatch(/landmark|world|"z"/i);
  });

  it("changes nothing the pipeline decides or measures, whatever the grade", async () => {
    arrange("right");
    const flat = await run(calibration, { handExplicit: true });
    expect(flat.status).toBe("ok");
    for (const pose of [
      "flat_like",
      "borderline",
      "extreme",
      "unknown",
    ] as const) {
      arrange("right");
      vi.mocked(assessHandFlatness).mockReturnValueOnce({
        pose,
        reachMean: pose === "unknown" ? null : 0.1,
        fingerStraightMin: pose === "unknown" ? null : 0.5,
      });
      const other = await run(calibration, { handExplicit: true });
      expect(other.diagnostics?.hand.flatness?.pose, pose).toBe(pose);
      expect(decision(other), pose).toEqual(decision(flat));
      expect(other.diagnostics?.measured, pose).toEqual(
        flat.diagnostics?.measured,
      );
    }
  });

  it("is in the record of a rejected photo too", async () => {
    arrange("left");
    const result = await run(calibration, {
      hand: "right",
      handExplicit: true,
    });
    expect(result.status).toBe("error");
    expect(result.diagnostics?.hand.detected).toBe(true);
    expect(result.diagnostics?.hand.flatness?.pose).not.toBe("unknown");
    expect(result.diagnostics?.hand.flatness?.reachMean).not.toBeNull();
  });

  it("is null when no hand was found, and nothing throws", async () => {
    arrange("right");
    vi.mocked(detectHandLandmarks).mockResolvedValue(null);
    const result = await run(calibration, { handExplicit: true });
    expect(result.status).toBe("error");
    expect(result.diagnostics?.hand).toEqual({
      detected: false,
      confidence: null,
      handedness: null,
      flatness: null,
    });
    expect(vi.mocked(assessHandFlatness)).not.toHaveBeenCalled();
  });

  it("an unusable hand (20 points) is unknown with no numbers, and the scan carries on to its own error", async () => {
    arrange("right");
    vi.mocked(detectHandLandmarks).mockResolvedValue({
      landmarksPx: LANDMARKS_PX.slice(0, 20),
      handedness: "right",
      confidence: 0.95,
    });
    const result = await run(calibration, { handExplicit: true });
    expect(result.status).toBe("error");
    expect(result.diagnostics?.hand.flatness).toEqual({
      pose: "unknown",
      reachMean: null,
      fingerStraightMin: null,
    });
  });

  it("a point that is not a number is unknown, and the pipeline still answers", async () => {
    arrange("right");
    const bad = LANDMARKS_PX.map((p, i) =>
      i === 7 ? { x: Number.NaN, y: p.y } : p,
    );
    vi.mocked(detectHandLandmarks).mockResolvedValue({
      landmarksPx: bad,
      handedness: "right",
      confidence: 0.95,
    });
    const result = await run(calibration, { handExplicit: true });
    expect(result.diagnostics?.hand.flatness?.pose).toBe("unknown");
  });
});

describe("the fixture's acceptance and millimetres are those the pipeline always gave", () => {
  it.each(CALIBRATIONS)("$name: ok, 190 mm long", async ({ calibration }) => {
    arrange("right");
    const result = await run(calibration, { handExplicit: true });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.measurements.handLengthMm).toBeCloseTo(190, 6);
    expect(result.diagnostics?.measured).toEqual({
      handLengthMm: result.measurements.handLengthMm,
      palmWidthMm: result.measurements.palmWidthMm,
    });
  });
});

describe("the paper block carries the four side coverages and the worst side (blank paper)", () => {
  const paper = { method: "paper-edge", paperSize: "a4" } as const;
  const corners = [
    { x: 0, y: 0 },
    { x: WIDTH, y: 0 },
    { x: WIDTH, y: HEIGHT },
    { x: 0, y: HEIGHT },
  ] as const;
  function withSides(
    sideCoverages: readonly [number, number, number, number] | undefined,
    minSideCoverage: number,
  ) {
    arrange("right");
    vi.mocked(detectPaperQuad).mockReturnValue({
      corners,
      cornersSeen: 4,
      cornersFound: [true, true, true, true],
      partialCorners: corners,
      minSideCoverage,
      edgeFitResidualPx: 0.3,
      worstSideIndex: 0,
      paperRegionFound: true,
      ...(sideCoverages ? { sideCoverages } : {}),
    });
  }

  it("a photo refused for a hidden edge says which edge", async () => {
    withSides([1, 1, 1, 0.225], 0.225);
    const result = await run(paper, { handExplicit: true });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errors.map((e) => e.code)).toContain("PAPER_EDGE_HIDDEN");
    expect(result.diagnostics?.paper?.sideCoverages).toEqual([1, 1, 1, 0.225]);
    expect(result.diagnostics?.paper?.worstSide).toBe("left");
  });

  it("a measured photo carries them too", async () => {
    withSides([1, 0.9, 1, 1], 0.9);
    const result = await run(paper, { handExplicit: true });
    expect(result.status).toBe("ok");
    expect(result.diagnostics?.paper?.sideCoverages).toEqual([1, 0.9, 1, 1]);
    expect(result.diagnostics?.paper?.worstSide).toBe("right");
  });

  it("a detection without them (or with nothing hidden) leaves null, and nothing else changes", async () => {
    withSides(undefined, 1);
    const plain = await run(paper, { handExplicit: true });
    expect(plain.diagnostics?.paper?.sideCoverages).toBeNull();
    expect(plain.diagnostics?.paper?.worstSide).toBeNull();
    withSides([1, 1, 1, 1], 1);
    const full = await run(paper, { handExplicit: true });
    expect(full.diagnostics?.paper?.worstSide).toBeNull();
    expect({ ...full, diagnostics: undefined }).toEqual({
      ...plain,
      diagnostics: undefined,
    });
  });

  it("is there when the sheet's corners were not all found (no name without them)", async () => {
    arrange("right");
    vi.mocked(detectPaperQuad).mockReturnValue({
      corners: null,
      cornersSeen: 3,
      cornersFound: [true, true, true, false],
      partialCorners: [corners[0], corners[1], corners[2], null],
      minSideCoverage: 0,
      edgeFitResidualPx: 0.3,
      worstSideIndex: 0,
      paperRegionFound: true,
      sideCoverages: [1, 1, 1, 0],
    });
    const result = await run(paper, { handExplicit: true });
    expect(result.status).toBe("error");
    expect(result.diagnostics?.paper?.sideCoverages).toEqual([1, 1, 1, 0]);
    expect(result.diagnostics?.paper?.worstSide).toBeNull();
  });
});
