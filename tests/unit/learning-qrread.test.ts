import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { crop, decodeKitQr, readKitQr } from "../../src/lib/learning/qrread";
import { kitCodeUrl } from "../../src/lib/learning/kit";
import { computeKitLayout, type Rect } from "../../src/lib/learning/layout";
import {
  cardSearchRects,
  computeKitV2Layout,
} from "../../src/lib/learning/layoutv2";
import { QR_QUIET_MODULES, qrMatrix } from "../../src/lib/learning/qr";
import type { Homography } from "../../src/client/geometry/homography";
import type { DetectedMarker } from "../../src/client/photo/markers";
import { drawQr, whiteImage } from "./helpers/qr-raster";

type Point2 = { readonly x: number; readonly y: number };

const KIT_G01R = kitCodeUrl({
  kind: "gesture",
  version: 1,
  gesture: "G01",
  hand: "right",
});
const KIT_CARD = kitCodeUrl({
  kind: "participant",
  version: 1,
  participant: "P007",
});
// Someone else's QR codes: a shop link, and plain text.
const OTHER_URL = "https://example.com/shop/mouse?id=1234567890&ref=box";
const OTHER_TEXT = "WIFI:T:WPA;S:home;P:hunter2;;";

describe("decodeKitQr", () => {
  it("returns the text of a kit code", () => {
    const image = whiteImage(300, 300);
    drawQr(image, KIT_G01R, 20, 20, 6);
    expect(decodeKitQr(image)).toBe(KIT_G01R);
  });

  it("returns null for a QR code that is not a kit code, even though jsQR reads it", () => {
    for (const text of [OTHER_URL, OTHER_TEXT]) {
      const image = whiteImage(400, 400);
      drawQr(image, text, 20, 20, 6);
      expect(jsQR(image.data, image.width, image.height)?.data).toBe(text);
      expect(decodeKitQr(image)).toBeNull();
    }
  });

  it("returns null for no image and for a blank one", () => {
    expect(decodeKitQr(null)).toBeNull();
    expect(decodeKitQr(whiteImage(200, 200))).toBeNull();
  });
});

describe("readKitQr", () => {
  it("finds a kit code that shares the photo with a foreign QR code that jsQR reads first", () => {
    const image = whiteImage(1200, 800);
    drawQr(image, OTHER_URL, 60, 60, 3); // small, top-left
    drawQr(image, KIT_G01R, 700, 420, 6); // larger, lower right, inside one tile
    // The precondition that makes this a real test: a single pass over the
    // photo returns the foreign code, so the reader has to try again.
    expect(jsQR(image.data, image.width, image.height)?.data).toBe(OTHER_URL);

    expect(readKitQr(image, [], null)).toBe(KIT_G01R);
  });

  it("finds the kit code when foreign ones sit on both sides of it", () => {
    const image = whiteImage(1200, 800);
    drawQr(image, OTHER_URL, 40, 40, 3);
    drawQr(image, KIT_CARD, 500, 420, 6);
    drawQr(image, OTHER_TEXT, 1000, 60, 3);
    expect(readKitQr(image, [], null)).toBe(KIT_CARD);
  });

  it("is null when the photo holds only foreign QR codes: their text is not a page's code", () => {
    const image = whiteImage(1200, 800);
    drawQr(image, OTHER_URL, 60, 120, 10);
    drawQr(image, OTHER_TEXT, 800, 500, 6);
    expect(readKitQr(image, [], null)).toBeNull();
  });

  it("is null when there is no QR code at all", () => {
    expect(readKitQr(whiteImage(1200, 800), [], null)).toBeNull();
  });
});

