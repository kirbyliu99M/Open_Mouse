import { describe, expect, it } from "vitest";
import {
  analysisFrames,
  assumedDetectionFocalPx,
  assumedSampleFocalPx,
  rectCentre,
  toFullFrame,
  frameDrawArgs,
  visibleRectInStill,
  visibleRectInStream,
  visibleRegionInStream,
  type PixelRect,
} from "../../src/client/camera/visibleView";
import { centrePrincipalPoint } from "../../src/client/geometry/camera-pose";
import {
  computeCoverRect,
  mapMediaPointToContainer,
} from "../../src/client/camera/quad";
import { computeDownscaleSize } from "../../src/client/photo/decode";
import { assumedFocalPxFromFov } from "../../src/client/paper/orientation";

const PHONE = { width: 390, height: 844 };

describe("visibleRectInStream", () => {
  it("a 3:4 stream on a 390x844 screen: 62 % of the width is on screen, the whole height", () => {
    const visible = visibleRectInStream({ width: 1080, height: 1440 }, PHONE)!;
    expect(visible.width / 1080).toBeCloseTo(0.616, 3);
    expect(visible.width).toBeCloseTo(390 / (844 / 1440), 6);
    expect(visible.height).toBe(1440);
    expect(visible.y).toBe(0);
    expect(visible.x).toBeCloseTo((1080 - visible.width) / 2, 6);
  });

  it("a 9:16 stream on the same screen shows 82 % of its width (the figure the review gave)", () => {
    const visible = visibleRectInStream({ width: 1080, height: 1920 }, PHONE)!;
    expect(visible.width / 1080).toBeCloseTo(0.821, 3);
    expect(visible.height).toBe(1920);
  });

  it("has the screen's shape, and is centred on the stream", () => {
    for (const stream of [
      { width: 1080, height: 1440 },
      { width: 1080, height: 1920 },
      { width: 1000, height: 1300 },
      { width: 1920, height: 1080 },
      { width: 1440, height: 1080 },
    ]) {
      for (const screen of [
        PHONE,
        { width: 360, height: 640 },
        { width: 844, height: 390 },
        { width: 820, height: 1180 },
        { width: 500, height: 500 },
      ]) {
        const visible = visibleRectInStream(stream, screen)!;
        const label = `${stream.width}x${stream.height} on ${screen.width}x${screen.height}`;
        expect(visible.width / visible.height, label).toBeCloseTo(
          screen.width / screen.height,
          6,
        );
        expect(rectCentre(visible).x, label).toBeCloseTo(stream.width / 2, 6);
        expect(rectCentre(visible).y, label).toBeCloseTo(stream.height / 2, 6);
        // On one axis it is the whole stream.
        expect(
          Math.abs(visible.width - stream.width) < 1e-6 ||
            Math.abs(visible.height - stream.height) < 1e-6,
          label,
        ).toBe(true);
        expect(visible.x, label).toBeGreaterThanOrEqual(0);
        expect(visible.y, label).toBeGreaterThanOrEqual(0);
        expect(visible.x + visible.width, label).toBeLessThanOrEqual(
          stream.width + 1e-6,
        );
        expect(visible.y + visible.height, label).toBeLessThanOrEqual(
          stream.height + 1e-6,
        );
      }
    }
  });

  it("held wide, a screen wider than the stream trims the top and bottom instead", () => {
    const visible = visibleRectInStream(
      { width: 1440, height: 1080 },
      { width: 844, height: 390 },
    )!;
    expect(visible.x).toBe(0);
    expect(visible.width).toBe(1440);
    expect(visible.height).toBeCloseTo(390 / (844 / 1440), 6);
    expect(visible.y).toBeCloseTo((1080 - visible.height) / 2, 6);
  });

  it("a screen with the stream's own shape shows all of it", () => {
    expect(
      visibleRectInStream(
        { width: 1080, height: 1440 },
        { width: 450, height: 600 },
      ),
    ).toEqual({ x: 0, y: 0, width: 1080, height: 1440 });
  });

  it("is null for a size that is missing, zero, negative or not a number", () => {
    const good = { width: 1080, height: 1440 };
    expect(visibleRectInStream(null, PHONE)).toBeNull();
    expect(visibleRectInStream(good, undefined)).toBeNull();
    expect(visibleRectInStream({ width: 0, height: 1440 }, PHONE)).toBeNull();
    expect(visibleRectInStream(good, { width: -1, height: 844 })).toBeNull();
    expect(visibleRectInStream(good, { width: NaN, height: 844 })).toBeNull();
  });
});

