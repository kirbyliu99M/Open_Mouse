/**
 * Browser-side analysis of one learning-kit photo. Everything runs on this
 * device (AGENTS hard rule 5): the file is decoded locally, read for its QR
 * code, ArUco markers, paper edges and hand landmarks, and only the derived
 * numbers are returned. Impure (canvas, MediaPipe, the file's bytes); every
 * decision and every number is made by the pure `assembleLearningReport` in
 * `src/lib/learning/report.ts`, which this file only feeds.
 *
 * The raw features (marker corners, paper corners, 21 landmarks in pixels,
 * both homographies, the landmarks in sheet mm) are kept in the report on
 * purpose: they are the training data for tuning the blank-paper scan
 * against the printed markers, and they let a later run work the mm values
 * out again without the photo.
 */
import jsQR from "jsqr";
import type { PaperSize } from "../../lib/contracts/measurement";
import { parseKitCode, gestureByCode } from "../../lib/learning/kit";
import { NO_EXIF, readExifWhitelist } from "../../lib/learning/exif";
import {
  markerReference,
  paperFindings,
  sideHomography,
  stripReference,
} from "../../lib/learning/findings";
import {
  assembleFailedReport,
  assembleLearningReport,
  type LearningPhotoReport,
} from "../../lib/learning/report";
import {
  applyHomography,
  invert3x3,
  type Homography,
} from "../geometry/homography";
import { computeKitLayout, type Rect } from "../../lib/learning/layout";
import { estimateFocalFromExif } from "../geometry/exif-focal";
import { decodePhoto } from "../photo/decode";
import { detectMarkers, type DetectedMarker } from "../photo/markers";
import { detectHandLandmarks } from "../photo/landmarks";
import { rgbaToGrayscale, computeLaplacianVariance } from "../photo/sharpness";
import { detectPaperQuad } from "../paper/detect";

export type { LearningPhotoReport } from "../../lib/learning/report";

export interface AnalyseOptions {
  /** Size of the sheet the photographed page is printed on; the paper-edge plane assumes it. Default A4, the kit's size. */
  readonly paperSize?: PaperSize;
}

function imageDataOf(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx)
    throw new Error("2D canvas context is unavailable in this browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function crop(image: ImageData, x0: number, y0: number, w: number, h: number) {
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  const cw = Math.min(image.width - x, Math.ceil(w));
  const ch = Math.min(image.height - y, Math.ceil(h));
  if (cw < 40 || ch < 40) return null;
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + cw * 4), row * cw * 4);
  }
  return { data, width: cw, height: ch };
}

function decodeQr(
  img: { data: Uint8ClampedArray; width: number; height: number } | null,
) {
  if (!img) return null;
  return (
    jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })
      ?.data ?? null
  );
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
 * Read the page's kit QR code. A single pass over the whole photo fails
 * when a hand, two QR codes and six ArUco squares compete for jsQR's finder
 * search, so this also tries the exact printed QR positions (located through
 * the marker homography) and then overlapping tiles.
 */
function readQr(
  image: ImageData,
  markers: readonly DetectedMarker[],
  flatHomography: Homography | null,
): string | null {
  const whole = decodeQr(image);
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
      const text = decodeQr(crop(image, box.x, box.y, box.w, box.h));
      if (text) return text;
    }
  }

  const tw = image.width / 2;
  const th = image.height / 3;
  for (let ty = 0; ty + th <= image.height + 1; ty += th / 2) {
    for (let tx = 0; tx + tw <= image.width + 1; tx += tw / 2) {
      const text = decodeQr(crop(image, tx, ty, tw, th));
      if (text) return text;
    }
  }
  return null;
}

/**
 * EXIF from the file's own bytes: the white-listed values, and the focal
 * length in px of the decoded frame that the product's parallax policy uses.
 * A photo without readable EXIF (PNG, HEIC, stripped) gives nulls.
 */
async function readExif(file: File, width: number, height: number) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      exif: readExifWhitelist(bytes),
      exifFocalPx:
        estimateFocalFromExif(bytes, { widthPx: width, heightPx: height })
          ?.fPx ?? null,
    };
  } catch {
    return { exif: NO_EXIF, exifFocalPx: null };
  }
}

export async function analyseLearningPhoto(
  file: File,
  options: AnalyseOptions = {},
): Promise<LearningPhotoReport> {
  const paperSize = options.paperSize ?? "a4";
  let decoded;
  try {
    decoded = await decodePhoto(file);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "This photo couldn't be read.";
    return assembleFailedReport(file.name, paperSize, message);
  }

  const { bitmap, width, height } = decoded;
  const image = imageDataOf(bitmap, width, height);
  const markers = detectMarkers(image);
  const gray = rgbaToGrayscale(image.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);
  const { exif, exifFocalPx } = await readExif(file, width, height);

  const flat = markerReference(markers);
  const qrText = readQr(image, markers, flat?.homography ?? null);
  const code = qrText ? parseKitCode(qrText) : null;
  const gesture = code?.kind === "gesture" ? gestureByCode(code.gesture) : null;

  const base = {
    file: file.name,
    width,
    height,
    paperSize,
    exif,
    exifFocalPx,
    qrText,
    code,
    markers,
    laplacianVariance,
  };

  if (code?.kind === "participant") {
    return assembleLearningReport({
      ...base,
      reference: null,
      paper: null,
      hand: null,
    });
  }

  const topDown = gesture?.camera !== "side";
  const detected = await detectHandLandmarks(bitmap);
  return assembleLearningReport({
    ...base,
    reference: topDown ? flat : stripReference(markers),
    paper: topDown
      ? paperFindings(detectPaperQuad(image, paperSize), paperSize)
      : null,
    hand: detected
      ? {
          landmarksPx: detected.landmarksPx,
          handedness: detected.handedness,
          confidence: detected.confidence,
        }
      : null,
  });
}