// The whole-photo pass and the tiles are both blind here on purpose: the kit
// code is bigger than a tile (a third of the photo tall), and the photo also
// holds a smaller foreign code that jsQR finds first. The only way to the kit
// code is the crop at its printed position, worked out from the homography or
// the strip markers. Replacing that step with a plain jsQR call, or dropping
// it, fails these tests.
describe("readKitQr with the printed position known", () => {
  const PX_PER_MODULE = 10;
  const MM = 24; // KIT_QR_SIZE_MM: the printed code's side
  const side = (qrMatrix(KIT_G01R).size + 2 * QR_QUIET_MODULES) * PX_PER_MODULE;
  const scale = side / MM; // image pixels per sheet millimetre
  // A tile is a third of the photo tall. The code's modules (its quiet zone
  // can be missing without harm) are taller than that, so no tile holds it.
  const dataSide = qrMatrix(KIT_G01R).size * PX_PER_MODULE;
  const TALL = 750;

  /** Sheet millimetres to image pixels: a scale and an offset. */
  const toImage = (offX: number, offY: number) => (p: Point2) => ({
    x: offX + p.x * scale,
    y: offY + p.y * scale,
  });
  /** The same as a homography from image pixels to sheet millimetres (what the reader is given). */
  const imageToSheet = (offX: number, offY: number): Homography => [
    [1 / scale, 0, -offX / scale],
    [0, 1 / scale, -offY / scale],
    [0, 0, 1],
  ];

  function stamp(
    image: ReturnType<typeof whiteImage>,
    text: string,
    rect: Rect,
    to: (p: Point2) => Point2,
    pxPerModule: number,
  ) {
    const at = to({ x: rect.x, y: rect.y });
    drawQr(image, text, Math.round(at.x), Math.round(at.y), pxPerModule);
  }

  it("the photos below are too short for a tile to hold the code", () => {
    expect(TALL / 3).toBeLessThan(dataSide);
    expect((TALL + 50) / 3).toBeLessThan(dataSide);
  });

  it("top-down page: reads the kit code at its printed position, next to a foreign code jsQR finds first", () => {
    const [left, right] = computeKitLayout("above").qr as [Rect, Rect];
    const image = whiteImage(1400, TALL);
    const to = toImage(60, 60);
    stamp(image, KIT_G01R, left, to, PX_PER_MODULE);
    drawQr(image, OTHER_URL, 1000, 300, 3); // small, well away from the kit code

    // The preconditions that make this test mean something.
    expect(jsQR(image.data, image.width, image.height)?.data).toBe(OTHER_URL);
    expect(decodeKitQr(image)).toBeNull();
    // Without the homography the reader cannot find it (tiles are too small)...
    expect(readKitQr(image, [], null)).toBeNull();
    // ...and with it, it does.
    expect(readKitQr(image, [], imageToSheet(60, 60))).toBe(KIT_G01R);
    void right;
  });

  it("top-down page: tries the second printed position when the first holds someone else's code", () => {
    const [left, right] = computeKitLayout("above").qr as [Rect, Rect];
    // Both printed positions in one photo: shrink the drawing so they fit.
    const image = whiteImage(3400, TALL);
    const to = toImage(60, 60);
    stamp(image, OTHER_URL, left, to, PX_PER_MODULE); // a foreign code where a kit code would be
    stamp(image, KIT_CARD, right, to, PX_PER_MODULE);
    // Tiles cannot hold either code, so this is the located path or nothing.
    expect(readKitQr(image, [], null)).toBeNull();
    expect(readKitQr(image, [], imageToSheet(60, 60))).toBe(KIT_CARD);
  });

  it("side page: reads the kit code at the position the two strip markers give", () => {
    const layout = computeKitLayout("side");
    const [qr] = layout.qr as [Rect];
    const image = whiteImage(1000, TALL + 50);
    // The markers sit off to the left of this crop of the sheet; the reader
    // only needs where their corners are, not their pixels.
    const to = toImage(-1300, 100);
    const markers: DetectedMarker[] = layout.markers.map((m) => ({
      id: m.id,
      corners: [
        to(m.corners[0]),
        to(m.corners[1]),
        to(m.corners[2]),
        to(m.corners[3]),
      ],
    }));
    stamp(image, KIT_G01R, qr, to, PX_PER_MODULE);
    drawQr(image, OTHER_TEXT, 700, 30, 3);

    expect(jsQR(image.data, image.width, image.height)?.data).toBe(OTHER_TEXT);
    expect(readKitQr(image, [], null)).toBeNull();
    expect(readKitQr(image, markers, null)).toBe(KIT_G01R);
    // One marker is not enough to place anything.
    expect(readKitQr(image, markers.slice(0, 1), null)).toBeNull();
  });

  // The crop around a printed square is that square grown by 4 mm. Not less:
  // paper slips and the homography is a little off, so a code sits some mm from
  // where it was printed (the quiet zone gives the first ~2.6 mm for free).
  // Not much more: a wider crop takes in whatever sits next to the code, and
  // jsQR may answer with that instead of the kit's code.
  describe("the crop reaches 4 mm beyond the printed square", () => {
    const [left] = computeKitLayout("above").qr as [Rect, Rect];
    const H = imageToSheet(60, 60);
    const to = toImage(60, 60);

    it("a code printed 6.4 mm from its square is still read", () => {
      const image = whiteImage(1400, TALL);
      stamp(image, KIT_G01R, { ...left, x: left.x + 6.4 }, to, PX_PER_MODULE);
      drawQr(image, OTHER_URL, 1000, 300, 3); // so the whole-photo pass answers wrongly
      expect(readKitQr(image, [], null)).toBeNull();
      expect(readKitQr(image, [], H)).toBe(KIT_G01R);
    });

    it("the same, 6.4 mm the other way and 6.4 mm down", () => {
      const a = whiteImage(1400, TALL);
      stamp(a, KIT_G01R, { ...left, x: left.x - 6.4 }, to, PX_PER_MODULE);
      drawQr(a, OTHER_URL, 1000, 300, 3);
      expect(readKitQr(a, [], null)).toBeNull();
      expect(readKitQr(a, [], H)).toBe(KIT_G01R);
      const b = whiteImage(1400, TALL + 100);
      stamp(b, KIT_G01R, { ...left, y: left.y + 6.4 }, to, PX_PER_MODULE);
      drawQr(b, OTHER_URL, 1000, 300, 3);
      expect(readKitQr(b, [], null)).toBeNull();
      expect(readKitQr(b, [], H)).toBe(KIT_G01R);
    });

    it("a foreign code that starts just beyond the margin is not taken into the crop", () => {
      const image = whiteImage(1400, TALL);
      stamp(image, KIT_G01R, left, to, PX_PER_MODULE);
      // A small foreign code (modules 2 px) whose data starts 24.6 mm from the
      // square's left edge, and rises into the margin above it. With the 4 mm
      // margin jsQR still answers with the kit's code; with 5 mm or more (probed:
      // 5, 6, 7, 8 and 12) it answers with this one instead.
      const foreignModule = 2;
      const quiet = QR_QUIET_MODULES * foreignModule;
      const x = Math.round(60 + (left.x + 24.6) * scale - quiet);
      const y = Math.round(60 + (left.y - 3) * scale);
      const foreignSide = drawQr(image, OTHER_URL, x, y, foreignModule);
      // Preconditions: it is readable on its own, and it is small enough
      // (and close enough) for jsQR to answer with it on a whole-photo pass.
      const alone = whiteImage(1400, TALL);
      drawQr(alone, OTHER_URL, x, y, foreignModule);
      expect(jsQR(alone.data, alone.width, alone.height)?.data).toBe(OTHER_URL);
      expect(foreignSide).toBeLessThan(scale * 6);
      expect(decodeKitQr(image)).toBeNull();
      expect(readKitQr(image, [], null)).toBeNull();
      expect(readKitQr(image, [], H)).toBe(KIT_G01R);
    });
  });

  describe("crop", () => {
    // A 300 x 200 image whose red channel says where each pixel is.
    const image = whiteImage(300, 200);
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 300; x++) {
        image.data[(y * 300 + x) * 4] = x % 256;
        image.data[(y * 300 + x) * 4 + 1] = y;
      }
    const px = (
      c: { data: Uint8ClampedArray; width: number },
      x: number,
      y: number,
    ) => [c.data[(y * c.width + x) * 4], c.data[(y * c.width + x) * 4 + 1]];

    it("cuts the box out of the image", () => {
      const c = crop(image, 50, 40, 100, 80)!;
      expect([c.width, c.height]).toEqual([100, 80]);
      expect(px(c, 0, 0)).toEqual([50, 40]);
      expect(px(c, 99, 79)).toEqual([149, 119]);
    });

    it("a box that starts outside the image keeps only the part inside it: it does not slide over", () => {
      const c = crop(image, -50, -30, 200, 150)!;
      expect([c.width, c.height]).toEqual([150, 120]);
      expect(px(c, 0, 0)).toEqual([0, 0]);
      expect(px(c, 149, 119)).toEqual([149, 119]);
    });

    it("a box that ends outside the image is cut at its edge", () => {
      const c = crop(image, 250, 150, 200, 200)!;
      expect([c.width, c.height]).toEqual([50, 50]);
      expect(px(c, 0, 0)).toEqual([250, 150]);
    });

    it("nothing left to read (a box mostly or wholly outside, or tiny) is null", () => {
      expect(crop(image, -300, 0, 320, 100)).toBeNull(); // 20 px inside
      expect(crop(image, 400, 0, 100, 100)).toBeNull();
      expect(crop(image, 0, 0, 30, 30)).toBeNull();
    });
  });
});