describe("visibleRectInStill", () => {
  const decoded = { width: 2250, height: 3000 };

  it("the same field of view: the region is the screen's share of the photo, scaled in proportion", () => {
    const stream = { width: 1080, height: 1440 };
    const visible = visibleRectInStream(stream, PHONE)!;
    const result = visibleRectInStill(decoded, stream, visible)!;
    expect(result.model).toBe("same-view");
    expect(result.modelApplies).toBe(true);
    expect(result.aspectDiff).toBeCloseTo(0, 6);
    // 61.6 % of the width (1386 of 2250), the whole height, 432 px in from each side.
    expect(result.crop).toEqual({ x: 432, y: 0, width: 1386, height: 3000 });
    expect(result.crop!.width / result.crop!.height).toBeCloseTo(
      PHONE.width / PHONE.height,
      2,
    );
  });

  it("Kirby's S25 shape: a 9:16 stream and a 3:4 photo are cropped to the same middle of the photo", () => {
    const stream = { width: 1080, height: 1920 };
    const visible = visibleRectInStream(stream, PHONE)!;
    const result = visibleRectInStill(decoded, stream, visible)!;
    expect(result.model).toBe("stream-in-still");
    expect(result.modelApplies).toBe(true);
    expect(result.aspectDiff).toBeCloseTo(1 / 3, 3);
    // Same screen, same camera, same place: the region on screen is the same
    // part of the photo whichever shape the preview had (to a couple of pixels).
    const sameView = visibleRectInStill(
      decoded,
      { width: 1080, height: 1440 },
      visibleRectInStream({ width: 1080, height: 1440 }, PHONE)!,
    )!;
    expect(Math.abs(result.crop!.x - sameView.crop!.x)).toBeLessThanOrEqual(3);
    expect(
      Math.abs(result.crop!.width - sameView.crop!.width),
    ).toBeLessThanOrEqual(6);
    expect(result.crop!.y).toBe(0);
    expect(result.crop!.height).toBe(3000);
  });

  it("the sheet the person framed to fill 85 % of the screen's width fills 85 % of the region", () => {
    // A sheet 85 % of the visible width, centred, in stream pixels, carried to the photo.
    const stream = { width: 1080, height: 1920 };
    const visible = visibleRectInStream(stream, PHONE)!;
    const crop = visibleRectInStill(decoded, stream, visible)!.crop!;
    const sheetOnScreen = 0.85 * visible.width;
    // The stream is the middle 1686 of the photo's 2250 columns (1080 px across).
    const sheetInPhoto = (sheetOnScreen / 1080) * 1686;
    expect(sheetInPhoto / crop.width).toBeCloseTo(0.85, 1);
  });

  it("the stream is the WIDER view: the model cannot hold, and it says so; the region is in proportion", () => {
    const stream = { width: 1080, height: 1200 }; // 1.11 against the photo's 1.33
    const visible = visibleRectInStream(stream, PHONE)!;
    const result = visibleRectInStill(decoded, stream, visible)!;
    expect(result.model).toBe("stream-wider");
    expect(result.modelApplies).toBe(false);
    expect(result.aspectDiff).toBeLessThan(-0.02);
    expect(result.crop).not.toBeNull();
    expect(rectCentre(result.crop!).x).toBe(decoded.width / 2);
  });

  it("an upright stream and a wide photo (or the reverse) are not matched: the whole photo", () => {
    const result = visibleRectInStill(
      { width: 3000, height: 2250 },
      { width: 1080, height: 1440 },
      { x: 200, y: 0, width: 680, height: 1440 },
    )!;
    expect(result.model).toBe("orientation-differs");
    expect(result.modelApplies).toBe(false);
    expect(result.crop).toBeNull();
  });

  it("a screen with the stream's shape shows it all: no crop", () => {
    const stream = { width: 1080, height: 1440 };
    const visible = visibleRectInStream(stream, { width: 450, height: 600 })!;
    expect(visibleRectInStill(decoded, stream, visible)!.crop).toBeNull();
  });

  it("held wide it trims the height", () => {
    const stream = { width: 1920, height: 1080 };
    const screen = { width: 844, height: 390 };
    const still = { width: 4000, height: 3000 };
    const result = visibleRectInStill(
      still,
      stream,
      visibleRectInStream(stream, screen)!,
    )!;
    expect(result.model).toBe("stream-in-still");
    // The width is the whole width; the height is trimmed top and bottom.
    expect(result.crop!.x).toBe(0);
    expect(result.crop!.width).toBe(4000);
    expect(result.crop!.y).toBeGreaterThan(0);
    expect(result.crop!.width / result.crop!.height).toBeCloseTo(844 / 390, 1);
  });

  it("the shapes agree within the tolerance: the same view; beyond it, not", () => {
    const stream = { width: 1000, height: 1300 }; // 1.3
    const visible = visibleRectInStream(stream, PHONE)!;
    // 1.3 against 1.333 is 2.5 % off: past the 2 % line.
    expect(
      visibleRectInStill({ width: 3000, height: 4000 }, stream, visible)!.model,
    ).toBe("stream-wider");
    // Against 1.32 it is within.
    expect(
      visibleRectInStill({ width: 1000, height: 1320 }, stream, visible)!.model,
    ).toBe("same-view");
    // The tolerance is an argument.
    expect(
      visibleRectInStill({ width: 3000, height: 4000 }, stream, visible, 0.05)!
        .model,
    ).toBe("same-view");
  });

  it("every crop is whole pixels, inside the photo, with equal margins: the photo's centre is the crop's centre", () => {
    const stills = [
      { width: 2250, height: 3000 },
      { width: 2251, height: 3001 },
      { width: 3000, height: 4000 },
      { width: 1999, height: 3000 },
      { width: 1500, height: 2000 },
      { width: 3000, height: 2250 },
      { width: 4000, height: 3000 },
    ];
    const streams = [
      { width: 1080, height: 1920 },
      { width: 1080, height: 1440 },
      { width: 1000, height: 1300 },
      { width: 720, height: 1280 },
      { width: 1920, height: 1080 },
      { width: 1440, height: 1080 },
    ];
    const screens = [
      PHONE,
      { width: 360, height: 640 },
      { width: 412, height: 915 },
      { width: 844, height: 390 },
      { width: 820, height: 1180 },
    ];
    let crops = 0;
    for (const still of stills)
      for (const stream of streams)
        for (const screen of screens) {
          const result = visibleRectInStill(
            still,
            stream,
            visibleRectInStream(stream, screen)!,
          )!;
          const crop = result.crop;
          if (!crop) continue;
          crops++;
          const label = `${still.width}x${still.height} / ${stream.width}x${stream.height} / ${screen.width}x${screen.height}`;
          for (const n of [crop.x, crop.y, crop.width, crop.height])
            expect(Number.isInteger(n), label).toBe(true);
          expect(crop.x, label).toBeGreaterThanOrEqual(0);
          expect(crop.y, label).toBeGreaterThanOrEqual(0);
          expect(crop.width, label).toBeGreaterThanOrEqual(1);
          expect(crop.height, label).toBeGreaterThanOrEqual(1);
          expect(crop.x + crop.width, label).toBeLessThanOrEqual(still.width);
          expect(crop.y + crop.height, label).toBeLessThanOrEqual(still.height);
          if (result.model !== "orientation-differs")
            expect(rectCentre(crop), label).toEqual({
              x: still.width / 2,
              y: still.height / 2,
            });
        }
    expect(crops).toBeGreaterThan(40);
  });

  it("the region never shows more than the screen did: it is no wider or taller than the screen's share, to a pixel or two", () => {
    const stream = { width: 1080, height: 1440 };
    const visible = visibleRectInStream(stream, PHONE)!;
    const crop = visibleRectInStill(decoded, stream, visible)!.crop!;
    expect(crop.width).toBeLessThanOrEqual(
      Math.ceil((visible.width / stream.width) * decoded.width),
    );
  });

  it("returns null for sizes that are missing, zero or not numbers", () => {
    const stream = { width: 1080, height: 1440 };
    const visible = { x: 100, y: 0, width: 800, height: 1440 };
    expect(visibleRectInStill(null, stream, visible)).toBeNull();
    expect(visibleRectInStill(decoded, undefined, visible)).toBeNull();
    expect(visibleRectInStill(decoded, stream, null)).toBeNull();
    expect(
      visibleRectInStill({ width: 0, height: 3000 }, stream, visible),
    ).toBeNull();
    expect(
      visibleRectInStill(decoded, stream, { ...visible, width: 0 }),
    ).toBeNull();
    expect(
      visibleRectInStill(decoded, stream, { ...visible, x: NaN }),
    ).toBeNull();
  });
});

