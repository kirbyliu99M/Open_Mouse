import { describe, expect, it } from "vitest";
import {
  alignAndSettle,
  framePreviewConstraints,
  alignPreviewToStill,
  aspectOfSize,
  compareFov,
  isPortraitViewport,
  normaliseStillAspect,
  previewConstraintsFor,
  previewSizingFor,
  stillAspectFromCapabilities,
  type PreviewSizing,
  type PreviewTrackLike,
} from "../../src/client/camera/previewConstraints";

describe("normaliseStillAspect", () => {
  it("is long over short, whichever way round it was measured", () => {
    expect(normaliseStillAspect(4 / 3)).toBeCloseTo(4 / 3, 10);
    expect(normaliseStillAspect(3 / 4)).toBeCloseTo(4 / 3, 10);
    expect(normaliseStillAspect(16 / 9)).toBeCloseTo(16 / 9, 10);
    expect(normaliseStillAspect(1)).toBe(1);
  });

  it("rejects what is not a usable shape", () => {
    for (const bad of [
      0,
      -1.5,
      NaN,
      Infinity,
      -Infinity,
      "4:3",
      null,
      undefined,
      {},
      [],
    ])
      expect(normaliseStillAspect(bad), String(bad)).toBeNull();
  });

  it("rejects a camera reporting a shape wilder than 3:1", () => {
    expect(normaliseStillAspect(3)).toBe(3);
    expect(normaliseStillAspect(3.01)).toBeNull();
    expect(normaliseStillAspect(1 / 3.01)).toBeNull();
    expect(normaliseStillAspect(100)).toBeNull();
  });
});

describe("aspectOfSize", () => {
  it("is the long edge over the short edge", () => {
    expect(aspectOfSize(3000, 4000)).toBeCloseTo(4 / 3, 10);
    expect(aspectOfSize(4000, 3000)).toBeCloseTo(4 / 3, 10);
    expect(aspectOfSize(1080, 1920)).toBeCloseTo(16 / 9, 10);
  });

  it("is null for a size that is missing, zero or not a number", () => {
    expect(aspectOfSize(0, 100)).toBeNull();
    expect(aspectOfSize(100, undefined)).toBeNull();
    expect(aspectOfSize("1080", 1920)).toBeNull();
    expect(aspectOfSize(NaN, 100)).toBeNull();
    expect(aspectOfSize(10, 1000)).toBeNull();
  });
});

