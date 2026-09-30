import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { decodeKitQr, readKitQr } from "../../src/lib/learning/qrread";
import { kitCodeUrl } from "../../src/lib/learning/kit";
import { drawQr, whiteImage } from "./helpers/qr-raster";

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
