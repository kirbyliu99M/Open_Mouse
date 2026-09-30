import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  advanceAutoCapture,
  resetAutoCapture,
  type AutoCaptureState,
} from "../../src/client/camera/autoCapture";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import {
  freshLiveLoopSampling,
  sampleElapsedMs,
} from "../../src/client/camera/liveLoop";

const MIN_INTERVAL_MS = 1000 / CAMERA_CONSTANTS.liveLoop.maxSamplesPerSecond;

describe("freshLiveLoopSampling", () => {
  it("starts with no previous sample, no previous quad and an empty ring", () => {
    const fresh = freshLiveLoopSampling();
    expect(fresh.lastSampleAtMs).toBe(0);
    expect(fresh.prevQuad).toBeNull();
    expect(fresh.autoCapture).toEqual(resetAutoCapture());
    expect(fresh.autoCapture.fired).toBe(false);
  });
});

describe("sampleElapsedMs", () => {
  it("counts one nominal interval for the first sample", () => {
    expect(sampleElapsedMs(0, 123456, MIN_INTERVAL_MS)).toBe(MIN_INTERVAL_MS);
  });

  it("passes a normal gap through", () => {
    expect(
      sampleElapsedMs(1000, 1000 + MIN_INTERVAL_MS + 10, MIN_INTERVAL_MS),
    ).toBeCloseTo(MIN_INTERVAL_MS + 10);
  });

  it("caps a long gap, so a stall is never held-still time", () => {
    // The tip was open for a minute: the loop's last sample is stale.
    expect(sampleElapsedMs(1000, 61000, MIN_INTERVAL_MS)).toBe(
      2 * MIN_INTERVAL_MS,
    );
    expect(2 * MIN_INTERVAL_MS).toBeLessThan(
      CAMERA_CONSTANTS.autoCapture.durationMs,
    );
  });

  it("never returns a negative elapsed time (advanceAutoCapture would throw)", () => {
    expect(sampleElapsedMs(5000, 4000, MIN_INTERVAL_MS)).toBe(0);
  });
});

describe("resuming the loop after the first-run tip", () => {
  // Every check passes on every sample: the worst case for a stale ring.
  function firstSampleAfterResume(
    state: AutoCaptureState,
    lastSampleAtMs: number,
  ) {
    const dt = sampleElapsedMs(lastSampleAtMs, 61000, MIN_INTERVAL_MS);
    return advanceAutoCapture(state, true, dt);
  }

  it("with a fresh state, the first sample cannot fire an auto-capture", () => {
    const fresh = freshLiveLoopSampling();
    const after = firstSampleAfterResume(
      fresh.autoCapture,
      fresh.lastSampleAtMs,
    );
    expect(after.fired).toBe(false);
  });

  it("would fire on the first sample if the old ring were carried over (why the reset exists)", () => {
    const carriedOver: AutoCaptureState = { elapsedMs: 700, fired: false };
    expect(firstSampleAfterResume(carriedOver, 1000).fired).toBe(true);
  });

  it("an unbounded stale gap would fire on the first sample even from an empty ring (why the gap is capped)", () => {
    const uncapped = advanceAutoCapture(resetAutoCapture(), true, 61000 - 1000);
    expect(uncapped.fired).toBe(true);
    expect(firstSampleAfterResume(resetAutoCapture(), 1000).fired).toBe(false);
  });
});

describe("EasyScanCamera's live loop uses them", () => {
  const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");

  it("starts every (re)run from the fresh state", () => {
    const loopStart = source.indexOf(
      'if (camState.kind !== "live" || tipOpen) return;',
    );
    expect(loopStart).toBeGreaterThan(-1);
    const beforeTick = source.slice(
      loopStart,
      source.indexOf("let cancelled = false;", loopStart),
    );
    expect(beforeTick).toContain("resetLoopState();");
    expect(source).toMatch(
      /const resetLoopState = useCallback\(\(\) => \{[^}]*freshLiveLoopSampling\(\)/s,
    );
  });

  it("takes each sample's elapsed time from sampleElapsedMs", () => {
    expect(source).toContain("sampleElapsedMs(");
    expect(source).not.toMatch(/now - previousSampleAt/);
  });

  it("schedules exactly one animation frame per tick", () => {
    const tick = source.slice(
      source.indexOf("function tick(now: number)"),
      source.indexOf(
        "rafRef.current = requestAnimationFrame(tick);\n    return () =>",
      ),
    );
    expect(tick.match(/requestAnimationFrame\(tick\)/g)).toHaveLength(1);
  });
});