describe("previewConstraintsFor", () => {
  it("held upright, a 4:3 photo gets a 3:4 preview, 1080 across", () => {
    expect(previewConstraintsFor(4 / 3, true)).toEqual({
      facingMode: "environment",
      width: { ideal: 1080 },
      height: { ideal: 1440 },
      aspectRatio: { ideal: 0.75 },
      resizeMode: { ideal: "none" },
    });
  });

  it("held wide, the same photo gets a 4:3 preview, 1080 tall", () => {
    const constraints = previewConstraintsFor(4 / 3, false);
    expect(constraints.width).toEqual({ ideal: 1440 });
    expect(constraints.height).toEqual({ ideal: 1080 });
    expect(constraints.aspectRatio.ideal).toBeCloseTo(4 / 3, 10);
  });

  it("upright, width is always the short side and aspectRatio is below 1", () => {
    for (const aspect of [1, 4 / 3, 3 / 2, 16 / 9, 2, 3]) {
      const c = previewConstraintsFor(aspect, true);
      expect(c.width.ideal, String(aspect)).toBeLessThanOrEqual(c.height.ideal);
      expect(c.aspectRatio.ideal).toBeLessThanOrEqual(1);
      expect(c.aspectRatio.ideal).toBeCloseTo(1 / aspect, 10);
    }
  });

  it("wide, width is always the long side and aspectRatio is above 1", () => {
    for (const aspect of [1, 4 / 3, 3 / 2, 16 / 9, 2, 3]) {
      const c = previewConstraintsFor(aspect, false);
      expect(c.width.ideal, String(aspect)).toBeGreaterThanOrEqual(
        c.height.ideal,
      );
      expect(c.aspectRatio.ideal).toBeGreaterThanOrEqual(1);
    }
  });

  it("a 16:9 photo (a camera whose stills are 16:9) gets a 9:16 preview", () => {
    const c = previewConstraintsFor(16 / 9, true);
    expect(c.width).toEqual({ ideal: 1080 });
    expect(c.height).toEqual({ ideal: 1920 });
    expect(c.aspectRatio.ideal).toBeCloseTo(9 / 16, 10);
  });

  it("asks for the shape 4:3 when the photo's shape is not known", () => {
    for (const unknown of [null, undefined, NaN, 0, -2, Infinity, 50]) {
      expect(previewConstraintsFor(unknown, true), String(unknown)).toEqual(
        previewConstraintsFor(4 / 3, true),
      );
    }
  });

  it("a shape given as width over height (below 1) is taken as its long over short", () => {
    expect(previewConstraintsFor(3 / 4, true)).toEqual(
      previewConstraintsFor(4 / 3, true),
    );
  });

  it("extreme shapes: square, and the widest taken at face value", () => {
    const square = previewConstraintsFor(1, true);
    expect(square.width.ideal).toBe(1080);
    expect(square.height.ideal).toBe(1080);
    expect(square.aspectRatio.ideal).toBe(1);
    const wide = previewConstraintsFor(3, false);
    expect(wide.width.ideal).toBe(3240);
    expect(wide.height.ideal).toBe(1080);
  });

  it("the short edge is about 1080 and never asked for below 720", () => {
    expect(previewSizingFor(4 / 3, true).width.ideal).toBe(1080);
    expect(previewSizingFor(4 / 3, true, 900).width.ideal).toBe(900);
    expect(previewSizingFor(4 / 3, true, 720).width.ideal).toBe(720);
    expect(previewSizingFor(4 / 3, true, 480).width.ideal).toBe(720);
    expect(previewSizingFor(4 / 3, true, 0).width.ideal).toBe(720);
    expect(previewSizingFor(4 / 3, true, NaN).width.ideal).toBe(1080);
    expect(previewSizingFor(4 / 3, true, 480).height.ideal).toBe(960);
  });

  it("every size is a whole, even number", () => {
    for (const aspect of [1.1, 1.2345, 4 / 3, 1.5, 16 / 9, 2.3333, 2.9]) {
      for (const portrait of [true, false]) {
        const c = previewConstraintsFor(aspect, portrait, 1001);
        for (const n of [c.width.ideal, c.height.ideal]) {
          expect(Number.isInteger(n), `${aspect} ${n}`).toBe(true);
          expect(n % 2).toBe(0);
        }
      }
    }
  });

  it("keeps resizeMode none, so the browser does not crop and scale to the shape", () => {
    expect(previewConstraintsFor(4 / 3, true).resizeMode).toEqual({
      ideal: "none",
    });
    expect(previewConstraintsFor(16 / 9, false).resizeMode).toEqual({
      ideal: "none",
    });
  });

  it("the sizing has no facingMode (it cannot be re-applied to a running track)", () => {
    expect("facingMode" in previewSizingFor(4 / 3, true)).toBe(false);
    expect(previewConstraintsFor(4 / 3, true).facingMode).toBe("environment");
  });
});

describe("isPortraitViewport", () => {
  it("is true for a window taller than wide, and for a square one", () => {
    expect(isPortraitViewport(390, 844)).toBe(true);
    expect(isPortraitViewport(500, 500)).toBe(true);
    expect(isPortraitViewport(844, 390)).toBe(false);
  });
});

