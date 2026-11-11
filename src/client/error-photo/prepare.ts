/**
 * The error photo's on-device preparation (candidate 未拍板; contract
 * src/lib/contracts/error-photo.ts, "What the browser MUST do"). From the
 * photo the scan already holds in memory and what the analysis found on it:
 *
 *  - crop to the union of the hand's landmarks and the reference's corners
 *    (the sheet, or the card), plus `CROP_MARGIN` of that box on each side;
 *    nothing outside it is drawn;
 *  - card mode: the detected card quadrilateral (grown by `CARD_GROW` from
 *    its centre, so a corner a few pixels off is still covered) is filled
 *    solid black; with no card outline, `null`: no upload is offered;
 *  - long side at most `ERROR_PHOTO_MAX_SIDE_PX`; re-encoded through a canvas
 *    as JPEG (quality 0.85, lower if needed to fit `ERROR_PHOTO_MAX_BYTES`),
 *    which carries no EXIF; then the bytes are checked with the same marker
 *    walker the server uses (no APP1, the right size). Any failed step is
 *    `null`: the person is not offered an upload at all.
 *
 * COORDINATES. `overlay` is in the pixels of the image the analysis decoded:
 * the paper pipeline decodes upright (EXIF orientation applied) and downscaled
 * to at most 3000 px on the long side (src/client/photo/decode.ts); the card
 * pipeline decodes the file as is at full resolution with no options
 * (src/client/card/runCardPhoto.ts). This module decodes the same file again
 * THE SAME WAY as the pipeline that made the overlay, then scales the overlay
 * by decoded size / overlay size on each axis; a decode whose aspect ratio
 * differs from the overlay's by more than 1% (a rotation the two decodes did
 * not agree on) is refused.
 *
 * `planErrorPhotoCrop` is the pure geometry (unit-tested with synthetic
 * inputs, tests/unit/error-photo-prepare.test.ts); `prepareErrorPhoto` is the
 * browser half (canvas, not unit-testable in Node). Nothing is stored: the
 * result lives in memory until the sheet closes.
 */
