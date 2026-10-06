import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_FOCUS_SUPPORT,
  applyContinuousFocus,
  applyTapFocus,
  focusOnceThenContinuous,
  readFocusSupport,
  tapToVideoPoint,
  type FocusApplyResult,
  type FocusConstraints,
  type FocusTrackLike,
} from "../../src/client/camera/focus";
import {
  CAMERA_CONSTANTS,
  captureSource,
} from "../../src/client/camera/constants";

/** A track that records what it is asked for, and can be made to refuse. */
function fakeTrack(options: {
  capabilities?: object | "throws" | "missing";
  settings?: object;
  applyThrows?: Error;
}) {
  const applied: FocusConstraints[] = [];
  const track: FocusTrackLike = {
    getSettings: () => options.settings ?? {},
    applyConstraints: async (constraints) => {
      applied.push(constraints);
      if (options.applyThrows) throw options.applyThrows;
    },
  };
  const capabilities = options.capabilities;
  if (capabilities !== "missing") {
    track.getCapabilities = () => {
      if (capabilities === "throws") throw new Error("boom");
      return capabilities ?? {};
    };
  }
  return { track, applied };
}

const ANDROID_CHROME = {
  capabilities: {
    focusMode: ["manual", "single-shot", "continuous"],
    zoom: { min: 1, max: 8, step: 0.1 },
  },
  settings: { pointsOfInterest: [] },
};

describe("readFocusSupport", () => {
  it("supported: Android Chrome lists focus modes and, in its settings, pointsOfInterest", () => {
    const { track } = fakeTrack(ANDROID_CHROME);
    const support = readFocusSupport(track);
    expect(support.focusModes).toEqual(["manual", "single-shot", "continuous"]);
    expect(support.continuous).toBe(true);
    expect(support.singleShot).toBe(true);
    expect(support.pointsOfInterest).toBe(true);
    expect(support.pointsOfInterestIn).toEqual({
      capabilities: false,
      settings: true,
      supportedConstraints: false,
    });
    expect(support.zoom).toEqual({ min: 1, max: 8, step: 0.1 });
    expect(support.tapToFocus).toBe(true);
  });

  it("finds pointsOfInterest in any one of its three places", () => {
    const capabilities = { focusMode: ["single-shot"] };
    expect(
      readFocusSupport(
        fakeTrack({ capabilities: { ...capabilities, pointsOfInterest: {} } })
          .track,
      ).pointsOfInterestIn,
    ).toEqual({
      capabilities: true,
      settings: false,
      supportedConstraints: false,
    });
    expect(
      readFocusSupport(fakeTrack({ capabilities }).track, {
        pointsOfInterest: true,
      }).pointsOfInterestIn,
    ).toEqual({
      capabilities: false,
      settings: false,
      supportedConstraints: true,
    });
    expect(
      readFocusSupport(fakeTrack({ capabilities }).track, {
        pointsOfInterest: false,
      }).pointsOfInterest,
    ).toBe(false);
  });

  it("single-shot without any sign of pointsOfInterest is not tap-to-focus", () => {
    const support = readFocusSupport(
      fakeTrack({ capabilities: { focusMode: ["continuous", "single-shot"] } })
        .track,
    );
    expect(support.singleShot).toBe(true);
    expect(support.pointsOfInterest).toBe(false);
    expect(support.tapToFocus).toBe(false);
    expect(support.continuous).toBe(true);
  });

  it("pointsOfInterest without single-shot is not tap-to-focus either", () => {
    const support = readFocusSupport(
      fakeTrack({
        capabilities: { focusMode: ["continuous"] },
        settings: { pointsOfInterest: [] },
      }).track,
    );
    expect(support.tapToFocus).toBe(false);
  });

  it("unsupported: a desktop camera with no focusMode at all", () => {
    const support = readFocusSupport(fakeTrack({ capabilities: {} }).track, {
      pointsOfInterest: true,
    });
    expect(support.focusModes).toEqual([]);
    expect(support.continuous).toBe(false);
    expect(support.singleShot).toBe(false);
    expect(support.tapToFocus).toBe(false);
  });

  it("unsupported: a browser with no getCapabilities (Safari)", () => {
    const support = readFocusSupport(
      fakeTrack({ capabilities: "missing" }).track,
    );
    expect(support).toEqual({
      ...NO_FOCUS_SUPPORT,
      pointsOfInterestIn: NO_FOCUS_SUPPORT.pointsOfInterestIn,
    });
  });

  it("getCapabilities that throws is read as no support, not an error", () => {
    const support = readFocusSupport(
      fakeTrack({ capabilities: "throws" }).track,
    );
    expect(support.continuous).toBe(false);
    expect(support.tapToFocus).toBe(false);
  });

  it("accepts a focusMode reported as a single string", () => {
    const support = readFocusSupport(
      fakeTrack({ capabilities: { focusMode: "continuous" } }).track,
    );
    expect(support.focusModes).toEqual(["continuous"]);
    expect(support.continuous).toBe(true);
  });
});