describe("toFullFrame", () => {
  const crop: PixelRect = { x: 432, y: 0, width: 1386, height: 3000 };

  it("puts a point of the cropped photo back where it is in the whole photo", () => {
    expect(toFullFrame({ x: 0, y: 0 }, crop)).toEqual({ x: 432, y: 0 });
    expect(toFullFrame({ x: 693, y: 1500 }, crop)).toEqual({
      x: 1125,
      y: 1500,
    });
    // The centre of the cropped photo is the centre of the whole one.
    expect(toFullFrame({ x: 1386 / 2, y: 3000 / 2 }, crop)).toEqual({
      x: 2250 / 2,
      y: 3000 / 2,
    });
  });

  it("moves a point on a wide crop vertically", () => {
    expect(
      toFullFrame(
        { x: 10, y: 20 },
        { x: 0, y: 375, width: 4000, height: 2250 },
      ),
    ).toEqual({ x: 10, y: 395 });
  });

  it("leaves a point alone when there was no crop, and does not hand back the same object", () => {
    const point = { x: 5, y: 6 };
    const moved = toFullFrame(point, null);
    expect(moved).toEqual({ x: 5, y: 6 });
    expect(moved).not.toBe(point);
  });
});

describe("analysisFrames and the detector's assumed focal length — what a crop must not change", () => {
  const decoded = { width: 2250, height: 3000 };
  const crop = { x: 432, y: 0, width: 1386, height: 3000 };

  it("the focal length is always worked out from the whole decoded photo, cropped or not", () => {
    expect(analysisFrames(decoded, crop).focalFrame).toEqual(decoded);
    expect(analysisFrames(decoded, null).focalFrame).toEqual(decoded);
  });

  it("the principal point comes from the analysed image, and for a centred crop that is the whole photo's centre", () => {
    const { principalFrame } = analysisFrames(decoded, crop);
    expect(principalFrame).toEqual({ width: 1386, height: 3000 });
    const inCrop = centrePrincipalPoint(
      principalFrame.width,
      principalFrame.height,
    );
    const wholePhoto = centrePrincipalPoint(decoded.width, decoded.height);
    expect(toFullFrame({ x: inCrop.cx, y: inCrop.cy }, crop)).toEqual({
      x: wholePhoto.cx,
      y: wholePhoto.cy,
    });
  });

  it("with no crop both frames are the decoded photo, as copies", () => {
    const frames = analysisFrames(decoded, null);
    expect(frames).toEqual({ focalFrame: decoded, principalFrame: decoded });
    expect(frames.focalFrame).not.toBe(decoded);
    expect(frames.principalFrame).not.toBe(decoded);
  });

  it("the focal length the paper detector assumes is the same cropped or not, and is not the crop's", () => {
    const cropped = assumedDetectionFocalPx(analysisFrames(decoded, crop));
    const whole = assumedDetectionFocalPx(analysisFrames(decoded, null));
    expect(cropped).toBe(whole);
    expect(cropped).toBeCloseTo(assumedFocalPxFromFov(decoded.width), 9);
    // What it used to be (the cropped width's) is a different number.
    expect(cropped).not.toBeCloseTo(assumedFocalPxFromFov(crop.width), 0);
  });
});