import {
  ERROR_PHOTO_MAX_BYTES,
  ERROR_PHOTO_MAX_SIDE_PX,
} from "../../lib/contracts/error-photo";
import { checkErrorPhotoJpeg } from "../../lib/error-photo/jpeg";

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** What the analysis left on the photo (`PhotoOverlay`'s fields that matter here). */
export interface ErrorPhotoOverlay {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly landmarksPx: readonly Pt[] | null;
  /** The sheet's corners, or the card's in card mode (cardPhoto.ts draws it there). */
  readonly paperCorners?: readonly Pt[] | null;
  readonly paperPartialCorners?: readonly (Pt | null)[];
  readonly paperGuessCorners?: readonly Pt[];
}

export type ErrorPhotoMode = "paper" | "card";

export const CROP_MARGIN = 0.08;
export const CARD_GROW = 0.06;
export const JPEG_QUALITIES = [0.85, 0.75, 0.65] as const;
/** The contract's smallest side. */
export const MIN_SIDE_PX = 64;
const ASPECT_TOLERANCE = 0.01;

export interface CropPlan {
  /** Source rectangle in the decoded image, integer px. */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  /** Output size, px (long side at most the limit). */
  readonly width: number;
  readonly height: number;
  /** Card mode: the quadrilateral to fill black, in output px. */
  readonly blackout: readonly Pt[] | null;
}

const finite = (p: Pt | null | undefined): p is Pt =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** The reference's points: the card's four (required in card mode), else the sheet's best known corners. */
function referencePoints(
  overlay: ErrorPhotoOverlay,
  mode: ErrorPhotoMode,
): Pt[] | null {
  const full = (overlay.paperCorners ?? []).filter(finite);
  if (mode === "card") return full.length === 4 ? full : null;
  if (full.length > 0) return full;
  const partial = (overlay.paperPartialCorners ?? []).filter(finite);
  if (partial.length > 0) return partial;
  return (overlay.paperGuessCorners ?? []).filter(finite);
}

/** `quad` grown by `factor` away from its centroid. */
export function growQuad(quad: readonly Pt[], factor: number): Pt[] {
  const cx = quad.reduce((s, p) => s + p.x, 0) / quad.length;
  const cy = quad.reduce((s, p) => s + p.y, 0) / quad.length;
  return quad.map((p) => ({
    x: cx + (p.x - cx) * (1 + factor),
    y: cy + (p.y - cy) * (1 + factor),
  }));
}

/**
 * The crop, scale and blackout for one photo, or `null` when it must not be
 * offered: card mode without a card outline, nothing found to crop around, a
 * decode that does not match the overlay's frame, or a crop under the
 * contract's 64 px.
 */
export function planErrorPhotoCrop(input: {
  readonly overlay: ErrorPhotoOverlay;
  readonly mode: ErrorPhotoMode;
  /** The image as decoded now, the same way the analysis decoded it. */
  readonly decoded: { readonly width: number; readonly height: number };
  readonly maxSidePx?: number;
}): CropPlan | null {
  const { overlay, mode, decoded } = input;
  const maxSide = input.maxSidePx ?? ERROR_PHOTO_MAX_SIDE_PX;
  if (
    !(overlay.imageWidth > 0 && overlay.imageHeight > 0) ||
    !(decoded.width > 0 && decoded.height > 0)
  )
    return null;
  const overlayAspect = overlay.imageWidth / overlay.imageHeight;
  const decodedAspect = decoded.width / decoded.height;
  if (Math.abs(decodedAspect / overlayAspect - 1) > ASPECT_TOLERANCE)
    return null;

  const reference = referencePoints(overlay, mode);
  if (reference === null) return null;
  const hand = (overlay.landmarksPx ?? []).filter(finite);
  const all = [...hand, ...reference];
  if (all.length < 2) return null;

  const kx = decoded.width / overlay.imageWidth;
  const ky = decoded.height / overlay.imageHeight;
  const toDecoded = (p: Pt): Pt => ({ x: p.x * kx, y: p.y * ky });
  const pts = all.map(toDecoded);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const mx = (maxX - minX) * CROP_MARGIN;
  const my = (maxY - minY) * CROP_MARGIN;
  const x0 = Math.max(0, Math.floor(minX - mx));
  const y0 = Math.max(0, Math.floor(minY - my));
  const x1 = Math.min(decoded.width, Math.ceil(maxX + mx));
  const y1 = Math.min(decoded.height, Math.ceil(maxY + my));
  const sw = x1 - x0;
  const sh = y1 - y0;
  if (sw < MIN_SIDE_PX || sh < MIN_SIDE_PX) return null;

  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const width = Math.min(maxSide, Math.round(sw * scale));
  const height = Math.min(maxSide, Math.round(sh * scale));
  if (width < MIN_SIDE_PX || height < MIN_SIDE_PX) return null;
  const sxOut = width / sw;
  const syOut = height / sh;

  const blackout =
    mode === "card"
      ? growQuad(reference.map(toDecoded), CARD_GROW).map((p) => ({
          x: (p.x - x0) * sxOut,
          y: (p.y - y0) * syOut,
        }))
      : null;
  return { sx: x0, sy: y0, sw, sh, width, height, blackout };
}

export interface PreparedErrorPhoto {
  /** Exactly the bytes that will be sent (and shown in the sheet). */
  readonly jpeg: Blob;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Decodes `file` the way the pipeline of `mode` did (see the file header). */
async function decodeLikePipeline(
  file: Blob,
  mode: ErrorPhotoMode,
): Promise<ImageBitmap> {
  return mode === "card"
    ? createImageBitmap(file)
    : createImageBitmap(file, { imageOrientation: "from-image" });
}

function encode(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
}

/**
 * The cropped, blacked-out, re-encoded copy to send, or `null` (never throws):
 * then no upload is offered.
 */
export async function prepareErrorPhoto(input: {
  readonly file: Blob;
  readonly overlay: ErrorPhotoOverlay;
  readonly mode: ErrorPhotoMode;
}): Promise<PreparedErrorPhoto | null> {
  // Card mode with no outline: not offered, without even decoding.
  if (input.mode === "card" && referencePoints(input.overlay, "card") === null)
    return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await decodeLikePipeline(input.file, input.mode);
    const plan = planErrorPhotoCrop({
      overlay: input.overlay,
      mode: input.mode,
      decoded: { width: bitmap.width, height: bitmap.height },
    });
    if (!plan) return null;
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      bitmap,
      plan.sx,
      plan.sy,
      plan.sw,
      plan.sh,
      0,
      0,
      plan.width,
      plan.height,
    );
    if (plan.blackout) {
      ctx.fillStyle = "#000";
      ctx.beginPath();
      plan.blackout.forEach((p, k) =>
        k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
      );
      ctx.closePath();
      ctx.fill();
    }
    for (const quality of JPEG_QUALITIES) {
      const blob = await encode(canvas, quality);
      if (!blob || blob.size === 0) return null;
      if (blob.size > ERROR_PHOTO_MAX_BYTES) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // The server's own check, here first: a browser that wrote anything
      // but a clean JPEG of this size (a PNG fallback, metadata) is not
      // offered at all.
      if (
        checkErrorPhotoJpeg(
          bytes,
          { widthPx: plan.width, heightPx: plan.height },
          ERROR_PHOTO_MAX_SIDE_PX,
        ) !== null
      )
        return null;
      return {
        jpeg: new Blob([bytes], { type: "image/jpeg" }),
        widthPx: plan.width,
        heightPx: plan.height,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
