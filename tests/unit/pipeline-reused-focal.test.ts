/**
 * F10 item 2 (R6 F1, candidate): the REAL `runPhotoPipeline` with a placed
 * frame and the automatic run's focal length (`reusedFocal`). Only the
 * browser-bound inputs are faked (decode, MediaPipe, the paper detector, the
 * canvas), as in pipeline-manual-corners.test.ts. The scene is R6's tilted
 * frame with no EXIF (helpers/r6-scene.ts). SIMULATED (模擬).
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
import { detectPaperQuad } from "../../src/client/paper/detect";
import {
  runPhotoPipeline,
  type PipelineResult,
  type RunPhotoPipelineInput,
} from "../../src/client/photo/pipeline";
import { reusableFocal } from "../../src/client/camera/paperAdjustState";
import type { Quad4 } from "../../src/client/paper/manualQuad";
import { buildR6Scene } from "./helpers/r6-scene";

// F17: a lens near the 998 px prior (Kirby's S25 estimates read 894-1153 px, 實測).
const FRAME = { w: 1080, h: 1920, f: 1050 };
const SCENE = buildR6Scene({ ...FRAME, pitchDeg: 10, rollDeg: 3 });

function arrange() {
  vi.mocked(decodePhoto).mockResolvedValue({
    bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    width: FRAME.w,
    height: FRAME.h,
  });
  const corners = SCENE.corners.map((p) => ({ x: p.x, y: p.y })) as [
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
    landmarksPx: SCENE.raisedPx.map((p) => ({ x: p.x, y: p.y })),
    handedness: "right",
    confidence: 0.95,
  });
}

function run(extra: Partial<RunPhotoPipelineInput> = {}) {
  return runPhotoPipeline({
    // No EXIF: a frame of the video.
    file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "f.jpg", {
      type: "image/jpeg",
    }),
    hand: "right",
    handExplicit: false,
    calibration: { method: "paper-edge", paperSize: "a4" },
    ...extra,
  });
}

function ok(result: PipelineResult) {
  expect(result.status, JSON.stringify(result)).toBe("ok");
  if (result.status !== "ok") throw new Error("not ok");
  return result;
}

const nudge = (q: Quad4, index: number, dx: number): Quad4 =>
  q.map((p, i) =>
    i === index ? { x: p.x + dx, y: p.y } : { x: p.x, y: p.y },
  ) as unknown as Quad4;

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

describe("a placed frame keeps the automatic run's focal length (real pipeline)", () => {
  it("same corners: same numbers within 0.1 mm, still parallax-corrected, from the same focal length", async () => {
    arrange();
    const auto = ok(await run());
    expect(auto.diagnostics?.focal?.source).toBe("homography");
    expect(auto.submission.calibration).toMatchObject({
      parallaxCorrected: true,
    });
    const reusedFocal = reusableFocal(auto.diagnostics?.focal);
    expect(reusedFocal).not.toBeNull();
    vi.clearAllMocks();
    arrange();
    const placed = ok(
      await run({
        manualPaperCorners: { corners: SCENE.corners, source: "adjusted" },
        reusedFocal,
      }),
    );
    expect(detectPaperQuad).not.toHaveBeenCalled();
    expect(
      Math.abs(
        placed.measurements.handLengthMm - auto.measurements.handLengthMm,
      ),
    ).toBeLessThan(0.1);
    expect(
      Math.abs(placed.measurements.palmWidthMm - auto.measurements.palmWidthMm),
    ).toBeLessThan(0.1);
    expect(placed.submission.calibration).toMatchObject({
      parallaxCorrected: true,
      cornersSource: "adjusted",
    });
    expect(placed.diagnostics?.focal).toEqual(auto.diagnostics?.focal);
  });

  it("one corner moved 1-5 px: the correction stays on", async () => {
    arrange();
    const auto = ok(await run());
    const reusedFocal = reusableFocal(auto.diagnostics?.focal);
    for (const px of [1, 3, 5]) {
      arrange();
      const placed = ok(
        await run({
          manualPaperCorners: {
            corners: nudge(SCENE.corners, 2, px),
            source: "adjusted",
          },
          reusedFocal,
        }),
      );
      expect(placed.submission.calibration).toMatchObject({
        parallaxCorrected: true,
      });
      expect(placed.diagnostics?.focal?.px).toBe(auto.diagnostics?.focal?.px);
    }
  });

  it("the automatic run ignores reusedFocal: its numbers are what they were", async () => {
    arrange();
    const plain = ok(await run());
    arrange();
    const given = ok(
      await run({ reusedFocal: { fPx: 777, source: "homography" } }),
    );
    expect(given.measurements).toEqual(plain.measurements);
    expect(given.diagnostics?.focal).toEqual(plain.diagnostics?.focal);
  });
});

describe("a failed photo's rough quad (F10 item 3, real pipeline)", () => {
  it("the detector is asked for it once, and it reaches the overlay as paperGuessCorners; nothing is measured", async () => {
    arrange();
    const guess = SCENE.corners.map((p) => ({ x: p.x + 3, y: p.y - 2 })) as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    vi.mocked(detectPaperQuad).mockReturnValue({
      corners: null,
      cornersSeen: 0,
      cornersFound: [false, false, false, false],
      partialCorners: [null, null, null, null],
      minSideCoverage: 0,
      edgeFitResidualPx: 0,
      worstSideIndex: null,
      paperRegionFound: false,
      failureStage: "aspect_mismatch",
      guessCorners: guess,
    });
    const r = await run();
    expect(detectPaperQuad).toHaveBeenCalledTimes(1);
    expect(vi.mocked(detectPaperQuad).mock.calls[0][2]).toMatchObject({
      failureGuess: true,
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.errors[0].code).toBe("PAPER_NOT_FOUND");
    expect(r.overlay.paperGuessCorners).toEqual(guess);
    expect(r.overlay.paperCorners).toBeUndefined();
    expect(detectHandLandmarks).not.toHaveBeenCalled();
  });
});