describe("the live loop's corner coordinates: a sample of the visible part lands where the stream's own point lands on screen", () => {
  // The loop draws only the visible rectangle into the sample canvas and maps
  // the detector's corners back onto the stage with the cover rectangle of the
  // SAMPLE (the stage's shape, so nearly a plain scale). That must agree with
  // mapping the same point of the whole stream through the cover rectangle of
  // the stream (what the loop did before it sampled the visible part).
  const longEdge = 640;

  it("agrees to under 2 px for portrait and wide screens, narrower and wider than the stream", () => {
    const streams = [
      { width: 1080, height: 1440 },
      { width: 1080, height: 1920 },
      { width: 1000, height: 1300 },
      { width: 1440, height: 1080 },
    ];
    const screens = [
      PHONE,
      { width: 360, height: 640 },
      { width: 412, height: 915 },
      { width: 844, height: 390 },
      { width: 820, height: 1180 },
    ];
    let compared = 0;
    for (const stream of streams)
      for (const screen of screens) {
        const visible = visibleRectInStream(stream, screen)!;
        const sample = computeDownscaleSize(
          Math.max(1, Math.round(visible.width)),
          Math.max(1, Math.round(visible.height)),
          longEdge,
        );
        const sampleCover = computeCoverRect(
          screen.width,
          screen.height,
          sample.width,
          sample.height,
        );
        const streamCover = computeCoverRect(
          screen.width,
          screen.height,
          stream.width,
          stream.height,
        );
        for (const [u, v] of [
          [0.5, 0.5],
          [0.3, 0.2],
          [0.7, 0.85],
        ]) {
          // A stream point inside the visible part.
          const point = {
            x: visible.x + u * visible.width,
            y: visible.y + v * visible.height,
          };
          const inSample = {
            x: ((point.x - visible.x) / visible.width) * sample.width,
            y: ((point.y - visible.y) / visible.height) * sample.height,
          };
          const viaSample = mapMediaPointToContainer(
            inSample,
            sampleCover,
            sample.width,
            sample.height,
          );
          const viaStream = mapMediaPointToContainer(
            point,
            streamCover,
            stream.width,
            stream.height,
          );
          const label = `${stream.width}x${stream.height} on ${screen.width}x${screen.height} at ${u},${v}`;
          expect(Math.abs(viaSample.x - viaStream.x), label).toBeLessThan(2);
          expect(Math.abs(viaSample.y - viaStream.y), label).toBeLessThan(2);
          compared++;
        }
      }
    expect(compared).toBe(60);
  });

  it("the sample is smaller than what the detector was given before: 296x640 for a 3:4 stream on 390x844, against 480x640 for the whole stream", () => {
    const visible = visibleRectInStream({ width: 1080, height: 1440 }, PHONE)!;
    const sample = computeDownscaleSize(
      Math.round(visible.width),
      Math.round(visible.height),
      longEdge,
    );
    expect(sample).toEqual({ width: 296, height: 640 });
    expect(computeDownscaleSize(1080, 1440, longEdge)).toEqual({
      width: 480,
      height: 640,
    });
    // And against the 9:16 whole stream the loop looked at before this change.
    expect(computeDownscaleSize(1080, 1920, longEdge)).toEqual({
      width: 360,
      height: 640,
    });
  });
});

