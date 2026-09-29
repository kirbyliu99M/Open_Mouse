/**
 * Browser-side analysis of one learning-kit photo. Everything runs on this
 * device (AGENTS hard rule 5): the file is decoded locally, read for its QR
 * code, ArUco markers, paper edges and hand landmarks, and only the derived
 * numbers are returned. Impure (canvas, MediaPipe); the decisions it feeds
 * are the pure `evaluateLearningPhoto` in `src/lib/learning/checks.ts`.
 *
 * The raw features (marker corners, paper corners, 21 landmarks in pixels)
 * are kept in the report on purpose: they are the training data for tuning
 * the blank-paper scan against the printed markers.
 */
import jsQR from "jsqr";
import { SHEET, type HandMeasurements } from "../../lib/contracts/measurement";
import {
  parseKitCode,
  gestureByCode,
  type KitCode,
} from "../../lib/learning/kit";
import {
  evaluateLearningPhoto,
  type LearningCheck,
  type LearningVerdict,
} from "../../lib/learning/checks";
import { computeSheetLayout } from "../sheet/layout";
import {
  applyHomography,
  estimateHomography,
  invert3x3,
  reprojectionErrorMm as computeReprojectionErrorMm,
  type Homography,
  type Point2,
  type PointCorrespondence,
} from "../geometry/homography";
import { computeKitLayout, type Rect } from "../../lib/learning/layout";
import { computeHandMeasurements } from "../geometry/measurements";
import { decodePhoto } from "../photo/decode";
import {
  detectMarkers,
  buildMarkerCorrespondences,
  type DetectedMarker,
} from "../photo/markers";
import { detectHandLandmarks } from "../photo/landmarks";
import { rgbaToGrayscale, computeLaplacianVariance } from "../photo/sharpness";
import { detectPaperQuad } from "../paper/detect";
import { evaluatePaperEdgeCalibration } from "../paper/calibration";

export interface LearningPhotoReport {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly qrText: string | null;
  readonly code: KitCode | null;
  readonly markers: readonly DetectedMarker[];
  readonly reprojectionErrorMm: number | null;
  readonly paperCorners: readonly Point2[] | null;
  readonly paperCornersSeen: number;
  readonly laplacianVariance: number;
  readonly hand: {
    readonly landmarksPx: readonly Point2[];
    readonly handedness: "left" | "right" | null;
    readonly confidence: number;
  } | null;
  /** Raw landmark distances through the printed-marker homography (the reference). */
  readonly markerMm: HandMeasurements | null;
  /** The same landmarks through the paper-edge homography (what the product uses). */
  readonly paperMm: HandMeasurements | null;
  readonly checks: readonly LearningCheck[];
  readonly verdict: LearningVerdict;
  readonly error?: string;
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

/** Side-page homography from the two strip markers (8 corners). */
function sideHomography(markers: readonly DetectedMarker[]): Homography | null {
  const layout = computeKitLayout("side");
  const pairs: PointCorrespondence[] = [];
  for (const printed of layout.markers) {
    const found = markers.find((m) => m.id === printed.id);
    if (!found) return null;
    found.corners.forEach((image, i) =>
      pairs.push({ src: image, dst: printed.corners[i]! }),
    );
  }
  return estimateHomography(pairs);
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

function tryMeasure(
  landmarks: readonly Point2[],
  homography: Parameters<typeof computeHandMeasurements>[1],
): HandMeasurements | null {
  try {
    return computeHandMeasurements(landmarks, homography);
  } catch {
    // Grip poses fold the fingers; a flat-hand definition can fall outside
    // the contract's ranges. The raw landmarks are still in the report.
    return null;
  }
}

export async function analyseLearningPhoto(
  file: File,
): Promise<LearningPhotoReport> {
  let decoded;
  try {
    decoded = await decodePhoto(file);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "This photo couldn't be read.";
    return {
      file: file.name,
      width: 0,
      height: 0,
      qrText: null,
      code: null,
      markers: [],
      reprojectionErrorMm: null,
      paperCorners: null,
      paperCornersSeen: 0,
      laplacianVariance: 0,
      hand: null,
      markerMm: null,
      paperMm: null,
      checks: [{ id: "qr", tone: "bad", message }],
      verdict: "unidentified",
      error: message,
    };
  }

  const { bitmap, width, height } = decoded;
  const image = imageDataOf(bitmap, width, height);
  const markers = detectMarkers(image);
  const gray = rgbaToGrayscale(image.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);

  let markerHomography: Homography | null = null;
  let reprojectionErrorMm: number | null = null;
  const { correspondences, missingIds } = buildMarkerCorrespondences(
    markers,
    computeSheetLayout(),
  );
  if (
    missingIds.length === 0 &&
    correspondences.length >= SHEET.flatMarkerIds.length * 4
  ) {
    markerHomography = estimateHomography(correspondences);
    reprojectionErrorMm = computeReprojectionErrorMm(
      markerHomography,
      correspondences,
    );
  }

  const qrText = readQr(image, markers, markerHomography);
  const code = qrText ? parseKitCode(qrText) : null;
  const gesture = code?.kind === "gesture" ? gestureByCode(code.gesture) : null;

  if (code?.kind === "participant") {
    const { checks, verdict } = evaluateLearningPhoto({
      code,
      markerIds: markers.map((m) => m.id),
      reprojectionErrorMm: null,
      laplacianVariance,
      handFound: false,
      detectedHand: null,
      paperCornersSeen: 0,
    });
    return {
      file: file.name,
      width,
      height,
      qrText,
      code,
      markers,
      reprojectionErrorMm: null,
      paperCorners: null,
      paperCornersSeen: 0,
      laplacianVariance,
      hand: null,
      markerMm: null,
      paperMm: null,
      checks,
      verdict,
    };
  }

  const topDown = gesture?.camera !== "side";
  const quad = topDown ? detectPaperQuad(image, "a4") : null;
  const paperGeometry = quad?.corners
    ? evaluatePaperEdgeCalibration(quad, "a4", false).geometry
    : null;

  const detected = await detectHandLandmarks(bitmap);
  const hand = detected
    ? {
        landmarksPx: detected.landmarksPx,
        handedness: detected.handedness,
        confidence: detected.confidence,
      }
    : null;

  const markerMm =
    hand && markerHomography && topDown
      ? tryMeasure(hand.landmarksPx, markerHomography)
      : null;
  const paperMm =
    hand && paperGeometry && topDown
      ? tryMeasure(hand.landmarksPx, paperGeometry.homography)
      : null;

  const { checks, verdict } = evaluateLearningPhoto({
    code,
    markerIds: markers.map((m) => m.id),
    reprojectionErrorMm,
    laplacianVariance,
    handFound: hand !== null,
    // Not compared yet: the product's `normalizeHandedness` reports the
    // opposite hand for palm-down rear-camera photos (audit 2026-09-29,
    // finding 0). The page's QR code is the ground truth for the hand; the
    // raw label stays in `hand.handedness` for analysis.
    detectedHand: null,
    paperCornersSeen: quad?.cornersSeen ?? 0,
  });

  return {
    file: file.name,
    width,
    height,
    qrText,
    code,
    markers,
    reprojectionErrorMm,
    paperCorners: quad?.corners ?? null,
    paperCornersSeen: quad?.cornersSeen ?? 0,
    laplacianVariance,
    hand,
    markerMm,
    paperMm,
    checks,
    verdict,
  };
}
