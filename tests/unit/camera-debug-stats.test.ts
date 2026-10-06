import { describe, expect, it } from "vitest";
import {
  DEBUG_WINDOW,
  debugSnapshotJson,
  mean,
  percentile,
  pushWindow,
  samplesPerSecond,
  shortUserAgent,
  type ScanDebugSnapshot,
} from "../../src/client/camera/debugStats";

describe("pushWindow", () => {
  it("keeps only the last 30 values", () => {
    let window: number[] = [];
    for (let i = 1; i <= 45; i++) window = pushWindow(window, i);
    expect(DEBUG_WINDOW).toBe(30);
    expect(window).toHaveLength(30);
    expect(window[0]).toBe(16);
    expect(window[29]).toBe(45);
  });

  it("does not change the array it was given", () => {
    const before = [1, 2, 3];
    pushWindow(before, 4);
    expect(before).toEqual([1, 2, 3]);
  });
});

describe("mean and percentile", () => {
  it("means the values, and is null for none", () => {
    expect(mean([2, 4, 9])).toBe(5);
    expect(mean([])).toBeNull();
  });

  it("95th percentile is the nearest rank", () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
    // ceil(0.95 * 30) = 29th value
    expect(percentile(values, 95)).toBe(29);
    expect(percentile(values, 100)).toBe(30);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });

  it("does not depend on the order of the values", () => {
    expect(percentile([9, 1, 5, 3, 7], 50)).toBe(5);
  });
});

describe("samplesPerSecond", () => {
  it("is the gaps over the span: 8 Hz for samples 125 ms apart", () => {
    const times = [0, 125, 250, 375, 500];
    expect(samplesPerSecond(times)).toBeCloseTo(8, 6);
  });

  it("needs two samples", () => {
    expect(samplesPerSecond([])).toBeNull();
    expect(samplesPerSecond([100])).toBeNull();
    expect(samplesPerSecond([100, 100])).toBeNull();
  });
});

