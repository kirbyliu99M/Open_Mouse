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
import type { PaperSize } from "../../lib/contracts/measurement";
import { parseKitCode, gestureByCode } from "../../lib/learning/kit";
import { NO_EXIF, readExifWhitelist } from "../../lib/learning/exif";
import {
  markerReference,
  paperFindings,
  sheetReference,
  stripReference,
} from "../../lib/learning/findings";
import {
  cardSearchRects,
  computeKitV2Layout,
} from "../../lib/learning/layoutv2";
import type { KitV2Sheet } from "../../lib/learning/session";
import {
  ANALYSIS_FAILED_MESSAGE,
  analyseSafely,
  failureKind,
} from "../../lib/learning/batch";
import { readKitQr } from "../../lib/learning/qrread";
import {
  assembleFailedReport,
  assembleLearningReport,
  type LearningPhotoReport,
} from "../../lib/learning/report";
import { estimateFocalFromExif } from "../geometry/exif-focal";
import { PhotoDecodeError, decodePhoto } from "../photo/decode";
import { detectMarkers } from "../photo/markers";
import { detectHandLandmarks } from "../photo/landmarks";
import { rgbaToGrayscale, computeLaplacianVariance } from "../photo/sharpness";
import { detectPaperQuad } from "../paper/detect";

export type { LearningPhotoReport } from "../../lib/learning/report";

export interface AnalyseOptions {
  /** Size of the sheet the photographed page is printed on; the paper-edge plane assumes it. Default A4, the kit's size. */
  readonly paperSize?: PaperSize;
  /**
   * Analyse as kit v2: a photo of this sheet, whose QR code (the participant
   * card's) names the participant and says nothing of the pose or hand. Absent
   * = kit v1, a pose page with its own QR code.
   */
  readonly sheet?: KitV2Sheet;
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

/**
 * Analyse one photo. It never throws: a photo the detectors cannot handle
 * becomes that photo's failed report (`analyseSafely`), so one bad photo does
 * not stop the rest of the batch.
 */
export function analyseLearningPhoto(
  file: File,
  options: AnalyseOptions = {},
): Promise<LearningPhotoReport> {
  const paperSize = options.paperSize ?? "a4";
  const sheet = options.sheet;
  return analyseSafely(file.name, paperSize, () =>
    sheet ? analyseV2(file, paperSize, sheet) : analyse(file, paperSize),
  );
}

/**
 * Kit v2: markers (sheet A's four, or any four or more of sheet B's six), the
 * card's QR code from its slot, paper edges, and the hand. Every photo is a
 * hand photo: the participant code does not make it a card.
 */
async function analyseV2(
  file: File,
  paperSize: PaperSize,
  sheet: KitV2Sheet,
): Promise<LearningPhotoReport> {
  let decoded;
  try {
    decoded = await decodePhoto(file);
  } catch (err) {
    const message =
      err instanceof PhotoDecodeError ? err.message : ANALYSIS_FAILED_MESSAGE;
    return assembleFailedReport(
      file.name,
      paperSize,
      message,
      failureKind(err),
    );
  }
  const { bitmap, width, height } = decoded;
  const image = imageDataOf(bitmap, width, height);
  const markers = detectMarkers(image);
  const gray = rgbaToGrayscale(image.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);
  const { exif, exifFocalPx } = await readExif(file, width, height);

  const reference = sheetReference(markers, sheet);
  const qrText = readKitQr(image, markers, reference?.homography ?? null, {
    searchRects: cardSearchRects(computeKitV2Layout(sheet)),
  });
  const code = qrText ? parseKitCode(qrText) : null;
  const detected = await detectHandLandmarks(bitmap);
  return assembleLearningReport({
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
    sheet,
    reference,
    paper: paperFindings(detectPaperQuad(image, paperSize), paperSize),
    hand: detected
      ? {
          landmarksPx: detected.landmarksPx,
          handedness: detected.handedness,
          confidence: detected.confidence,
        }
      : null,
  });
}

async function analyse(
  file: File,
  paperSize: PaperSize,
): Promise<LearningPhotoReport> {
  let decoded;
  try {
    decoded = await decodePhoto(file);
  } catch (err) {
    // The decoder's own retake text is fixed copy; anything else could quote
    // a path, so it is replaced by the generic sentence.
    const message =
      err instanceof PhotoDecodeError ? err.message : ANALYSIS_FAILED_MESSAGE;
    return assembleFailedReport(
      file.name,
      paperSize,
      message,
      failureKind(err),
    );
  }

  const { bitmap, width, height } = decoded;
  const image = imageDataOf(bitmap, width, height);
  const markers = detectMarkers(image);
  const gray = rgbaToGrayscale(image.data, width * height);
  const laplacianVariance = computeLaplacianVariance(gray, width, height);
  const { exif, exifFocalPx } = await readExif(file, width, height);

  const flat = markerReference(markers);
  // Only a QR code that parses as a kit code; any other is ignored.
  const qrText = readKitQr(image, markers, flat?.homography ?? null);
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
