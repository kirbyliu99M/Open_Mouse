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
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../../client/geometry/homography";
import { runPaperEdgeHandGates } from "../../client/photo/gates";
import type { DetectedMarker } from "../../client/photo/markers";
import {
  PAPER_SIZES_MM,
  type HandMeasurements,
  type PaperSize,
} from "../contracts/measurement";
import { NO_EXIF, pickExifWhitelist, type ExifWhitelist } from "./exif";
import {
  evaluateLearningPhoto,
  type LearningCheck,
  type LearningVerdict,
} from "./checks";
import { LEARNING_KIT_VERSION, type KitCode } from "./kit";
import { buildPlane, type PlaneCalibration, type PlaneMethod } from "./plane";

/** What the paper detector saw, kept even when it could not find all four corners. */
export interface PaperDetectionRecord {
  /** A plausible sheet-sized region was located at all. */
  readonly regionFound: boolean;
  /** Smallest fraction of any side's length that was actually seen, 0 to 1 (the wrist usually hides part of one). */
  readonly minSideCoverage: number;
  /** The worst fitted side's mean distance to its line, in frame px. */
  readonly edgeFitResidualPx: number;
  /** Which side that was (0 top, 1 right, 2 bottom, 3 left); `null` when no side was fitted. */
  readonly worstSideIndex: number | null;
  /** Top-left, top-right, bottom-right, bottom-left: was the corner found from two fitted sides. */
  readonly cornersFound: readonly boolean[];
}

/** The outcome of one group of the product's gates, as codes (`GateFailureCode`). */
export interface GateRecord {
  readonly ok: boolean;
  readonly errorCodes: readonly string[];
  readonly warningCodes: readonly string[];
}

/**
 * Would the product's blank-paper flow take this photo, and if not, why.
 * Worked out with the product's own gate functions from the values recorded
 * next to it, so it can be checked from the record alone.
 */
export interface ProductGatesRecord {
  /** Paper found, four corners seen, enough of each edge, sheet not curled (`checkPaperEdgeGatesOnly`). */
  readonly paper: GateRecord;
  /**
   * Hand detected, its label agrees with the page's hand, confident, inside the
   * sheet, sharp (`runPaperEdgeHandGates`). `null` when the product would not
   * have got this far because there is no paper homography, and also when
   * `runPaperEdgeHandGates` itself threw (the record does not say which).
   */
  readonly hand: GateRecord | null;
  /** `paper.ok` and `hand.ok`. */
  readonly accepted: boolean;
}

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
  /** The QR text, only when it parsed as a kit code (`code`); any other QR code in the photo is not kept. */
  readonly qrText: string | null;
  readonly code: KitCode | null;
  readonly markers: readonly DetectedMarker[];
  readonly reprojectionErrorMm: number | null;
  readonly paperCorners: readonly Point2[] | null;
  readonly paperCornersSeen: number;
  /** The paper detector's diagnostics; `null` where paper detection did not run (side pages, cards). */
  readonly paperEdge: PaperDetectionRecord | null;
  /** The product's verdict on the paper and the hand; `null` where paper detection did not run. */
  readonly productGates: ProductGatesRecord | null;
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
  /** For a photo that could not be analysed: the error's class name (never its message). */
  readonly errorKind?: string;
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
    readonly detection: PaperDetectionRecord;
    /** The product's paper gates for this quad (`evaluatePaperEdgeCalibration`). */
    readonly gates: GateRecord;
  } | null;
  readonly hand: NonNullable<LearningPhotoReport["hand"]> | null;
}

/** A photo that could not be decoded at all. */
export function assembleFailedReport(
  file: string,
  paperSize: PaperSize,
  message: string,
  errorKind?: string,
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
    paperEdge: null,
    productGates: null,
    laplacianVariance: 0,
    hand: null,
    markerPlane: null,
    paperPlane: null,
    markerMm: null,
    paperMm: null,
    checks: [{ id: "qr", tone: "bad", message }],
    verdict: "unidentified",
    error: message,
    ...(errorKind === undefined ? {} : { errorKind }),
  };
}

/**
 * The product's gates for this photo: its paper gates (already decided by
 * `paperFindings`) and its hand gates, run here on the values recorded in the
 * report. The hand gates get what `runPaperEdgePipeline` gives them: the
 * landmarks projected flat through the paper homography, the sheet's four
 * corners in mm, and the page's hand as the hand the user "stated".
 */
function productGates(
  f: ReportFindings,
  paper: ReportFindings["paper"],
  hand: ReportFindings["hand"],
): ProductGatesRecord | null {
  if (!paper) return null;
  const gates: GateRecord = paper.gates;
  const homography = paper.homography;
  let handRecord: GateRecord | null = null;
  if (homography) {
    try {
      const { width, height } = PAPER_SIZES_MM[f.paperSize];
      const result = runPaperEdgeHandGates({
        paperFound: paper.detection.regionFound,
        landmarkCount: hand?.landmarksPx.length ?? 0,
        handedness: hand?.handedness ?? null,
        handStated: f.code?.kind === "gesture" ? f.code.hand : undefined,
        landmarkConfidence: hand?.confidence ?? 0,
        landmarksMm: (hand?.landmarksPx ?? []).map((p) =>
          applyHomography(homography, p),
        ),
        paperCornersMm: [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ],
        laplacianVariance: f.laplacianVariance,
      });
      handRecord = {
        ok: result.ok,
        errorCodes: result.errors.map((e) => e.code),
        warningCodes: result.warnings.map((w) => w.code),
      };
    } catch {
      handRecord = null;
    }
  }
  return {
    paper: gates,
    hand: handRecord,
    accepted: gates.ok && handRecord?.ok === true,
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
    // Only a kit code is kept. The text of any other QR code in the photo
    // is someone else's and says nothing about the page.
    qrText: f.code ? f.qrText : null,
    code: f.code,
    markers: f.markers,
    reprojectionErrorMm: card ? null : (reference?.reprojectionErrorMm ?? null),
    paperCorners: paper?.corners ?? null,
    paperCornersSeen: paper?.cornersSeen ?? 0,
    paperEdge: paper?.detection ?? null,
    productGates: productGates(f, paper, hand),
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