describe("applyContinuousFocus", () => {
  it("supported: asks for continuous focus, and only that", async () => {
    const { track, applied } = fakeTrack(ANDROID_CHROME);
    const result = await applyContinuousFocus(track, readFocusSupport(track));
    expect(result).toEqual({ applied: true });
    expect(applied).toEqual([{ advanced: [{ focusMode: "continuous" }] }]);
  });

  it("unsupported: asks for nothing", async () => {
    const { track, applied } = fakeTrack({ capabilities: {} });
    const result = await applyContinuousFocus(track, readFocusSupport(track));
    expect(result).toEqual({ applied: false, reason: "unsupported" });
    expect(applied).toEqual([]);
  });

  it("does not ask when only single-shot is listed", async () => {
    const { track, applied } = fakeTrack({
      capabilities: { focusMode: ["single-shot"] },
    });
    const result = await applyContinuousFocus(track, readFocusSupport(track));
    expect(result.applied).toBe(false);
    expect(applied).toEqual([]);
  });

  it("applyConstraints throwing is caught and reported, never thrown", async () => {
    const { track, applied } = fakeTrack({
      ...ANDROID_CHROME,
      applyThrows: Object.assign(new Error("nope"), {
        name: "OverconstrainedError",
      }),
    });
    const result = await applyContinuousFocus(track, readFocusSupport(track));
    expect(result).toEqual({ applied: false, reason: "OverconstrainedError" });
    expect(applied).toHaveLength(1);
  });

  it("a rejection that is not an Error is caught too", async () => {
    const track: FocusTrackLike = {
      getCapabilities: () => ({ focusMode: ["continuous"] }),
      applyConstraints: () => Promise.reject("string rejection"),
    };
    const result = await applyContinuousFocus(track, readFocusSupport(track));
    expect(result).toEqual({ applied: false, reason: "error" });
  });
});

describe("applyTapFocus", () => {
  it("supported: single-shot focus at the point", async () => {
    const { track, applied } = fakeTrack(ANDROID_CHROME);
    const result = await applyTapFocus(track, readFocusSupport(track), {
      x: 0.25,
      y: 0.6,
    });
    expect(result).toEqual({ applied: true });
    expect(applied).toEqual([
      {
        advanced: [
          {
            focusMode: "single-shot",
            pointsOfInterest: [{ x: 0.25, y: 0.6 }],
          },
        ],
      },
    ]);
  });

  it("unsupported: no request at all", async () => {
    const { track, applied } = fakeTrack({
      capabilities: { focusMode: ["continuous"] },
    });
    const result = await applyTapFocus(track, readFocusSupport(track), {
      x: 0.5,
      y: 0.5,
    });
    expect(result).toEqual({ applied: false, reason: "unsupported" });
    expect(applied).toEqual([]);
  });

  it("applyConstraints throwing is caught and reported", async () => {
    const { track } = fakeTrack({
      ...ANDROID_CHROME,
      applyThrows: new TypeError("bad point"),
    });
    const result = await applyTapFocus(track, readFocusSupport(track), {
      x: 0.5,
      y: 0.5,
    });
    expect(result).toEqual({ applied: false, reason: "TypeError" });
  });
});