describe("shortUserAgent", () => {
  it("names the Android version, model and Chrome version", () => {
    expect(
      shortUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Android 14; Pixel 8 · Chrome/128");
  });

  it("falls back to the string itself, cut short", () => {
    expect(shortUserAgent("curl/8")).toBe("curl/8");
    expect(shortUserAgent("x".repeat(200))).toHaveLength(80);
  });
});

describe("debugSnapshotJson", () => {
  const snapshot: ScanDebugSnapshot = {
    userAgent: "Android 14; Pixel 8 · Chrome/128",
    track: {
      width: 1080,
      height: 1920,
      frameRate: 30,
      videoWidth: 1080,
      videoHeight: 1920,
    },
    capabilities: {
      focusMode: ["manual", "single-shot", "continuous"],
      pointsOfInterest: {
        inCapabilities: false,
        inSettings: true,
        inSupportedConstraints: true,
      },
      zoom: { min: 1, max: 8 },
      tapToFocus: true,
    },
    focusApplied: {
      continuous: { applied: true },
      lastTap: { applied: false, reason: "TypeError" },
    },
    live: {
      visibleInStream: { x: 207.31, y: 0, width: 665.38, height: 1440.04 },
      sample: { width: 296, height: 640 },
      samplesPerSecond: 7.912345,
      detectionMsAverage: 41.2345,
      detectionMsP95: 66.66,
      laplacianVariance: 23.45678,
      laplacianFloor: 15,
      steady: true,
      maxCornerMovementFractionOfDiagonal: 0.0081234,
      cornersSeen: 4,
      cueCode: "perfect",
      cueShown: "perfect",
      ringFraction: 0.5,
      consecutiveFailures: 1,
    },
    capture: {
      method: "takePhoto",
      stillWidth: 4000,
      stillHeight: 3000,
      stillKb: 2412.7,
      ringCompleteToFrozenMs: 183.4,
    },
    preview: {
      requested: { width: 1080, height: 1440, aspectRatio: 0.7500001 },
      stillAspect: 1.3333333,
      stillAspectSource: "photoCapabilities",
      photoMax: { width: 4000, height: 3000 },
      previewAspect: 1.7777778,
      aspectDiff: 0.3333334,
      fovMismatch: true,
      reapplied: null,
      orientationRetry: null,
    },
    attempts: [],
  };

  it("is JSON that parses back, with every key the panel promises", () => {
    const parsed = JSON.parse(debugSnapshotJson(snapshot));
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "attempts",
        "capabilities",
        "capture",
        "focusApplied",
        "live",
        "preview",
        "track",
        "userAgent",
      ].sort(),
    );
    expect(Object.keys(parsed.live).sort()).toEqual(
      [
        "sample",
        "visibleInStream",
        "consecutiveFailures",
        "cornersSeen",
        "cueCode",
        "cueShown",
        "detectionMsAverage",
        "detectionMsP95",
        "laplacianFloor",
        "laplacianVariance",
        "maxCornerMovementFractionOfDiagonal",
        "ringFraction",
        "samplesPerSecond",
        "steady",
      ].sort(),
    );
    expect(Object.keys(parsed.capture).sort()).toEqual(
      [
        "method",
        "ringCompleteToFrozenMs",
        "stillHeight",
        "stillKb",
        "stillWidth",
      ].sort(),
    );
  });

  it("rounds the numbers so the paste is short", () => {
    const parsed = JSON.parse(debugSnapshotJson(snapshot));
    expect(parsed.live.samplesPerSecond).toBe(7.9);
    expect(parsed.live.detectionMsAverage).toBe(41.2);
    expect(parsed.live.laplacianVariance).toBe(23.46);
    expect(parsed.live.maxCornerMovementFractionOfDiagonal).toBe(0.0081);
    expect(parsed.live.visibleInStream).toEqual({
      x: 207.3,
      y: 0,
      width: 665.4,
      height: 1440,
    });
    expect(parsed.live.sample).toEqual({ width: 296, height: 640 });
    expect(parsed.capture.stillKb).toBe(2413);
    expect(parsed.capture.ringCompleteToFrozenMs).toBe(183);
    expect(parsed.preview.stillAspect).toBe(1.3333);
    expect(parsed.preview.previewAspect).toBe(1.7778);
    expect(parsed.preview.aspectDiff).toBe(0.3333);
    expect(parsed.preview.requested.aspectRatio).toBe(0.75);
  });

  it("puts each attempt on one line, so twenty are not a thousand lines to paste", () => {
    const attempt = {
      v: 1,
      at: "2026-10-06T10:20:30.000Z",
      method: "upload",
      result: "error",
    };
    const text = debugSnapshotJson({
      ...snapshot,
      attempts: [
        attempt,
        { ...attempt, at: "2026-10-06T10:20:31.000Z" },
      ] as never,
    });
    const parsed = JSON.parse(text);
    expect(parsed.attempts).toHaveLength(2);
    expect(parsed.attempts[1].at).toBe("2026-10-06T10:20:31.000Z");
    const lines = text.split("\n").filter((l) => l.includes('"at"'));
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.trim().startsWith("{")).toBe(true);
    // Still valid with none.
    expect(
      JSON.parse(debugSnapshotJson({ ...snapshot, attempts: [] })).attempts,
    ).toEqual([]);
  });

  it("carries the attempts array, and keeps the preview flag as it is", () => {
    const parsed = JSON.parse(debugSnapshotJson(snapshot));
    expect(parsed.attempts).toEqual([]);
    expect(parsed.preview.fovMismatch).toBe(true);
    expect(parsed.preview.stillAspectSource).toBe("photoCapabilities");
    expect(Object.keys(parsed.preview).sort()).toEqual(
      [
        "aspectDiff",
        "fovMismatch",
        "orientationRetry",
        "photoMax",
        "previewAspect",
        "reapplied",
        "requested",
        "stillAspect",
        "stillAspectSource",
      ].sort(),
    );
  });

  it("keeps null as null (nothing measured yet)", () => {
    const parsed = JSON.parse(
      debugSnapshotJson({
        ...snapshot,
        track: null,
        capabilities: null,
        live: {
          ...snapshot.live,
          samplesPerSecond: null,
          detectionMsAverage: null,
          detectionMsP95: null,
          maxCornerMovementFractionOfDiagonal: null,
        },
        capture: {
          ...snapshot.capture,
          stillKb: null,
          ringCompleteToFrozenMs: null,
        },
      }),
    );
    expect(parsed.track).toBeNull();
    expect(parsed.live.detectionMsP95).toBeNull();
    expect(parsed.capture.ringCompleteToFrozenMs).toBeNull();
  });
});
