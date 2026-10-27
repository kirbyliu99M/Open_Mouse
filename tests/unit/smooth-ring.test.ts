import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { smoothRingFraction } from "@/client/camera/smoothRing";

const at = (over: Partial<Parameters<typeof smoothRingFraction>[0]>) =>
  smoothRingFraction({
    target: { fraction: 0.4, atMs: 1000, advancing: true },
    shown: 0.4,
    shownTarget: 0.4,
    nowMs: 1000,
    durationMs: 2500,
    leadMs: 250,
    reducedMotion: false,
    ...over,
  });

describe("the shutter ring drawn every frame (Kirby's S25 test, 2026-10-27)", () => {
  it("between passing samples it grows with time, at most leadMs ahead", () => {
    expect(at({ nowMs: 1100 })).toBeCloseTo(0.44, 6);
    expect(at({ nowMs: 1250 })).toBeCloseTo(0.5, 6);
    expect(at({ nowMs: 2000 })).toBeCloseTo(0.5, 6);
  });

  it("a failing sample holds what is drawn, never back", () => {
    expect(
      at({
        target: { fraction: 0.4, atMs: 1200, advancing: false },
        shown: 0.47,
        nowMs: 1300,
      }),
    ).toBeCloseTo(0.47, 6);
  });

  it("an emptied ring is drawn empty at once; never past full", () => {
    expect(
      at({
        target: { fraction: 0, atMs: 1200, advancing: false },
        shown: 0.8,
        shownTarget: 0.8,
      }),
    ).toBe(0);
    expect(
      at({
        target: { fraction: 0.99, atMs: 1000, advancing: true },
        shownTarget: 0.99,
        nowMs: 1250,
      }),
    ).toBe(1);
  });

  it("with reduced motion, the samples' own fill only", () => {
    expect(at({ nowMs: 1200, shown: 0.45, reducedMotion: true })).toBe(0.4);
  });

  it("the camera draws it every frame from the samples (no transition on it)", () => {
    const camera = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(camera).toContain("ref={drawRingCircle}");
    expect(camera).not.toContain("strokeDashoffset={");
    const css = readFileSync("src/client/camera/camera.css", "utf8");
    expect(css).not.toContain("transition: stroke-dashoffset");
  });
});
