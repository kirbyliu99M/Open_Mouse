/**
 * The per-photo record (run-log format 2) and the pure step that builds it.
 *
 * `src/client/learning/analyse.ts` does the impure part (decode, QR, ArUco,
 * paper edges, MediaPipe, EXIF bytes) and hands what it found to
 * `assembleLearningReport`, which does every decision and every number:
 * the two calibration planes, the measurements, the checks and the verdict.
 * Because it is pure, a synthetic scene can prove what a saved record holds.
 *
 * Field by field: see docs/learning/README.md ("Run log, format 2").
 */
import type { Homography, Point2 } from "../../client/geometry/homography";
import type { DetectedMarker } from "../../client/photo/markers";
import type { HandMeasurements, PaperSize } from "../contracts/measurement";
import { NO_EXIF, pickExifWhitelist, type ExifWhitelist } from "./exif";
import {
  evaluateLearningPhoto,
  type LearningCheck,
  type LearningVerdict,
} from "./checks";
import { LEARNING_KIT_VERSION, type KitCode } from "./kit";
import { buildPlane, type PlaneCalibration, type PlaneMethod } from "./plane";

export interface LearningPhotoReport {
  /** The kit version of the code that analysed the photo. The page's own version is `code.version`. */
  readonly kitVersion: number;
  /** Full commit hash of the code that ran; stamped by `learn:sort`, `null` in a download from the checker page. */
  readonly gitSha: string | null;
  /** `true` when that checkout had uncommitted changes; `null` where `gitSha` is. */
  readonly gitDirty: boolean | null;
  /** The file's own name, never a path. */
  readonly file: string;
  /** The decoded frame (after orientation and downscaling); every px value below is in it. */
  readonly width: number;
  readonly height: number;
  /** Size of the sheet the paper-edge plane assumes. */
  readonly paperSize: PaperSize;
  /** The white-listed EXIF values; see `src/lib/learning/exif.ts`. */
  readonly exif: ExifWhitelist;
  readonly qrText: string | null;
  readonly code: KitCode | null;
  readonly markers: readonly DetectedMarker[];
  readonly reprojectionErrorMm: number | null;
  readonly paperCorners: readonly Point2[] | null;
  readonly paperCornersSeen: number;
  readonly laplacianVariance: number;
  readonly hand: {
    readonly landmarksPx: readonly Point2[];
    /** MediaPipe's label after `normalizeHandedness` (the hand in the photo, not swapped). */
    readonly handedness: "left" | "right" | null;
    readonly confidence: number;
  } | null;
  /** The printed-marker plane (flat pages) or the strip plane (side pages). */
  readonly markerPlane: PlaneCalibration | null;
  /** The paper-edge plane; flat pages only. */
  readonly paperPlane: PlaneCalibration | null;
  /** Measurements through the marker plane, parallax-corrected like the blank-paper path. */
  readonly markerMm: HandMeasurements | null;
  /** Measurements through the paper-edge plane, exactly as the product computes them. */
  readonly paperMm: HandMeasurements | null;
  readonly checks: readonly LearningCheck[];
  readonly verdict: LearningVerdict;
  readonly error?: string;
}

export interface ReportFindings {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly paperSize: PaperSize;
  /** Whatever the EXIF reader produced; only the white-listed keys survive. */
  readonly exif: unknown;
  /** EXIF focal length in px of the decoded frame (the product's `estimateFocalFromExif`), or `null`. */
  readonly exifFocalPx: number | null;
  readonly qrText: string | null;
  readonly code: KitCode | null;
  readonly markers: readonly DetectedMarker[];
  readonly laplacianVariance: number;
  /** The homography from the printed markers, when they were found. */
  readonly reference: {
    readonly method: Extract<PlaneMethod, "markers" | "strip-markers">;
    readonly homography: Homography;
    /** The flat-marker fit; `null` for a strip. */
    readonly reprojectionErrorMm: number | null;
  } | null;
  /** The paper's edges, when top-down detection ran. */
  readonly paper: {
    readonly corners: readonly Point2[] | null;
    readonly cornersSeen: number;
    readonly homography: Homography | null;
    readonly edgeFitResidualMm: number | null;
  } | null;
  readonly hand: NonNullable<LearningPhotoReport["hand"]> | null;
}