describe("assumedSampleFocalPx — the live detector's assumed focal length is the whole stream's", () => {
  const stream = { width: 1080, height: 1440 };

  it("with the whole stream as the sample it is the number the detector assumed before", () => {
    const sample = { width: 480, height: 640 };
    expect(
      assumedSampleFocalPx(
        stream,
        { x: 0, y: 0, width: 1080, height: 1440 },
        sample,
      ),
    ).toBeCloseTo(assumedFocalPxFromFov(sample.width), 9);
  });

  it("for the visible part it is the whole stream's focal length in the sample's pixels, not the narrower sample's own", () => {
    const visible = visibleRectInStream(stream, PHONE)!;
    const sample = { width: 296, height: 640 };
    const focal = assumedSampleFocalPx(stream, visible, sample);
    // One stream pixel is sample.width / visible.width sample pixels.
    expect(focal).toBeCloseTo(
      assumedFocalPxFromFov(stream.width) * (296 / visible.width),
      9,
    );
    // The narrower picture is not read as a wider view: the old assumption
    // (from the sample's own width) is smaller.
    expect(focal).toBeGreaterThan(assumedFocalPxFromFov(sample.width) * 1.3);
  });

  it("is the same whichever screen shape shows the same stream, to the rounding of the sample", () => {
    // A focal length is a property of the lens: scaled back to stream pixels
    // it is the same for every screen.
    const fromStreamPx = (screen: { width: number; height: number }) => {
      const visible = visibleRectInStream(stream, screen)!;
      const sample = {
        width: Math.round((visible.width * 640) / visible.height),
        height: 640,
      };
      return (
        assumedSampleFocalPx(stream, visible, sample) *
        (visible.width / sample.width)
      );
    };
    const reference = assumedFocalPxFromFov(stream.width);
    for (const screen of [
      PHONE,
      { width: 360, height: 640 },
      { width: 412, height: 915 },
    ])
      expect(fromStreamPx(screen)).toBeCloseTo(reference, 6);
  });
});

