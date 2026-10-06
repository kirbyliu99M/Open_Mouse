import { describe, expect, it } from "vitest";
import {
  analysisFrames,
  computeFovCrop,
  rectCentre,
  toFullFrame,
  type PixelRect,
} from "../../src/client/camera/fovCrop";
import { computeStillCrop } from "../../src/client/camera/photoLayout";
import { centrePrincipalPoint } from "../../src/client/geometry/camera-pose";

describe("computeFovCrop", () => {
  it("Kirby's S25: a 1080x1920 preview against the photo decoded to 2250x3000 keeps the middle 1686 columns", () => {
    const crop = computeFovCrop(
      { width: 2250, height: 3000 },
      { width: 1080, height: 1920 },
    );
    expect(crop).toEqual({ x: 282, y: 0, width: 1686, height: 3000 });
    // The crop has the preview's shape (to a pixel's worth)...
    expect(crop!.width / crop!.height).toBeCloseTo(1080 / 1920, 3);
    // ...and its edges are the same distance in from both sides.
    expect(crop!.x).toBe(2250 - (crop!.x + crop!.width));
  });

  it("the paper that filled the preview fills the cropped photo the same way: a 75 % share of the photo's width becomes 100 %", () => {
    // 2250 / 3000 = 0.75: the preview's field of view is 3/4 of the photo's width.
    const crop = computeFovCrop(
      { width: 3000, height: 4000 },
      { width: 1080, height: 1920 },
    )!;
    expect(crop.width / 3000).toBeCloseTo(0.75, 2);
    expect(crop.height).toBe(4000);
  });

  it("a photo in the same shape as the preview is not cropped", () => {
    expect(
      computeFovCrop(
        { width: 3000, height: 4000 },
        { width: 1080, height: 1440 },
      ),
    ).toBeNull();
    expect(
      computeFovCrop(
        { width: 4000, height: 3000 },
        { width: 1440, height: 1080 },
      ),
    ).toBeNull();
    expect(
      computeFovCrop(
        { width: 1080, height: 1920 },
        { width: 1080, height: 1920 },
      ),
    ).toBeNull();
  });

  it("within 2 % of the same shape is not cropped; beyond it is", () => {
    const still = { width: 3000, height: 4000 };
    // 1.019 and 1.021 times the still's 4:3 elongation.
    expect(
      computeFovCrop(still, { width: 1000, height: (4000 / 3) * 1.019 }),
    ).toBeNull();
    expect(
      computeFovCrop(still, { width: 1000, height: (4000 / 3) * 1.021 }),
    ).not.toBeNull();
  });

  it("a preview that is the WIDER view is never cropped to: nothing the photo lacks can be cut away", () => {
    expect(
      computeFovCrop(
        { width: 1080, height: 1920 },
        { width: 1080, height: 1440 },
      ),
    ).toBeNull();
    expect(
      computeFovCrop(
        { width: 1920, height: 1080 },
        { width: 1440, height: 1080 },
      ),
    ).toBeNull();
  });

  it("held wide it trims the height instead", () => {
    const crop = computeFovCrop(
      { width: 4000, height: 3000 },
      { width: 1920, height: 1080 },
    );
    expect(crop).toEqual({ x: 0, y: 375, width: 4000, height: 2250 });
  });

  it("an upright photo and a wide preview (or the reverse) are not matched", () => {
    expect(
      computeFovCrop(
        { width: 3000, height: 4000 },
        { width: 1920, height: 1080 },
      ),
    ).toBeNull();
    expect(
      computeFovCrop(
        { width: 4000, height: 3000 },
        { width: 1080, height: 1920 },
      ),
    ).toBeNull();
  });

  it("an odd leftover pixel is trimmed too, so both margins are the same whole number", () => {
    // 2250 - 1687 = 563 is odd: the crop is 1686 wide, 282 in from each side.
    const crop = computeFovCrop(
      { width: 2250, height: 3000 },
      { width: 1080, height: 1920 },
    )!;
    expect(crop.width).toBe(1686);
    // An even leftover is used as it is.
    const even = computeFovCrop(
      { width: 2251, height: 3000 },
      { width: 1080, height: 1920 },
    )!;
    expect(even).toEqual({ x: 282, y: 0, width: 1687, height: 3000 });
  });

  it("returns null for a size that is missing, zero, negative or not a number", () => {
    const good = { width: 3000, height: 4000 };
    const preview = { width: 1080, height: 1920 };
    expect(computeFovCrop(good, null)).toBeNull();
    expect(computeFovCrop(good, undefined)).toBeNull();
    expect(computeFovCrop(good, { width: 0, height: 1920 })).toBeNull();
    expect(computeFovCrop(good, { width: 1080, height: -1 })).toBeNull();
    expect(computeFovCrop(good, { width: NaN, height: 1920 })).toBeNull();
    expect(computeFovCrop({ width: 0, height: 4000 }, preview)).toBeNull();
    expect(
      computeFovCrop({ width: 3000, height: Infinity }, preview),
    ).toBeNull();
  });

  it("two square frames are not cropped", () => {
    expect(
      computeFovCrop(
        { width: 2000, height: 2000 },
        { width: 1080, height: 1080 },
      ),
    ).toBeNull();
  });

  it("an extreme preview still leaves at least one pixel", () => {
    const crop = computeFovCrop(
      { width: 3, height: 4000 },
      { width: 1, height: 100000 },
    )!;
    expect(crop.width).toBeGreaterThanOrEqual(1);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(3);
  });

  it("the tolerance is an argument", () => {
    const still = { width: 3000, height: 4000 };
    const preview = { width: 1000, height: 1400 };
    expect(computeFovCrop(still, preview, 0.02)).not.toBeNull();
    expect(computeFovCrop(still, preview, 0.1)).toBeNull();
  });

  it("for every shape pair: whole pixels, inside the photo, equal margins, so the photo's centre is the crop's centre", () => {
    const stills = [
      { width: 2250, height: 3000 },
      { width: 2251, height: 3001 },
      { width: 3000, height: 4000 },
      { width: 1999, height: 3000 },
      { width: 3000, height: 2250 },
      { width: 3000, height: 2251 },
      { width: 1500, height: 2000 },
    ];
    const previews = [
      { width: 1080, height: 1920 },
      { width: 720, height: 1280 },
      { width: 1080, height: 2400 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 1080, height: 1440 },
      { width: 1000, height: 1300 },
    ];
    let crops = 0;
    for (const still of stills) {
      for (const preview of previews) {
        const crop = computeFovCrop(still, preview);
        if (!crop) continue;
        crops++;
        const label = `${still.width}x${still.height} vs ${preview.width}x${preview.height}`;
        for (const n of [crop.x, crop.y, crop.width, crop.height])
          expect(Number.isInteger(n), label).toBe(true);
        expect(crop.x, label).toBeGreaterThanOrEqual(0);
        expect(crop.y, label).toBeGreaterThanOrEqual(0);
        expect(crop.width, label).toBeGreaterThanOrEqual(1);
        expect(crop.height, label).toBeGreaterThanOrEqual(1);
        expect(crop.x + crop.width, label).toBeLessThanOrEqual(still.width);
        expect(crop.y + crop.height, label).toBeLessThanOrEqual(still.height);
        // Equal margins: the centre does not move.
        expect(rectCentre(crop), label).toEqual({
          x: still.width / 2,
          y: still.height / 2,
        });
      }
    }
    expect(crops).toBeGreaterThan(10);
  });

  it("agrees with the crop the frozen photo already shows (computeStillCrop), to within the pixel or two the whole-pixel margins cost", () => {
    const still = { width: 2250, height: 3000 };
    const preview = { width: 1080, height: 1920 };
    const analysed = computeFovCrop(still, preview)!;
    const shown = computeStillCrop(preview, still);
    expect(Math.abs(analysed.x - shown.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(analysed.width - shown.width)).toBeLessThanOrEqual(2);
    expect(analysed.y).toBe(shown.y);
    expect(analysed.height).toBe(shown.height);
  });
});

describe("toFullFrame", () => {
  const crop: PixelRect = { x: 282, y: 0, width: 1686, height: 3000 };

  it("puts a point of the cropped photo back where it is in the whole photo", () => {
    expect(toFullFrame({ x: 0, y: 0 }, crop)).toEqual({ x: 282, y: 0 });
    expect(toFullFrame({ x: 843, y: 1500 }, crop)).toEqual({
      x: 1125,
      y: 1500,
    });
    // The centre of the cropped photo is the centre of the whole one.
    expect(toFullFrame({ x: 1686 / 2, y: 3000 / 2 }, crop)).toEqual({
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

describe("analysisFrames — what the parallax correction must read after a crop", () => {
  const decoded = { width: 2250, height: 3000 };

  it("the focal length is always worked out from the whole decoded photo, cropped or not", () => {
    const crop = computeFovCrop(decoded, { width: 1080, height: 1920 });
    expect(crop).not.toBeNull();
    expect(analysisFrames(decoded, crop).focalFrame).toEqual(decoded);
    expect(analysisFrames(decoded, null).focalFrame).toEqual(decoded);
  });

  it("the principal point comes from the analysed image, and for a centred crop that is the whole photo's centre", () => {
    const crop = computeFovCrop(decoded, { width: 1080, height: 1920 })!;
    const { principalFrame } = analysisFrames(decoded, crop);
    expect(principalFrame).toEqual({ width: 1686, height: 3000 });
    const inCrop = centrePrincipalPoint(
      principalFrame.width,
      principalFrame.height,
    );
    const wholePhoto = centrePrincipalPoint(decoded.width, decoded.height);
    // The crop's own centre, put back into the whole photo's pixels, is where
    // the whole photo's principal point already was.
    expect(toFullFrame({ x: inCrop.cx, y: inCrop.cy }, crop)).toEqual({
      x: wholePhoto.cx,
      y: wholePhoto.cy,
    });
  });

  it("with no crop both frames are the decoded photo", () => {
    expect(analysisFrames(decoded, null)).toEqual({
      focalFrame: decoded,
      principalFrame: decoded,
    });
  });

  it("returns copies, so a caller cannot change the decoded size through them", () => {
    const frames = analysisFrames(decoded, null);
    expect(frames.focalFrame).not.toBe(decoded);
    expect(frames.principalFrame).not.toBe(decoded);
  });
});
