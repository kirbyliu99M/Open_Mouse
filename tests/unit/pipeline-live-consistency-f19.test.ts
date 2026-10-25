/**
 * V3.2 F19 review (2026-10-25): the live viewfinder and the photo pipeline
 * judge the same picture by one detection (brief: 即時預覽與拍後分析用同一套偵測).
 * The REAL paper detector runs on rendered scenes (all SIMULATED, 模擬,
 * `helpers/f19-hand-scenes.ts`); only decode, MediaPipe and the canvas are
 * faked, the canvas handing over the scene's pixels.
 *
 * The live path here is what EasyScanCamera does with a fresh hand reading:
 * `livePalmHint` + `liveHandHint` into `detectPaperQuad`, judged by the same
 * paper gates (`evaluatePaperEdgeCalibration`). The pipeline path is
 * `runPhotoPipeline`. They must give the same edge fit and the same failed
 * paper gates.
 *
 * Scenes from the review (模擬):
 * - the bottom side curled 6 / 12 mm under a pale arm: before, the photo's
 *   unmasked first call passed and was measured while the preview, masked,
 *   read PAPER_CURLED;
 * - a pale arm at the sheet's bottom edge (wrist y = 290 mm, arm 85°): before,
 *   the unmasked first call passed with corners about 32 mm off and was
 *   measured; masked, the corners are within 1 px.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/photo/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/photo/decode")>()),
  decodePhoto: vi.fn(),
}));
vi.mock("../../src/client/photo/landmarks", () => ({
  detectHandLandmarks: vi.fn(),
}));

import { decodePhoto } from "../../src/client/photo/decode";
import { detectHandLandmarks } from "../../src/client/photo/landmarks";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { evaluatePaperEdgeCalibration } from "../../src/client/paper/calibration";
import { runPhotoPipeline } from "../../src/client/photo/pipeline";
import {
  liveHandHint,
  livePalmHint,
} from "../../src/client/camera/noSheetCapture";
import {
  renderHandScene,
  type HandScene,
  type HandSceneOptions,
} from "./helpers/f19-hand-scenes";

const PALE: readonly [number, number, number] = [236, 218, 204];

/** `paper-covered-edges-f19.test.ts`'s pale arm over the bottom edge. */
const ARM_OVER_BOTTOM: HandSceneOptions = {
  wristMm: { x: 80, y: 280 },
  handDeg: 30,
  armDeg: 85,
  skinRgb: PALE,
  shadowMm: 20,
  shadowDarkest: 0.5,
  shadowOffsetMm: { x: 0, y: -20 },
};

let current: HandScene;

function arrange(scene: HandScene) {
  current = scene;
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: () => undefined } as unknown as ImageBitmap,
    width: scene.width,
    height: scene.height,
  });
  vi.mocked(detectHandLandmarks).mockResolvedValue({
    landmarksPx: scene.landmarksPx.map((p) => ({ x: p.x, y: p.y })),
    handedness: "right",
    confidence: 0.95,
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
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          if (w !== current.width || h !== current.height)
            throw new Error(`unexpected frame ${w}x${h}`);
          return {
            data: new Uint8ClampedArray(current.data),
            width: w,
            height: h,
          };
        },
      }),
    }),
  });
});

function frameOf(scene: HandScene): ImageData {
  return {
    width: scene.width,
    height: scene.height,
    data: new Uint8ClampedArray(scene.data),
  } as unknown as ImageData;
}

/** What the live viewfinder does with this frame and a fresh hand reading. */
function live(scene: HandScene) {
  const hint = {
    latest: { atMs: 1000, points: scene.landmarksPx },
    nowMs: 1100,
    width: scene.width,
    height: scene.height,
  };
  const palm = livePalmHint(hint);
  const hand = liveHandHint(hint);
  expect(hand).toBeDefined();
  const detection = detectPaperQuad(frameOf(scene), "a4", {
    ...(palm ? { palmPointsPx: palm } : {}),
    ...(hand ? { handLandmarksPx: hand } : {}),
  });
  const evaluation = evaluatePaperEdgeCalibration(detection, "a4", false);
  return {
    detection,
    codes: evaluation.errors.map((e) => e.code),
  };
}

async function pipeline(scene: HandScene) {
  arrange(scene);
  const result = await runPhotoPipeline({
    file: new File([new Uint8Array([1, 2, 3])], "hand.jpg", {
      type: "image/jpeg",
    }),
    hand: "right",
    handExplicit: true,
    calibration: { method: "paper-edge", paperSize: "a4" },
  });
  return result;
}

function cornerErrorPx(
  corners: readonly { x: number; y: number }[] | null,
  scene: HandScene,
): number | null {
  if (!corners) return null;
  return Math.max(
    ...corners.map((c, i) =>
      Math.hypot(c.x - scene.corners[i]!.x, c.y - scene.corners[i]!.y),
    ),
  );
}