describe("visibleRegionInStream — one region, used by the live detector and by the shutter", () => {
  // Kirby's S25 after #132 (2026-10-06): the stream was a 1088x1088 square and
  // the screen showed x 253.7, width 580.6 of it, the whole 1088 height. A
  // screen of 412x772 CSS px has that shape.
  const S25_STREAM = { width: 1088, height: 1088 };
  const S25_SCREEN = { width: 412, height: 772 };

  it("the S25's numbers: the region on screen is x 253.7, width 580.6, the whole height; the capture is the same to the pixel", () => {
    const region = visibleRegionInStream(S25_STREAM, S25_SCREEN)!;
    expect(region.visible.x).toBeCloseTo(253.7, 0);
    expect(region.visible.width).toBeCloseTo(580.6, 0);
    expect(region.visible.y).toBe(0);
    expect(region.visible.height).toBeCloseTo(1088, 6);
    // Whole pixels, each edge rounded: 253.67 -> 254, 834.33 -> 834.
    expect(region.capture).toEqual({ x: 254, y: 0, width: 580, height: 1088 });
  });

  it("the shutter's region is the live detector's region: the same function gives both, and the capture is the visible one with each edge rounded", () => {
    for (const stream of [
      S25_STREAM,
      { width: 1080, height: 1920 },
      { width: 1080, height: 1440 },
      { width: 1920, height: 1080 },
      { width: 800, height: 1300 },
    ])
      for (const screen of [
        S25_SCREEN,
        PHONE,
        { width: 360, height: 640 },
        { width: 844, height: 390 },
        { width: 820, height: 1180 },
      ]) {
        const region = visibleRegionInStream(stream, screen)!;
        const label = `${stream.width}x${stream.height} on ${screen.width}x${screen.height}`;
        // The detector's rectangle is visibleRectInStream's, untouched.
        expect(region.visible, label).toEqual(
          visibleRectInStream(stream, screen),
        );
        const { visible, capture } = region;
        for (const n of [capture.x, capture.y, capture.width, capture.height])
          expect(Number.isInteger(n), label).toBe(true);
        // Each edge within half a pixel of the detector's.
        expect(Math.abs(capture.x - visible.x), label).toBeLessThanOrEqual(0.5);
        expect(Math.abs(capture.y - visible.y), label).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(capture.x + capture.width - (visible.x + visible.width)),
          label,
        ).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(
          Math.abs(capture.y + capture.height - (visible.y + visible.height)),
          label,
        ).toBeLessThanOrEqual(0.5 + 1e-9);
        // Inside the stream, never empty.
        expect(capture.x, label).toBeGreaterThanOrEqual(0);
        expect(capture.y, label).toBeGreaterThanOrEqual(0);
        expect(capture.width, label).toBeGreaterThanOrEqual(1);
        expect(capture.height, label).toBeGreaterThanOrEqual(1);
        expect(capture.x + capture.width, label).toBeLessThanOrEqual(
          stream.width,
        );
        expect(capture.y + capture.height, label).toBeLessThanOrEqual(
          stream.height,
        );
      }
  });

  it("is not the whole stream: a tall screen cuts a square or 3:4 stream's sides, a wide screen the top and bottom", () => {
    const upright = visibleRegionInStream(S25_STREAM, S25_SCREEN)!.capture;
    expect(upright.width).toBeLessThan(S25_STREAM.width);
    expect(upright.height).toBe(S25_STREAM.height);
    const wide = visibleRegionInStream(
      { width: 1920, height: 1080 },
      { width: 844, height: 390 },
    )!.capture;
    expect(wide.width).toBe(1920);
    expect(wide.height).toBeLessThan(1080);
  });

  it("a screen with the stream's own shape shows it all", () => {
    expect(
      visibleRegionInStream(
        { width: 1080, height: 1920 },
        { width: 360, height: 640 },
      )!.capture,
    ).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it("edges that would round outside the stream are kept inside, and a sliver is still a pixel", () => {
    const region = visibleRegionInStream(
      { width: 100, height: 100 },
      { width: 1, height: 1000 },
    )!;
    expect(region.capture.width).toBeGreaterThanOrEqual(1);
    expect(region.capture.x + region.capture.width).toBeLessThanOrEqual(100);
  });

  it("is null for sizes that are missing, zero or not numbers", () => {
    expect(visibleRegionInStream(null, PHONE)).toBeNull();
    expect(
      visibleRegionInStream({ width: 100, height: 100 }, undefined),
    ).toBeNull();
    expect(visibleRegionInStream({ width: 0, height: 100 }, PHONE)).toBeNull();
    expect(
      visibleRegionInStream(
        { width: 100, height: 100 },
        { width: NaN, height: 5 },
      ),
    ).toBeNull();
  });
});

describe("frameDrawArgs — what drawImage is given to copy the region 1:1", () => {
  it("source is the capture rectangle, destination is the origin at the same size, and the canvas is that size", () => {
    const capture = { x: 254, y: 0, width: 580, height: 1088 };
    expect(frameDrawArgs(capture)).toEqual({
      source: [254, 0, 580, 1088],
      destination: [0, 0, 580, 1088],
      canvas: { width: 580, height: 1088 },
    });
  });

  it("for any region the source never leaves the stream and nothing is scaled", () => {
    for (const stream of [
      { width: 1088, height: 1088 },
      { width: 1080, height: 1920 },
      { width: 1920, height: 1080 },
    ])
      for (const screen of [
        { width: 412, height: 772 },
        PHONE,
        { width: 844, height: 390 },
      ]) {
        const { source, destination, canvas } = frameDrawArgs(
          visibleRegionInStream(stream, screen)!.capture,
        );
        expect(source[0] + source[2]).toBeLessThanOrEqual(stream.width);
        expect(source[1] + source[3]).toBeLessThanOrEqual(stream.height);
        expect(destination[2]).toBe(source[2]);
        expect(destination[3]).toBe(source[3]);
        expect(canvas).toEqual({ width: source[2], height: source[3] });
      }
  });
});