/** A photo that could not be decoded at all. */
export function assembleFailedReport(
  file: string,
  paperSize: PaperSize,
  message: string,
): LearningPhotoReport {
  return {
    kitVersion: LEARNING_KIT_VERSION,
    gitSha: null,
    gitDirty: null,
    file,
    width: 0,
    height: 0,
    paperSize,
    exif: NO_EXIF,
    qrText: null,
    code: null,
    markers: [],
    reprojectionErrorMm: null,
    paperCorners: null,
    paperCornersSeen: 0,
    laplacianVariance: 0,
    hand: null,
    markerPlane: null,
    paperPlane: null,
    markerMm: null,
    paperMm: null,
    checks: [{ id: "qr", tone: "bad", message }],
    verdict: "unidentified",
    error: message,
  };
}

export function assembleLearningReport(
  findings: ReportFindings,
): LearningPhotoReport {
  const f = findings;
  // A participant card carries no hand and no measurements.
  const card = f.code?.kind === "participant";
  const hand = card ? null : f.hand;
  const paper = card ? null : f.paper;
  const reference = card ? null : f.reference;
  const imageSize = { width: f.width, height: f.height };

  const marker = reference
    ? buildPlane({
        method: reference.method,
        homography: reference.homography,
        fit: {
          reprojectionErrorMm: reference.reprojectionErrorMm,
          edgeFitResidualMm: null,
        },
        landmarksPx: hand?.landmarksPx ?? null,
        exifFocalPx: f.exifFocalPx,
        imageSize,
        parallax: reference.method === "markers",
      })
    : null;
  const paperResult =
    paper?.homography != null
      ? buildPlane({
          method: "paper-edge",
          homography: paper.homography,
          fit: {
            reprojectionErrorMm: null,
            edgeFitResidualMm: paper.edgeFitResidualMm,
          },
          landmarksPx: hand?.landmarksPx ?? null,
          exifFocalPx: f.exifFocalPx,
          imageSize,
          parallax: true,
        })
      : null;

  const { checks, verdict } = evaluateLearningPhoto({
    code: f.code,
    markerIds: f.markers.map((m) => m.id),
    reprojectionErrorMm: card ? null : (reference?.reprojectionErrorMm ?? null),
    laplacianVariance: f.laplacianVariance,
    handFound: hand !== null,
    // The label is the hand in the photo since #77 (`normalizeHandedness` no
    // longer swaps it), so it is compared with the page's hand again. It
    // only warns: the page's QR code stays the ground truth.
    detectedHand: hand?.handedness ?? null,
    paperCornersSeen: paper?.cornersSeen ?? 0,
  });

  return {
    kitVersion: LEARNING_KIT_VERSION,
    gitSha: null,
    gitDirty: null,
    file: f.file,
    width: f.width,
    height: f.height,
    paperSize: f.paperSize,
    exif: pickExifWhitelist(f.exif),
    qrText: f.qrText,
    code: f.code,
    markers: f.markers,
    reprojectionErrorMm: card ? null : (reference?.reprojectionErrorMm ?? null),
    paperCorners: paper?.corners ?? null,
    paperCornersSeen: paper?.cornersSeen ?? 0,
    laplacianVariance: f.laplacianVariance,
    hand,
    markerPlane: marker?.plane ?? null,
    paperPlane: paperResult?.plane ?? null,
    markerMm: marker?.measurements ?? null,
    paperMm: paperResult?.measurements ?? null,
    checks,
    verdict,
  };
}

export interface Provenance {
  readonly gitSha: string | null;
  readonly gitDirty: boolean | null;
}

/** The same report with the code version stamped on it. */
export function stampProvenance(
  report: LearningPhotoReport,
  provenance: Provenance,
): LearningPhotoReport {
  return {
    ...report,
    gitSha: provenance.gitSha,
    gitDirty: provenance.gitDirty,
  };
}