describe("stillAspectFromCapabilities", () => {
  it("is the largest image width over the largest image height, as long over short", () => {
    const found = stillAspectFromCapabilities({
      imageWidth: { min: 640, max: 4000, step: 1 },
      imageHeight: { min: 480, max: 3000, step: 1 },
    });
    expect(found?.aspect).toBeCloseTo(4 / 3, 10);
    expect(found).toMatchObject({ width: 4000, height: 3000 });
  });

  it("does not care which way round the camera reports the sensor", () => {
    expect(
      stillAspectFromCapabilities({
        imageWidth: { max: 3000 },
        imageHeight: { max: 4000 },
      })?.aspect,
    ).toBeCloseTo(4 / 3, 10);
  });

  it("a 16:9 sensor mode reads as 16:9", () => {
    expect(
      stillAspectFromCapabilities({
        imageWidth: { max: 3840 },
        imageHeight: { max: 2160 },
      })?.aspect,
    ).toBeCloseTo(16 / 9, 10);
  });

  it("is null when either size is missing, not a number, zero or the shape is nonsense", () => {
    for (const bad of [
      null,
      undefined,
      "caps",
      {},
      { imageWidth: { max: 4000 } },
      { imageHeight: { max: 3000 } },
      { imageWidth: { max: 0 }, imageHeight: { max: 3000 } },
      { imageWidth: { max: "4000" }, imageHeight: { max: 3000 } },
      { imageWidth: { max: 10 }, imageHeight: { max: 1000 } },
      { imageWidth: 4000, imageHeight: 3000 },
    ])
      expect(stillAspectFromCapabilities(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("compareFov", () => {
  const FOUR_THREE = 4 / 3;

  it("Kirby's S25: a 1080x1920 preview against a 3000x4000 photo is a mismatch of +33 %", () => {
    const result = compareFov({ width: 1080, height: 1920 }, FOUR_THREE);
    expect(result.previewAspect).toBeCloseTo(16 / 9, 10);
    expect(result.aspectDiff).toBeCloseTo(1 / 3, 6);
    expect(result.fovMismatch).toBe(true);
  });

  it("the same shape is no mismatch, upright or wide", () => {
    expect(compareFov({ width: 1080, height: 1440 }, FOUR_THREE)).toMatchObject(
      {
        aspectDiff: 0,
        fovMismatch: false,
      },
    );
    expect(compareFov({ width: 1440, height: 1080 }, FOUR_THREE)).toMatchObject(
      {
        aspectDiff: 0,
        fovMismatch: false,
      },
    );
  });

  it("2 % is the line: within it is the same view, beyond it is not", () => {
    const at = (diff: number) =>
      compareFov(
        { width: 1000, height: 1000 * FOUR_THREE * (1 + diff) },
        FOUR_THREE,
      );
    expect(at(0.019).fovMismatch).toBe(false);
    expect(at(-0.019).fovMismatch).toBe(false);
    expect(at(0.021).fovMismatch).toBe(true);
    expect(at(-0.021).fovMismatch).toBe(true);
  });

  it("a preview that is the wider view is a mismatch too, with a negative difference", () => {
    const result = compareFov({ width: 1080, height: 1200 }, FOUR_THREE);
    expect(result.aspectDiff).toBeLessThan(-0.02);
    expect(result.fovMismatch).toBe(true);
  });

  it("a preview whose size is not known is not a mismatch, it is unknown", () => {
    for (const preview of [
      null,
      {},
      { width: 1080 },
      { width: 0, height: 1920 },
      { width: undefined, height: undefined },
    ]) {
      const result = compareFov(preview, FOUR_THREE);
      expect(result.fovMismatch, JSON.stringify(preview)).toBeNull();
      expect(result.aspectDiff).toBeNull();
      expect(result.previewAspect).toBeNull();
    }
  });

  it("takes the tolerance as an argument", () => {
    expect(
      compareFov({ width: 1000, height: 1400 }, FOUR_THREE, 0.1).fovMismatch,
    ).toBe(false);
    expect(
      compareFov({ width: 1000, height: 1400 }, FOUR_THREE, 0.01).fovMismatch,
    ).toBe(true);
  });
});

// ── alignPreviewToStill, with a fake track and a fake ImageCapture ────────

/** A track that reports `settings`, records what it is asked for, and (if told) changes its settings to what was asked. */
function fakeTrack(options: {
  settings?: { width: number; height: number; frameRate?: number };
  applyThrows?: Error;
  settingsThrow?: boolean;
  followRequests?: boolean;
  /** What the track reports after a request: a camera with a mind of its own. */
  respond?: (constraints: PreviewSizing) => {
    width: number;
    height: number;
  };
}) {
  const applied: PreviewSizing[] = [];
  let settings = options.settings ?? {
    width: 1080,
    height: 1440,
    frameRate: 30,
  };
  const track: PreviewTrackLike = {
    getSettings: () => {
      if (options.settingsThrow) throw new Error("no settings");
      return settings;
    },
    applyConstraints: async (constraints) => {
      applied.push(constraints);
      if (options.applyThrows) throw options.applyThrows;
      if (options.respond)
        settings = { ...settings, ...options.respond(constraints) };
      if (options.followRequests)
        settings = {
          ...settings,
          width: constraints.width.ideal,
          height: constraints.height.ideal,
        };
    },
  };
  return { track, applied };
}

function fakeImageCapture(
  capabilities: unknown,
  mode: "ok" | "constructorThrows" | "rejects" = "ok",
) {
  const seen: unknown[] = [];
  class FakeImageCapture {
    constructor(track: unknown) {
      seen.push(track);
      if (mode === "constructorThrows") throw new TypeError("no ImageCapture");
    }
    async getPhotoCapabilities() {
      if (mode === "rejects") throw new DOMException("no", "NotSupportedError");
      return capabilities;
    }
  }
  return { Ctor: FakeImageCapture, seen };
}

const CAPS_43 = { imageWidth: { max: 4000 }, imageHeight: { max: 3000 } };
const CAPS_169 = { imageWidth: { max: 3840 }, imageHeight: { max: 2160 } };

describe("alignPreviewToStill", () => {
  it("a 4:3 photo needs nothing more: the first request was already the right shape", async () => {
    const { track, applied } = fakeTrack({});
    const { Ctor, seen } = fakeImageCapture(CAPS_43);
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(seen).toEqual([track]);
    expect(applied).toEqual([]);
    expect(result.reapplied).toBeNull();
    expect(result.orientationRetry).toBeNull();
    expect(result.stillAspectSource).toBe("photoCapabilities");
    expect(result.photoMax).toEqual({ width: 4000, height: 3000 });
    expect(result.stillAspect).toBeCloseTo(4 / 3, 10);
    expect(result.comparison.fovMismatch).toBe(false);
    expect(result.requested).toEqual(previewSizingFor(4 / 3, true));
    expect(result.settings).toEqual({
      width: 1080,
      height: 1440,
      frameRate: 30,
    });
  });

  it("a 16:9 photo: the running track is asked again in 16:9", async () => {
    const { track, applied } = fakeTrack({
      settings: { width: 1080, height: 1440 },
      followRequests: true,
    });
    const { Ctor } = fakeImageCapture(CAPS_169);
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(applied).toEqual([previewSizingFor(16 / 9, true)]);
    expect(applied[0].height.ideal).toBe(1920);
    expect(result.reapplied).toEqual({ applied: true });
    expect(result.requested).toEqual(previewSizingFor(16 / 9, true));
    expect(result.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(result.comparison.fovMismatch).toBe(false);
  });

  it("no ImageCapture (Safari, Firefox): the photo is a canvas frame of the preview, so it is a match: nothing is asked, retried or flagged", async () => {
    // Whatever shape the browser answered, a frame grabbed from the preview has
    // the preview's own field of view: there is nothing to compare it with.
    const { track, applied } = fakeTrack({
      settings: { width: 1080, height: 1920 },
    });
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: null,
      portrait: true,
    });
    expect(applied).toEqual([]);
    expect(result.sizeRequests).toBe(0);
    expect(result.stillAspectSource).toBe("canvas");
    expect(result.photoMax).toBeNull();
    expect(result.reapplied).toBeNull();
    expect(result.orientationRetry).toBeNull();
    expect(result.stillAspect).toBeCloseTo(16 / 9, 10);
    expect(result.comparison).toMatchObject({
      aspectDiff: 0,
      fovMismatch: false,
    });
    expect(result.comparison.previewAspect).toBeCloseTo(16 / 9, 10);
    expect(result.requested).toEqual(previewSizingFor(4 / 3, true));
  });

  it("no ImageCapture and a track whose settings cannot be read: still a match, with the preview's shape unknown", async () => {
    const { track, applied } = fakeTrack({ settingsThrow: true });
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: null,
      portrait: true,
    });
    expect(applied).toEqual([]);
    expect(result.comparison.fovMismatch).toBe(false);
    expect(result.comparison.previewAspect).toBeNull();
    expect(result.settings).toBeNull();
  });

  it("an ImageCapture that throws or rejects leaves the default shape in place", async () => {
    for (const mode of ["constructorThrows", "rejects"] as const) {
      const { track, applied } = fakeTrack({});
      const { Ctor } = fakeImageCapture(CAPS_169, mode);
      const result = await alignPreviewToStill({
        track,
        ImageCaptureCtor: Ctor,
        portrait: true,
      });
      expect(applied, mode).toEqual([]);
      expect(result.stillAspectSource, mode).toBe("default");
      expect(result.reapplied, mode).toBeNull();
    }
  });

  it("an ImageCapture that will not say what size its photos are: 4:3 is assumed, a mismatch is flagged, and the swap is tried once", async () => {
    const { track, applied } = fakeTrack({
      settings: { width: 1080, height: 1920 },
    });
    const { Ctor } = fakeImageCapture(CAPS_43, "rejects");
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(result.stillAspectSource).toBe("default");
    expect(result.comparison.fovMismatch).toBe(true);
    expect(applied).toEqual([
      previewSizingFor(4 / 3, false),
      previewSizingFor(4 / 3, true),
    ]);
    expect(result.orientationRetry).toEqual({ applied: true, kept: false });
    expect(result.requested).toEqual(previewSizingFor(4 / 3, true));
    expect(result.sizeRequests).toBe(2);
  });

  it("a camera that never answers the photo-size question: the preview is taken as it is after the timeout", async () => {
    const { track, applied } = fakeTrack({});
    class NeverAnswers {
      getPhotoCapabilities() {
        return new Promise<never>(() => undefined);
      }
    }
    const started = Date.now();
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: NeverAnswers,
      portrait: true,
      capabilitiesTimeoutMs: 30,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.stillAspectSource).toBe("default");
    expect(applied).toEqual([]);
  });

  it("capabilities that are nonsense are ignored", async () => {
    const { track, applied } = fakeTrack({});
    const { Ctor } = fakeImageCapture({
      imageWidth: { max: 10 },
      imageHeight: { max: 1000 },
    });
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(applied).toEqual([]);
    expect(result.stillAspectSource).toBe("default");
  });

  it("a track that refuses the new constraint is reported, and the first request stands", async () => {
    const { track, applied } = fakeTrack({
      settings: { width: 1080, height: 1440 },
      applyThrows: new DOMException("no", "OverconstrainedError"),
    });
    const { Ctor } = fakeImageCapture(CAPS_169);
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    // The 16:9 request was refused. The track has been asked once, so the
    // swapped retry is not made: two size requests at most in all.
    expect(applied).toHaveLength(1);
    expect(result.sizeRequests).toBe(1);
    expect(result.reapplied).toEqual({
      applied: false,
      reason: "OverconstrainedError",
    });
    expect(result.orientationRetry).toBeNull();
    expect(result.requested).toEqual(previewSizingFor(4 / 3, true));
    expect(result.comparison.fovMismatch).toBe(true);
  });

  it("a browser that reads width and height in the sensor's wide orientation: the swapped request is the one that works, and it stays", async () => {
    // Asked upright (height > width) it answers 16:9; asked wide it answers 3:4 upright.
    const { track, applied } = fakeTrack({
      settings: { width: 1080, height: 1920 },
      respond: (c) =>
        c.height.ideal > c.width.ideal
          ? { width: 1080, height: 1920 }
          : { width: 1080, height: 1440 },
    });
    const { Ctor } = fakeImageCapture(CAPS_43);
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(applied).toEqual([previewSizingFor(4 / 3, false)]);
    expect(result.orientationRetry).toEqual({ applied: true, kept: true });
    expect(result.requested).toEqual(previewSizingFor(4 / 3, false));
    expect(result.settings).toMatchObject({ width: 1080, height: 1440 });
    expect(result.comparison.fovMismatch).toBe(false);
  });

  it("a swapped request that gives a wide stream on an upright phone is dropped, even if its shape is right", async () => {
    const { track, applied } = fakeTrack({
      settings: { width: 1080, height: 1920 },
      respond: (c) =>
        c.height.ideal > c.width.ideal
          ? { width: 1080, height: 1920 }
          : { width: 1440, height: 1080 },
    });
    const { Ctor } = fakeImageCapture(CAPS_43);
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(applied).toEqual([
      previewSizingFor(4 / 3, false),
      previewSizingFor(4 / 3, true),
    ]);
    expect(result.orientationRetry).toEqual({ applied: true, kept: false });
    expect(result.requested).toEqual(previewSizingFor(4 / 3, true));
    expect(result.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(result.comparison.fovMismatch).toBe(true);
  });

  it("the swap is tried once, and only after a mismatch: a match asks nothing more", async () => {
    const { track, applied } = fakeTrack({
      settings: { width: 1080, height: 1450 },
    });
    const { Ctor } = fakeImageCapture(CAPS_43);
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(applied).toEqual([]);
    expect(result.orientationRetry).toBeNull();
  });

  it("a track whose settings cannot be read leaves the comparison unknown", async () => {
    const { track } = fakeTrack({ settingsThrow: true });
    const { Ctor } = fakeImageCapture(CAPS_43);
    const result = await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: true,
    });
    expect(result.settings).toBeNull();
    expect(result.comparison.fovMismatch).toBeNull();
  });

  it("held wide, the sizing it asks for is wide", async () => {
    const { track, applied } = fakeTrack({
      settings: { width: 1440, height: 1080 },
      followRequests: true,
    });
    const { Ctor } = fakeImageCapture(CAPS_169);
    await alignPreviewToStill({
      track,
      ImageCaptureCtor: Ctor,
      portrait: false,
    });
    expect(applied[0].width.ideal).toBe(1920);
    expect(applied[0].height.ideal).toBe(1080);
  });

  describe("how many times the running track is asked for a size", () => {
    it("never more than twice, whatever the camera answers", async () => {
      const cases = [
        { caps: CAPS_43, settings: { width: 1080, height: 1920 } },
        { caps: CAPS_169, settings: { width: 1080, height: 1440 } },
        { caps: CAPS_169, settings: { width: 1080, height: 1200 } },
        { caps: CAPS_43, settings: { width: 1080, height: 1440 } },
      ];
      for (const [i, c] of cases.entries()) {
        for (const respond of [
          undefined,
          () => ({ width: 1080, height: 1920 }),
          () => ({ width: 1440, height: 1080 }),
        ]) {
          const { track, applied } = fakeTrack({
            settings: c.settings,
            respond,
          });
          const { Ctor } = fakeImageCapture(c.caps);
          const result = await alignPreviewToStill({
            track,
            ImageCaptureCtor: Ctor,
            portrait: true,
          });
          expect(applied.length, `case ${i}`).toBeLessThanOrEqual(2);
          expect(result.sizeRequests, `case ${i}`).toBe(applied.length);
        }
      }
    });

    it("a 4:3 photo that matches costs none; one that does not costs the swap and, if that did no better, putting the first request back", async () => {
      const match = fakeTrack({});
      await alignPreviewToStill({
        track: match.track,
        ImageCaptureCtor: fakeImageCapture(CAPS_43).Ctor,
        portrait: true,
      });
      expect(match.applied).toHaveLength(0);

      const mismatch = fakeTrack({ settings: { width: 1080, height: 1920 } });
      const result = await alignPreviewToStill({
        track: mismatch.track,
        ImageCaptureCtor: fakeImageCapture(CAPS_43).Ctor,
        portrait: true,
      });
      expect(mismatch.applied).toHaveLength(2);
      expect(result.sizeRequests).toBe(2);
    });

    it("a photo that is not 4:3 costs one request, and the swap is not tried on top of it", async () => {
      const { track, applied } = fakeTrack({
        settings: { width: 1080, height: 1440 },
        respond: () => ({ width: 1080, height: 1440 }),
      });
      const result = await alignPreviewToStill({
        track,
        ImageCaptureCtor: fakeImageCapture(CAPS_169).Ctor,
        portrait: true,
      });
      expect(applied).toEqual([previewSizingFor(16 / 9, true)]);
      expect(result.sizeRequests).toBe(1);
      expect(result.comparison.fovMismatch).toBe(true);
      expect(result.orientationRetry).toBeNull();
    });
  });
});

describe("alignAndSettle — the shutter never waits for ever", () => {
  it("a camera that answers: settled when the alignment is done, not timed out, and the alignment comes through", async () => {
    const { track } = fakeTrack({ settings: { width: 1080, height: 1440 } });
    const { alignment, settled } = alignAndSettle({
      track,
      ImageCaptureCtor: fakeImageCapture(CAPS_43).Ctor,
      portrait: true,
      settleTimeoutMs: 2000,
    });
    expect(await settled).toEqual({ settleTimedOut: false });
    expect((await alignment)?.comparison.fovMismatch).toBe(false);
  });

  it("applyConstraints that never resolves: it is settled anyway at the limit, with settleTimedOut true", async () => {
    // A photo that is not 4:3 makes a size request; the track never answers it.
    const applied: PreviewSizing[] = [];
    const track: PreviewTrackLike = {
      getSettings: () => ({ width: 1080, height: 1440 }),
      applyConstraints: (constraints) => {
        applied.push(constraints);
        return new Promise<void>(() => undefined);
      },
    };
    const started = Date.now();
    const { settled } = alignAndSettle({
      track,
      ImageCaptureCtor: fakeImageCapture(CAPS_169).Ctor,
      portrait: true,
      settleTimeoutMs: 40,
    });
    expect(await settled).toEqual({ settleTimedOut: true });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(applied).toHaveLength(1);
  });

  it("a camera that never answers the photo-size question settles at the limit too", async () => {
    const { track } = fakeTrack({});
    class NeverAnswers {
      getPhotoCapabilities() {
        return new Promise<never>(() => undefined);
      }
    }
    const { settled } = alignAndSettle({
      track,
      ImageCaptureCtor: NeverAnswers,
      portrait: true,
      settleTimeoutMs: 40,
      capabilitiesTimeoutMs: 100000,
    });
    expect(await settled).toEqual({ settleTimedOut: true });
  });

  it("an alignment that comes after the limit is still delivered", async () => {
    const { track } = fakeTrack({ settings: { width: 1080, height: 1440 } });
    class Slow {
      async getPhotoCapabilities() {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return CAPS_43;
      }
    }
    const { alignment, settled } = alignAndSettle({
      track,
      ImageCaptureCtor: Slow,
      portrait: true,
      settleTimeoutMs: 30,
    });
    expect(await settled).toEqual({ settleTimedOut: true });
    expect((await alignment)?.stillAspectSource).toBe("photoCapabilities");
  });

  it("an alignment that fails is not an error: null, and the shutter is not held", async () => {
    const track: PreviewTrackLike = {
      getSettings: () => {
        throw new Error("gone");
      },
      applyConstraints: async () => undefined,
    };
    const { alignment, settled } = alignAndSettle({
      track,
      ImageCaptureCtor: null,
      portrait: true,
      settleTimeoutMs: 2000,
    });
    expect(await settled).toEqual({ settleTimedOut: false });
    expect(await alignment).not.toBeUndefined();
  });

  it("the limit is the candidate in the constants when none is given", async () => {
    const { track } = fakeTrack({ settings: { width: 1080, height: 1440 } });
    const { settled } = alignAndSettle({
      track,
      ImageCaptureCtor: fakeImageCapture(CAPS_43).Ctor,
      portrait: true,
    });
    expect(await settled).toEqual({ settleTimedOut: false });
  });
});

describe("framePreviewConstraints — the request while the capture is a frame of the video", () => {
  it("is the request that worked on the S25 before the photo-shaped one: 1920x1080 ideal in the camera's landscape terms, no aspectRatio, resizeMode none", () => {
    expect(framePreviewConstraints()).toEqual({
      facingMode: "environment",
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      resizeMode: { ideal: "none" },
    });
  });

  it("has no aspectRatio (the photo-shaped request that came back as a 1088x1088 square) and does not depend on the way the phone is held", () => {
    const constraints = framePreviewConstraints() as Record<string, unknown>;
    expect("aspectRatio" in constraints).toBe(false);
    expect(JSON.stringify(framePreviewConstraints())).toBe(
      JSON.stringify(framePreviewConstraints()),
    );
  });
});
