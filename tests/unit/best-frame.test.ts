import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextBestFrame, type BestFrameSample } from "@/client/camera/bestFrame";
import { CAMERA_CONSTANTS } from "@/client/camera/constants";

const sample = (over: Partial<BestFrameSample>): BestFrameSample => ({
  variance: 30,
  atMs: 0,
  passing: true,
  ringElapsedMs: 2000,
  ringDurationMs: 2500,
  windowMs: 1000,
  ...over,
});

describe("the sharpest frame of the ring's last second (Kirby's S25 test, 2026-10-26)", () => {
  it("the ring lasts 2.5 s and frames come from its last 1 s (candidates)", () => {
    expect(CAMERA_CONSTANTS.autoCapture.durationMs).toBe(2500);
    expect(CAMERA_CONSTANTS.autoCapture.bestFrameWindowMs).toBe(1000);
  });

  it("frames before the window are not kept: a hint may just have made the person move", () => {
    expect(nextBestFrame(null, sample({ ringElapsedMs: 1400 })).keepThis).toBe(
      false,
    );
    expect(nextBestFrame(null, sample({ ringElapsedMs: 1500 })).keepThis).toBe(
      true,
    );
  });

  it("keeps a sharper frame, not an equal or blurrier one", () => {
    let best = nextBestFrame(null, sample({ variance: 30, atMs: 1 })).best;
    let step = nextBestFrame(best, sample({ variance: 29, atMs: 2 }));
    expect(step.keepThis).toBe(false);
    expect(step.best).toEqual({ variance: 30, atMs: 1 });
    step = nextBestFrame(best, sample({ variance: 30, atMs: 3 }));
    expect(step.keepThis).toBe(false);
    step = nextBestFrame(best, sample({ variance: 41, atMs: 4 }));
    expect(step.keepThis).toBe(true);
    best = step.best;
    expect(best).toEqual({ variance: 41, atMs: 4 });
  });

  it("a failing sample keeps the frame (the ring only paused); an empty ring forgets it", () => {
    const best = { variance: 40, atMs: 1 };
    expect(
      nextBestFrame(best, sample({ passing: false, variance: 99 })),
    ).toEqual({ best, keepThis: false });
    expect(nextBestFrame(best, sample({ ringElapsedMs: 0 }))).toEqual({
      best: null,
      keepThis: false,
    });
  });

  it("a variance that is not a number is never kept", () => {
    expect(nextBestFrame(null, sample({ variance: Number.NaN })).keepThis).toBe(
      false,
    );
  });

  it("the scan page uses it only for the ring's shot; a tap takes the frame of that moment", () => {
    const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(source).toContain(
      'shutter === "auto" && bestFrameRef.current !== null',
    );
    expect(source).toContain("nextBestFrame(bestFrameRef.current, {");
    expect(source).toMatch(
      /resetLoopState = useCallback\(\(\) => \{[\s\S]*?bestFrameRef\.current = null;/,
    );
  });
});