describe("readKitQr, kit v2: the card slot", () => {
  const CARD = kitCodeUrl({
    kind: "participant",
    version: 2,
    participant: "P901",
  });
  // The image is 10 px per sheet mm, so the slot (60 x 30 mm at x 15, y 8) is
  // 600 x 300 px at (150, 80).
  const sheetToImage: Homography = [
    [0.1, 0, 0],
    [0, 0.1, 0],
    [0, 0, 1],
  ];
  const searchRects = cardSearchRects(computeKitV2Layout("A"));

  /**
   * A photo where a single pass finds only a foreign QR code, and the card's
   * QR code (330 px tall) is taller than any tile (a third of the 900 px
   * height), so only the crop of the slot can reach it.
   */
  function photoWithCardInSlot() {
    const image = whiteImage(1300, 900);
    drawQr(image, OTHER_URL, 900, 600, 3);
    drawQr(image, CARD, 160, 60, 9);
    return image;
  }

  it("reads the card through its slot when the whole photo gives a foreign code and no tile holds the card", () => {
    const image = photoWithCardInSlot();
    // The preconditions that make this a test of the slot path.
    expect(jsQR(image.data, image.width, image.height)?.data).toBe(OTHER_URL);
    expect(decodeKitQr(image)).toBeNull();
    const tileHeight = image.height / 3;
    expect(9 * (qrMatrix(CARD).size + 2 * QR_QUIET_MODULES)).toBeGreaterThan(
      tileHeight,
    );

    expect(readKitQr(image, [], sheetToImage, { searchRects })).toBe(CARD);
  });

  it("does not find it without the slot: the v1 positions and the tiles miss it", () => {
    const image = photoWithCardInSlot();
    expect(readKitQr(image, [], sheetToImage)).toBeNull();
    expect(readKitQr(image, [], null, { searchRects })).toBeNull();
  });

  it("does not search the v1 positions when it is given the slot", () => {
    // A kit code at a kit v1 page's QR position (x 15 mm, y 18 mm), outside the
    // slot and too tall for any tile: a v2 search does not look there.
    const image = whiteImage(1300, 600);
    const [v1box] = computeKitLayout("above").qr;
    drawQr(image, OTHER_URL, 900, 400, 3);
    // 7 px a module: 259 px, inside the padded v1 crop (320 px) and taller than a tile (200 px).
    drawQr(image, KIT_CARD, v1box!.x * 10 + 20, v1box!.y * 10 + 20, 7);
    expect(jsQR(image.data, image.width, image.height)?.data).toBe(OTHER_URL);
    expect(readKitQr(image, [], sheetToImage, { searchRects })).toBeNull();
    // Without the slot argument it is the v1 search, and it does find it.
    expect(readKitQr(image, [], sheetToImage)).toBe(KIT_CARD);
  });
});
