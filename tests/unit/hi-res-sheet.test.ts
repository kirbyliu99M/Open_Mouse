/**
 * Kirby 2026-10-27 (candidate 未拍板, "it must work the first time"): the
 * sheet looked for again at a higher resolution while the live sample misses
 * it, the shutter's paper check of the kept frames, and the frame the person
 * adjusts starting on a sheet already found (hiResSheet.ts). Scenes are
 * SIMULATED (模擬); Kirby's two S25 photos were checked by hand in the
 * session (both found at 1280, both passing the gate), not committed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cornersToSize,
  hiResSize,
  precheckOrder,
  scaleDetection,
  sheetPasses,
  shouldConfirmHiRes,
} from "@/client/camera/hiResSheet";
import { CAMERA_CONSTANTS } from "@/client/camera/constants";
import { evaluateLivePaperGate } from "@/client/camera/paperGate";
import { NO_QUAD_DETECTION } from "@/client/camera/quad-source";
import { detectPaperQuad } from "@/client/paper/detect";
import {
  renderIndependentScene,
  type IndependentScene,
} from "./helpers/independent-scene";

const SCENE: IndependentScene = {
  frameWidth: 750,
  frameHeight: 1000,
  paperWidthMm: 210,
  paperHeightMm: 297,
  background: "midGrey",
  seed: 7,
};

const asImage = (r: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}) =>
  ({ width: r.width, height: r.height, data: r.data }) as unknown as ImageData;

const cut = { ...NO_QUAD_DETECTION, failureStage: "aspect_mismatch" as const };
const confirm = (over: Partial<Parameters<typeof shouldConfirmHiRes>[0]>) =>
  shouldConfirmHiRes({
    detection: cut,
    handSeen: true,
    inFlight: false,
    lastAtMs: null,
    nowMs: 1000,
    intervalMs: 500,
    ...over,
  });

describe("the sheet looked for at a higher resolution (Kirby's S25 photos, 2026-10-27)", () => {
  it("a long edge of 1280, at most every 500 ms (candidates)", () => {
    expect(CAMERA_CONSTANTS.autoCapture.hiResLongEdgePx).toBe(1280);
    expect(CAMERA_CONSTANTS.autoCapture.hiResIntervalMs).toBe(500);
  });

  it("only after a miss the forearm or a bright neighbour causes, with the hand seen, one at a time", () => {
    expect(confirm({})).toBe(true);
    expect(confirm({ lastAtMs: 600 })).toBe(false);
    expect(confirm({ lastAtMs: 500 })).toBe(true);
    expect(confirm({ inFlight: true })).toBe(false);
    expect(confirm({ handSeen: false })).toBe(false);
    expect(
      confirm({
        detection: { ...NO_QUAD_DETECTION, failureStage: "no_bright_region" },
      }),
    ).toBe(false);
  });

  it("the live sample's shape at 1280, and the factor back to it", () => {
    const size = hiResSize({ width: 342, height: 640 }, 1280);
    expect(size).toMatchObject({ width: 684, height: 1280 });
    expect(size.toSample).toBeCloseTo(0.5, 6);
    // Never smaller than the sample.
    expect(hiResSize({ width: 342, height: 640 }, 320).width).toBe(342);
  });

  it("a sheet found at twice the size, scaled to the sample, passes the live gate where the sample's own does", () => {
    const big = renderIndependentScene(SCENE);
    const found = detectPaperQuad(asImage(big), "a4");
    expect(sheetPasses(found, "a4")).toBe(true);
    const half = scaleDetection(found, 0.5);
    expect(half.corners?.[2].x).toBeCloseTo((found.corners?.[2].x ?? 0) / 2, 6);
    expect(half.edgeFitResidualPx).toBeCloseTo(found.edgeFitResidualPx / 2, 6);
    expect(evaluateLivePaperGate(half, "a4").kind).toBe("pass");
  });

  it("a miss does not pass", () => {
    expect(sheetPasses(cut, "a4")).toBe(false);
  });
});

describe("the shutter's paper check and the frame the person adjusts", () => {
  it("frames are checked sharpest first; a score that is not a number last", () => {
    expect(precheckOrder([30, 52, 41])).toEqual([1, 2, 0]);
    expect(precheckOrder([Number.NaN, 20])).toEqual([1, 0]);
  });

  it("corners move from the sample to the photo of the same region", () => {
    const q = cornersToSize(
      [
        { x: 10, y: 20 },
        { x: 300, y: 20 },
        { x: 300, y: 600 },
        { x: 10, y: 600 },
      ],
      { width: 342, height: 640 },
      { width: 1026, height: 1920 },
    );
    expect(q[2]).toEqual({ x: 900, y: 1800 });
  });

  it("the shutter checks the kept frames, hands a found sheet to the analysis, and the rescue frame starts on it", () => {
    const camera = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(camera).toContain("const checked = await precheckFrames(");
    expect(camera).toContain("const chosen = checked.index ?? sharpest;");
    expect(camera).toContain("checked.corners ?? liveSheetOnPhoto(pick)");
    expect(camera).toContain(
      "...(knownSheetCorners ? { knownSheetCorners } : {}),",
    );
    const pipeline = readFileSync("src/client/photo/pipeline.ts", "utf8");
    expect(pipeline).toMatch(
      /const guess = input\.knownSheetCorners\s*\?\s*input\.knownSheetCorners/,
    );
  });
});