describe("the preview stream", () => {
  it("is asked for in the photo's shape, not 16:9 (previewConstraints.ts); the full-size still is takePhoto's job", () => {
    expect(CAMERA_CONSTANTS.preview.defaultStillAspect).toBeCloseTo(4 / 3, 10);
    expect(CAMERA_CONSTANTS.preview.shortEdgePx).toBe(1080);
    expect(CAMERA_CONSTANTS.preview.minShortEdgePx).toBe(720);
    expect(CAMERA_CONSTANTS.preview.fovMismatchTolerance).toBe(0.02);
    // Frame capture: the preview is asked for 1920x1080 again.
    expect(CAMERA_CONSTANTS.preview.frameIdealWidth).toBe(1920);
    expect(CAMERA_CONSTANTS.preview.frameIdealHeight).toBe(1080);
    // The shutter waits for the preview, but at most this long.
    expect(CAMERA_CONSTANTS.preview.settleTimeoutMs).toBe(3000);
    expect(CAMERA_CONSTANTS.focus.tapRefocusMs).toBe(1200);
  });
});

describe("tapToVideoPoint", () => {
  const stage = { width: 390, height: 844 };

  it("a stream with the stage's own shape maps 1:1", () => {
    const point = tapToVideoPoint({ x: 195, y: 422 }, stage, {
      width: 390,
      height: 844,
    });
    expect(point).toEqual({ x: 0.5, y: 0.5 });
  });

  it("undoes the cover crop: a wider stream loses its sides, so the stage edge is inside the frame", () => {
    // 1080x1920 (9:16) covers a 390x844 stage by height: 844 tall, 474.75 wide.
    const video = { width: 1080, height: 1920 };
    const left = tapToVideoPoint({ x: 0, y: 422 }, stage, video)!;
    const right = tapToVideoPoint({ x: 390, y: 422 }, stage, video)!;
    const overflow = (474.75 - 390) / 2;
    expect(left.x).toBeCloseTo(overflow / 474.75, 4);
    expect(right.x).toBeCloseTo((390 + overflow) / 474.75, 4);
    expect(left.y).toBeCloseTo(0.5, 6);
    expect(tapToVideoPoint({ x: 195, y: 0 }, stage, video)!.y).toBe(0);
    expect(tapToVideoPoint({ x: 195, y: 844 }, stage, video)!.y).toBe(1);
    expect(tapToVideoPoint({ x: 195, y: 422 }, stage, video)!.x).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("undoes the cover crop: a taller stream loses top and bottom", () => {
    // A 4:3 portrait frame (3:4) on a much taller stage: covered by height.
    const video = { width: 300, height: 400 };
    const point = tapToVideoPoint(
      { x: 195, y: 0 },
      { width: 390, height: 520 },
      video,
    )!;
    // Video scaled to 390x520 exactly (same aspect): the top edge is y = 0.
    expect(point.y).toBe(0);
    const tall = tapToVideoPoint(
      { x: 195, y: 0 },
      { width: 390, height: 1000 },
      video,
    )!;
    // Scaled to cover a 390x1000 stage: 750x1000, so the sides are cropped, not the top.
    expect(tall.y).toBe(0);
    expect(tall.x).toBeCloseTo(0.5, 6);
  });

  it("clamps a tap just outside the frame to its edge", () => {
    const point = tapToVideoPoint({ x: -5, y: 900 }, stage, {
      width: 1080,
      height: 1920,
    })!;
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.y).toBe(1);
  });

  it("returns null for a stage or frame without a size", () => {
    expect(
      tapToVideoPoint({ x: 1, y: 1 }, { width: 0, height: 100 }, stage),
    ).toBeNull();
    expect(
      tapToVideoPoint({ x: 1, y: 1 }, stage, { width: 0, height: 0 }),
    ).toBeNull();
  });
});

describe("focusOnceThenContinuous (a tap on the paper)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const calls = (applied: FocusConstraints[]) =>
    applied.map((c) => c.advanced[0].focusMode);

  it("asks for single-shot at once and returns to continuous after 1200 ms, not before", async () => {
    vi.useFakeTimers();
    const { track, applied } = fakeTrack(ANDROID_CHROME);
    const support = readFocusSupport(track);
    const results: FocusApplyResult[] = [];
    focusOnceThenContinuous(
      track,
      support,
      { x: 0.4, y: 0.6 },
      CAMERA_CONSTANTS.focus.tapRefocusMs,
      { onContinuous: (r) => results.push(r) },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(applied)).toEqual(["single-shot"]);
    await vi.advanceTimersByTimeAsync(1199);
    expect(calls(applied)).toEqual(["single-shot"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls(applied)).toEqual(["single-shot", "continuous"]);
    expect(results).toEqual([{ applied: true }]);
    // ...and once only.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls(applied)).toEqual(["single-shot", "continuous"]);
  });

  it("uses the shipped delay of 1200 ms", () => {
    expect(CAMERA_CONSTANTS.focus.tapRefocusMs).toBe(1200);
  });

  it("cancel() drops the return to continuous", async () => {
    vi.useFakeTimers();
    const { track, applied } = fakeTrack(ANDROID_CHROME);
    const handle = focusOnceThenContinuous(
      track,
      readFocusSupport(track),
      { x: 0.5, y: 0.5 },
      1200,
    );
    await vi.advanceTimersByTimeAsync(600);
    handle.cancel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls(applied)).toEqual(["single-shot"]);
  });

  it("a refused single-shot still returns to continuous, and reports the refusal", async () => {
    vi.useFakeTimers();
    const taps: FocusApplyResult[] = [];
    const applied: FocusConstraints[] = [];
    const track: FocusTrackLike = {
      getCapabilities: () => ({ focusMode: ["single-shot", "continuous"] }),
      getSettings: () => ({ pointsOfInterest: [] }),
      applyConstraints: async (constraints) => {
        applied.push(constraints);
        if (constraints.advanced[0].focusMode === "single-shot")
          throw Object.assign(new Error("no"), { name: "NotSupportedError" });
      },
    };
    focusOnceThenContinuous(
      track,
      readFocusSupport(track),
      { x: 0.5, y: 0.5 },
      1200,
      {
        onTap: (r) => taps.push(r),
      },
    );
    await vi.advanceTimersByTimeAsync(1200);
    expect(taps).toEqual([{ applied: false, reason: "NotSupportedError" }]);
    expect(calls(applied)).toEqual(["single-shot", "continuous"]);
  });

  it("where a tap cannot set the focus it asks for nothing single-shot, and continuous only if offered", async () => {
    vi.useFakeTimers();
    const { track, applied } = fakeTrack({
      capabilities: { focusMode: ["continuous"] },
    });
    focusOnceThenContinuous(
      track,
      readFocusSupport(track),
      { x: 0.5, y: 0.5 },
      1200,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls(applied)).toEqual(["continuous"]);
  });
});

describe("what the shutter takes (CAMERA_CONSTANTS.capture)", () => {
  it("is a frame of the video, cut to the part on screen; the camera's own photo is off", () => {
    expect(captureSource()).toBe("frame");
    expect(CAMERA_CONSTANTS.capture.source).toBe("frame");
    expect(CAMERA_CONSTANTS.capture.jpegQuality).toBe(0.92);
  });
});
