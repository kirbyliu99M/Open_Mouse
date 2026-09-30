import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { decodeKitQr, readKitQr } from "../../src/lib/learning/qrread";
import { kitCodeUrl } from "../../src/lib/learning/kit";
import { computeKitLayout, type Rect } from "../../src/lib/learning/layout";
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
});
