import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  nextBestFrame,
  pickSharpestScore,
  type BestFrameSample,
  type BestFrameState,
} from "@/client/camera/bestFrame";
import { CAMERA_CONSTANTS } from "@/client/camera/constants";

const sample = (over: Partial<BestFrameSample>): BestFrameSample => ({
  variance: 30,
  atMs: 0,
  passing: true,
  ringElapsedMs: 2000,
  ringDurationMs: 2500,
  windowMs: 1000,
  keep: 3,
  ...over,
});

/** Feeds samples one after another from no kept frames. */
const feed = (samples: readonly Partial<BestFrameSample>[]) =>
  samples.reduce<readonly BestFrameState[]>(
    (kept, s) => nextBestFrame(kept, sample(s)).kept,
    [],
  );

describe("the sharpest frames of the ring's last second (Kirby's S25 tests, 2026-10-26/27)", () => {
  it("the ring lasts 2.5 s, frames come from its last 1 s, 3 are kept (candidates)", () => {
    expect(CAMERA_CONSTANTS.autoCapture.durationMs).toBe(2500);
    expect(CAMERA_CONSTANTS.autoCapture.bestFrameWindowMs).toBe(1000);
    expect(CAMERA_CONSTANTS.autoCapture.bestFrameKeep).toBe(3);
  });

  it("frames before the window are not kept: a hint may just have made the person move", () => {
    expect(nextBestFrame([], sample({ ringElapsedMs: 1400 })).keepThis).toBe(
      false,
    );
    expect(nextBestFrame([], sample({ ringElapsedMs: 1500 })).keepThis).toBe(
      true,
    );
  });

  it("keeps the 3 sharpest by the live number, sharpest first, and names the one it drops", () => {
    const kept = feed([
      { variance: 30, atMs: 1 },
      { variance: 20, atMs: 2 },
      { variance: 40, atMs: 3 },
    ]);
    expect(kept.map((k) => k.atMs)).toEqual([3, 1, 2]);
    // Not sharper than the weakest: not kept, nothing dropped.
    expect(nextBestFrame(kept, sample({ variance: 20, atMs: 4 }))).toEqual({
      kept,
      keepThis: false,
      dropped: [],
    });
    const step = nextBestFrame(kept, sample({ variance: 35, atMs: 5 }));
    expect(step.keepThis).toBe(true);
    expect(step.kept.map((k) => k.atMs)).toEqual([3, 5, 1]);
    expect(step.dropped).toEqual([2]);
  });

  it("a failing sample keeps the frames (the ring only paused); an empty ring forgets them all", () => {
    const kept = feed([
      { variance: 40, atMs: 1 },
      { variance: 30, atMs: 2 },
    ]);
    expect(
      nextBestFrame(kept, sample({ passing: false, variance: 99 })),
    ).toEqual({ kept, keepThis: false, dropped: [] });
    expect(nextBestFrame(kept, sample({ ringElapsedMs: 0 }))).toEqual({
      kept: [],
      keepThis: false,
      dropped: [1, 2],
    });
  });

  it("a variance that is not a number is never kept", () => {
    expect(nextBestFrame([], sample({ variance: Number.NaN })).keepThis).toBe(
      false,
    );
  });

  it("the shot takes the highest full-size score; none that is a number → null", () => {
    expect(pickSharpestScore([36, 52.5, 44])).toBe(1);
    expect(pickSharpestScore([Number.NaN, 20])).toBe(1);
    expect(pickSharpestScore([Number.NaN])).toBeNull();
    expect(pickSharpestScore([])).toBeNull();
  });

  it("the scan page uses it only for the ring's shot, scored at full size; a tap takes the frame of that moment", () => {
    const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(source).toMatch(/shutter === "auto"\s*\?\s*live\.map/);
    expect(source).toContain("nextBestFrame(bestFramesRef.current, {");
    expect(source).toContain(
      "keep: CAMERA_CONSTANTS.autoCapture.bestFrameKeep",
    );
    expect(source).toContain("kept.map((b) => fullScore(canvas, b))");
    expect(source).toMatch(
      /resetLoopState = useCallback\(\(\) => \{[\s\S]*?bestFramesRef\.current = \[\];[\s\S]*?releaseBitmaps\(bestBitmapsRef\.current\);/,
    );
  });
});
