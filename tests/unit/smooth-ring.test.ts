import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMERA_CONSTANTS } from "@/client/camera/constants";
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

  it("a failed sample (2026-10-28): the ring drawn ahead slows to aheadRate, it does not stand still", () => {
    // Passing samples at 6.6 a second: the ring drawn 150 ms past the sample
    // at 0.4. The next sample fails: same fill, its own moment 1150.
    const target = { fraction: 0.4, atMs: 1150, advancing: true };
    const frame = (shown: number, nowMs: number, aheadRate?: number) =>
      at({
        target,
        shown,
        shownTarget: 0.4,
        nowMs,
        shownAtMs: nowMs - 16.7,
        ...(aheadRate === undefined ? {} : { aheadRate }),
      });
    const behind = 0.4 + 150 / 2500;
    // Before: still for the whole interval (nine frames at 60 fps).
    expect(frame(behind, 1166.7)).toBe(behind);
    // Now: half a frame of fill each frame.
    expect(frame(behind, 1166.7, 0.5)).toBeCloseTo(behind + 8.35 / 2500, 9);
  });

  it("...frame by frame it never stops, never goes back, and never runs past leadMs ahead of the sample's fill", () => {
    const target = { fraction: 0.4, atMs: 1150, advancing: true };
    let shown = 0.4 + 150 / 2500;
    let shownAtMs = 1150;
    const steps: number[] = [];
    for (let nowMs = 1166.7; nowMs < 1150 + 600; nowMs += 16.7) {
      const next = at({
        target,
        shown,
        shownTarget: 0.4,
        nowMs,
        shownAtMs,
        aheadRate: 0.5,
      });
      steps.push(next - shown);
      shown = next;
      shownAtMs = nowMs;
    }
    // Moving on every frame until the lead's cap (0.4 + 250 ms of fill).
    const capped = steps.findIndex((d) => d === 0);
    expect(capped).toBeGreaterThan(5);
    expect(steps.slice(0, capped).every((d) => d > 0)).toBe(true);
    expect(steps.every((d) => d >= 0)).toBe(true);
    expect(shown).toBeCloseTo(0.4 + 250 / 2500, 9);
  });

  it("...and once the samples catch up the ring runs at its own speed again", () => {
    expect(
      at({
        target: { fraction: 0.4, atMs: 1150, advancing: true },
        shown: 0.45,
        shownTarget: 0.4,
        nowMs: 1150 + 200,
        shownAtMs: 1150 + 183.3,
        aheadRate: 0.5,
      }),
    ).toBeCloseTo(0.4 + 200 / 2500, 9);
  });

  it("the slow-down rate is the named constant (候選)", () => {
    expect(CAMERA_CONSTANTS.autoCapture.ringAheadRate).toBe(0.5);
  });

  it("the camera paints from the frame's own time and passes the slow-down", () => {
    const camera = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(camera).toContain("paintRing(ringCircleRef.current, at)");
    expect(camera).toContain(
      "aheadRate: CAMERA_CONSTANTS.autoCapture.ringAheadRate",
    );
    expect(camera).toContain("shownAtMs: last.atMs");
    // The camera's state hears of the fill only when it crosses zero.
    expect(camera).toContain("before > 0 === fraction > 0 ? before : fraction");
  });

  it("the camera draws it every frame from the samples (no transition on it)", () => {
    const camera = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(camera).toContain("ref={drawRingCircle}");
    expect(camera).not.toContain("strokeDashoffset={");
    const css = readFileSync("src/client/camera/camera.css", "utf8");
    expect(css).not.toContain("transition: stroke-dashoffset");
  });
});
