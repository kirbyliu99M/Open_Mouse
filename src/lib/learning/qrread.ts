/**
 * Reading the learning kit's QR code out of a photo. Pure (jsQR works on raw
 * pixels), so a synthetic image can drive it.
 *
 * Only a QR code that parses as a kit code counts. A photo can hold other QR
 * codes (a mouse box, a poster, the phone case), and jsQR returns whichever it
 * finds first; taking that as "the page's code" would file the photo under
 * nothing and record someone else's text. So every attempt is checked with
 * `parseKitCode`, and when the first one is not a kit code the next method
 * gets its turn.
 */
import jsQR from "jsqr";
import {
  applyHomography,
  invert3x3,
  type Homography,
} from "../../client/geometry/homography";
import type { DetectedMarker } from "../../client/photo/markers";
import { sideHomography } from "./findings";
import { parseKitCode } from "./kit";
import { computeKitLayout, type Rect } from "./layout";

export interface RgbaImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export function crop(
  image: RgbaImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
): RgbaImage | null {
  // The part of the box that lies inside the image. (A box that starts left of
  // or above the image must lose that part, not slide over to make up its size:
  // that would read a region the box never covered.)
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  const cw = Math.min(image.width, Math.ceil(x0 + w)) - x;
  const ch = Math.min(image.height, Math.ceil(y0 + h)) - y;
  if (cw < 40 || ch < 40) return null;
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + cw * 4), row * cw * 4);
  }
  return { data, width: cw, height: ch };
}

/** One attempt: the text of the first QR code jsQR finds, if it is a kit code. */
export function decodeKitQr(image: RgbaImage | null): string | null {
  if (!image) return null;
  const text =
    jsQR(image.data, image.width, image.height, {
      inversionAttempts: "dontInvert",
    })?.data ?? null;
  return text !== null && parseKitCode(text) !== null ? text : null;
}

/** Image-pixel bounding box of a printed sheet-mm rect, grown by `padMm`. */
function rectInImage(sheetToImage: Homography, r: Rect, padMm: number) {
  const pts = [
    { x: r.x - padMm, y: r.y - padMm },
    { x: r.x + r.w + padMm, y: r.y - padMm },
    { x: r.x + r.w + padMm, y: r.y + r.h + padMm },
    { x: r.x - padMm, y: r.y + r.h + padMm },
  ].map((p) => applyHomography(sheetToImage, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Read the page's kit QR code, or `null`. A single pass over the whole photo
 * fails when a hand, two QR codes and six ArUco squares compete for jsQR's
 * finder search, so this also tries the exact printed QR positions (located
 * through the marker homography) and then overlapping tiles. Each attempt has
 * to be a kit code, or the next one is tried.
 */
export function readKitQr(
  image: RgbaImage,
  markers: readonly DetectedMarker[],
  flatHomography: Homography | null,
): string | null {
  const whole = decodeKitQr(image);
  if (whole) return whole;

  const located: { h: Homography; rects: readonly Rect[] }[] = [];
  if (flatHomography) {
    located.push({
      h: invert3x3(flatHomography),
      rects: computeKitLayout("above").qr,
    });
  }
  const side = sideHomography(markers);
  if (side)
    located.push({ h: invert3x3(side), rects: computeKitLayout("side").qr });
  for (const { h, rects } of located) {
    for (const r of rects) {
      const box = rectInImage(h, r, 4);
      const text = decodeKitQr(crop(image, box.x, box.y, box.w, box.h));
      if (text) return text;
    }
  }

  const tw = image.width / 2;
  const th = image.height / 3;
  for (let ty = 0; ty + th <= image.height + 1; ty += th / 2) {
    for (let tx = 0; tx + tw <= image.width + 1; tx += tw / 2) {
      const text = decodeKitQr(crop(image, tx, ty, tw, th));
      if (text) return text;
    }
  }
  return null;
}