const SCENES: readonly [string, HandSceneOptions][] = [
  [
    "the bottom side curled 6 mm under the arm",
    {
      ...ARM_OVER_BOTTOM,
      curl: { side: 2, amplitudeMm: 6 },
    },
  ],
  [
    "the bottom side curled 12 mm under the arm",
    {
      ...ARM_OVER_BOTTOM,
      curl: { side: 2, amplitudeMm: 12 },
    },
  ],
  ["a flat sheet, the arm over the bottom edge", ARM_OVER_BOTTOM],
  [
    "a pale arm at the bottom edge (wrist y 290 mm, arm 85°)",
    {
      wristMm: { x: 80, y: 290 },
      handDeg: 30,
      armDeg: 85,
      skinRgb: PALE,
      shadowMm: 20,
      shadowDarkest: 0.8,
    },
  ],
  [
    "the arm across the sheet (two pieces)",
    {
      wristMm: { x: 120, y: 150 },
      handDeg: 90,
    },
  ],
];

describe("F19 review — the live viewfinder and the photo judge the paper alike (模擬)", () => {
  it.each(SCENES)(
    "%s: the same edge fit and the same failed paper gates",
    async (_name, options) => {
      const scene = renderHandScene(options);
      const l = live(scene);
      const result = await pipeline(scene);
      const paper = result.diagnostics?.paper;
      expect(paper).toBeTruthy();
      expect([...paper!.gateFailures].sort()).toStrictEqual(
        [...l.codes].sort(),
      );
      expect(result.diagnostics?.paperEdgeFit?.edgeFit).toStrictEqual(
        l.detection.edgeFit,
      );
      expect(result.diagnostics?.paperEdgeFit?.edgeFit?.handMask).toBe(true);
      // A paper gate the preview failed is never measured from.
      if (l.codes.length > 0) expect(result.status).toBe("error");
    },
    60_000,
  );

  it("the bottom side curled 6 mm under the arm: PAPER_CURLED on both paths (before: the photo passed unmasked and was measured)", async () => {
    const scene = renderHandScene({
      ...ARM_OVER_BOTTOM,
      curl: { side: 2, amplitudeMm: 6 },
    });
    const result = await pipeline(scene);
    expect(result.diagnostics?.paper?.gateFailures).toContain("PAPER_CURLED");
    if (result.status !== "error") throw new Error("expected an error");
    expect(result.errors.map((e) => e.code)).toContain("PAPER_CURLED");
  }, 60_000);

  it("the pale arm at the bottom edge: the corners within 1 px (before: about 32 mm off, measured)", async () => {
    const scene = renderHandScene({
      wristMm: { x: 80, y: 290 },
      handDeg: 30,
      armDeg: 85,
      skinRgb: PALE,
      shadowMm: 20,
      shadowDarkest: 0.8,
    });
    // Without the hand the detector takes the arm's edge for the sheet's.
    const unmasked = detectPaperQuad(frameOf(scene), "a4");
    expect(cornerErrorPx(unmasked.corners, scene)!).toBeGreaterThan(50);
    const l = live(scene);
    expect(cornerErrorPx(l.detection.corners, scene)!).toBeLessThan(1);
    const result = await pipeline(scene);
    expect(result.diagnostics?.paperEdgeFit?.edgeFit).toStrictEqual(
      l.detection.edgeFit,
    );
    expect(result.diagnostics?.paper?.gateFailures).toStrictEqual([]);
  }, 60_000);
});

describe("F19 review — known limit at the pipeline (模擬, 未拍板: Kirby to decide)", () => {
  // The detector-level known limit (paper-covered-edges-f19.test.ts): the arm
  // hides the part of the bottom side that bows most, so with the hand's
  // points left out what is in sight is nearly straight. The pipeline now
  // makes ONE masked call, so such a sheet is not refused for curl and goes
  // on to be measured, exactly as the live preview would let it be taken.
  // Kept as a failing expectation so that a fix shows up.
  it.fails.each([4, 8])(
    "known limit: the bottom side curled %i mm next to the arm is refused PAPER_CURLED by the pipeline",
    async (amplitudeMm) => {
      const result = await pipeline(
        renderHandScene({
          ...ARM_OVER_BOTTOM,
          curl: { side: 2, amplitudeMm },
        }),
      );
      expect(result.diagnostics?.paper?.gateFailures).toContain("PAPER_CURLED");
    },
    60_000,
  );

  it("what it does today for 4 and 8 mm: no paper gate fails, the masked fit is the one recorded", async () => {
    for (const amplitudeMm of [4, 8]) {
      const result = await pipeline(
        renderHandScene({
          ...ARM_OVER_BOTTOM,
          curl: { side: 2, amplitudeMm },
        }),
      );
      expect(result.diagnostics?.paper?.gateFailures).toStrictEqual([]);
      expect(result.diagnostics?.paperEdgeFit?.edgeFit?.handMask).toBe(true);
    }
  }, 60_000);
});
