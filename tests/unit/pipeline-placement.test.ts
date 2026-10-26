/**
 * V3.3 WP1b (log only, 未拍板 candidate): the placement record in the
 * pipeline's diagnostics, with the same faked browser parts as
 * tests/unit/pipeline-hand-flatness.test.ts. It is there only on a measured
 * blank-paper scan, it carries the research shadowRing and its time, and
 * nothing the pipeline decides or measures changes with MediaPipe's world
 * landmarks and z. Geometry: 3 px per mm, so the homography is exactly 1/3.
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
} from "../../src/client/photo/pipeline";
import { computeSheetLayout } from "../../src/client/sheet/layout";
import { ID1_CARD_MM, SHEET } from "../../src/lib/contracts/measurement";

const S = 3;
const WIDTH = 210 * S;
const HEIGHT = 297 * S;
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
// Wrist near the bottom of the sheet, fingers up.
const LANDMARKS_PX = HAND_MM.map(([x, y]) => ({
  x: (x - 30) * S,
  y: (280 - y) * S,
}));
const WORLD = Array.from({ length: 21 }, (_, i) => ({
  x: 0.004 * (i % 5),
  y: -0.009 * Math.floor(i / 5) - 0.001 * i,
  z: 0.0002 * i,
}));
const Z = Array.from({ length: 21 }, (_, i) => -0.001 * i);

function arrange(withWorld: boolean) {
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: () => undefined } as unknown as ImageBitmap,
    width: WIDTH,
    height: HEIGHT,
  });
  vi.mocked(detectHandLandmarks).mockResolvedValue({
    landmarksPx: LANDMARKS_PX,
    handedness: "right",
    confidence: 0.95,
    ...(withWorld ? { worldLandmarks: WORLD, landmarkZ: Z } : {}),
  });
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

function run(calibration: CalibrationInput | undefined) {
  return runPhotoPipeline({
    file: new File([new Uint8Array([1, 2, 3])], "hand.jpg", {
      type: "image/jpeg",
    }),
    hand: "right",
    handExplicit: true,
    calibration,
  });
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

const PAPER: CalibrationInput = { method: "paper-edge", paperSize: "a4" };

describe("the pipeline's placement record", () => {
  it("is there on a measured blank-paper scan, with the shadowRing and its time", async () => {
    arrange(true);
    const result = await run(PAPER);
    expect(result.status).toBe("ok");
    expect(vi.mocked(detectHandLandmarks)).toHaveBeenCalledTimes(1);
    const p = result.diagnostics!.placement!;
    expect(p).toBeDefined();
    expect(p.placement.wristEdge).toBe("near-bottom");
    expect(p.placement.wristToEdgeMm).not.toBeNull();
    // A flat grey frame: the ring is as bright as the sheet.
    expect(p.shadowRing).toBe(1);
    expect(typeof p.shadowRingMs).toBe("number");
    expect(p.world.planarityRmsMm).not.toBeNull();
    expect(p.zWristMinusMcp).not.toBeNull();
    // Summary numbers only.
    expect(JSON.stringify(p)).not.toMatch(/landmarks|"x"|"y"|"z"/);
  });

  it("changes nothing the pipeline decides or measures", async () => {
    arrange(false);
    const plain = await run(PAPER);
    arrange(true);
    const withWorld = await run(PAPER);
    expect({ ...withWorld, diagnostics: undefined }).toStrictEqual({
      ...plain,
      diagnostics: undefined,
    });
    expect(withWorld.diagnostics?.measured).toStrictEqual(
      plain.diagnostics?.measured,
    );
    expect(withWorld.diagnostics?.hand).toStrictEqual(plain.diagnostics?.hand);
    expect(withWorld.diagnostics?.focal).toStrictEqual(
      plain.diagnostics?.focal,
    );
  });

  it.each([
    ["printed sheet", undefined],
    ["typed hand length", { method: "user-length", handLengthMm: 190 }],
  ] as const)("is absent on the %s path", async (_name, calibration) => {
    arrange(true);
    const result = await run(calibration as CalibrationInput | undefined);
    expect(result.status).toBe("ok");
    expect("placement" in (result.diagnostics ?? {})).toBe(false);
  });
});
