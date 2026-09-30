/**
 * Synthetic v2 run logs for the M2 evaluator's tests. NOT a test file.
 *
 * A photo here is a report whose planes are the identity homography with no
 * parallax correction, so the millimetre values the evaluator recomputes are
 * exactly the landmark distances chosen in the test: a photo made with
 * `lengthMm: 188` measures a hand length of 188 mm on that path, and every
 * expected statistic can be worked out by hand. (The realistic scenes, with
 * focal lengths, parallax and noise, are in learning-m2-scenes.test.ts.)
 */
import type { Point2 } from "../../../src/client/geometry/homography";
import type { PlaneCalibration } from "../../../src/lib/learning/plane";
import type {
  GateRecord,
  LearningPhotoReport,
  ProductGatesRecord,
} from "../../../src/lib/learning/report";
import {
  buildRunLog,
  sortReports,
  type LearningRunLog,
} from "../../../src/lib/learning/runlog";
import type { Truth } from "../../../src/lib/learning/truth";
import { emptyTruth } from "../../../src/lib/learning/truth";
import {
  HAND_MM,
  TRUE_HAND_LENGTH_MM,
  TRUE_PALM_WIDTH_MM,
} from "./learning-scene";

/** Palm width / hand length of the template hand: a measured palm width is `PALM_RATIO * length`. */
export const PALM_RATIO = TRUE_PALM_WIDTH_MM / TRUE_HAND_LENGTH_MM;

/** 21 landmarks whose wrist-to-middle-fingertip distance is exactly `lengthMm`. */
export function handOfLength(lengthMm: number): Point2[] {
  const k = lengthMm / TRUE_HAND_LENGTH_MM;
  return HAND_MM.map((p) => ({ x: p.x * k, y: p.y * k }));
}

const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** A plane that maps pixels to millimetres 1:1, with no parallax correction. */
export function identityPlane(
  method: "markers" | "paper-edge",
): PlaneCalibration {
  return {
    method,
    homography: IDENTITY.map((row) => [...row]),
    fit: { reprojectionErrorMm: null, edgeFitResidualMm: null },
    parallax: {
      corrected: false,
      focalSource: "none",
      focalPx: null,
      exifFocalPx: null,
      principalPoint: { cx: 0, cy: 0 },
      imageSize: { width: 1, height: 1 },
      heightsVersion: "landmark-heights-v1",
      heightsMm: Array<number>(21).fill(0),
      error: null,
    },
    landmarksSheetMm: null,
  };
}

const okGate: GateRecord = { ok: true, errorCodes: [], warningCodes: [] };

export interface SyntheticPhoto {
  readonly participant: string;
  readonly hand: "left" | "right";
  /** Default "G01". */
  readonly gesture?: string;
  /** Hand length through the marker plane, mm; `null` = no marker plane. Default: same as the paper plane. */
  readonly markersMm?: number | null;
  /** Hand length through the paper-edge plane, mm; `null` = no paper plane. */
  readonly paperMm: number | null;
  /** Default: the product accepts the photo. */
  readonly refusedBy?: {
    readonly paper?: readonly string[];
    readonly hand?: readonly string[];
  };
  /** No hand was found. */
  readonly noHand?: boolean;
  /** The checker said retake: the photo is not filed. */
  readonly retake?: boolean;
  /** A recorded value that must NOT be used (the evaluator recomputes). Default: absurd numbers. */
  readonly recordedMm?: number;
}

function gates(photo: SyntheticPhoto): ProductGatesRecord {
  const paperCodes = photo.refusedBy?.paper ?? [];
  const handCodes = photo.refusedBy?.hand ?? [];
  const paper: GateRecord = {
    ok: paperCodes.length === 0,
    errorCodes: [...paperCodes],
    warningCodes: [],
  };
  const hand: GateRecord | null =
    paperCodes.length > 0 && handCodes.length === 0
      ? null
      : {
          ok: handCodes.length === 0,
          errorCodes: [...handCodes],
          warningCodes: [],
        };
  return {
    paper,
    hand,
    accepted: paper.ok && (hand?.ok ?? false),
  };
}

function photoReport(photo: SyntheticPhoto, file: string): LearningPhotoReport {
  const gesture = photo.gesture ?? "G01";
  const markersMm =
    photo.markersMm === undefined ? photo.paperMm : photo.markersMm;
  const wrong = photo.recordedMm ?? 999;
  const measurements = (length: number) =>
    ({ handLengthMm: length, palmLengthMm: 90, palmWidthMm: 80 }) as const;
  return {
    kitVersion: 1,
    gitSha: null,
    gitDirty: null,
    file,
    width: 1000,
    height: 1000,
    paperSize: "a4",
    exif: {
      focalLengthMm: null,
      focalLengthIn35mmFilm: null,
      pixelXDimension: null,
      pixelYDimension: null,
    },
    qrText: `https://open-mouse.vercel.app/l/v1/${gesture}${photo.hand === "right" ? "R" : "L"}`,
    code: {
      kind: "gesture",
      version: 1,
      gesture: gesture as "G01",
      hand: photo.hand,
    },
    markers: [],
    reprojectionErrorMm: null,
    paperCorners: null,
    paperCornersSeen: 4,
    paperEdge: null,
    productGates: gates(photo),
    laplacianVariance: 300,
    hand: photo.noHand
      ? null
      : {
          landmarksPx: handOfLength(1), // replaced per plane below
          handedness: photo.hand,
          confidence: 0.9,
        },
    markerPlane: markersMm === null ? null : identityPlane("markers"),
    paperPlane: photo.paperMm === null ? null : identityPlane("paper-edge"),
    // The recorded values are deliberately wrong: an evaluator that read
    // them instead of recomputing from the planes would be off by miles.
    markerMm: measurements(wrong),
    paperMm: measurements(wrong),
    checks: [],
    verdict: photo.retake ? "retake" : "ready",
  } as unknown as LearningPhotoReport;
}

/**
 * The hand's landmarks are shared by both planes of a photo, so a photo that
 * should measure differently on the two paths needs different planes. The
 * paper plane is the identity (measured = the landmarks' own distances); the
 * marker plane is that scaled by markers / paper.
 */
function withLandmarks(photo: SyntheticPhoto, report: LearningPhotoReport) {
  if (photo.noHand) return report;
  const markersMm =
    photo.markersMm === undefined ? photo.paperMm : photo.markersMm;
  const base = photo.paperMm ?? markersMm ?? 150;
  const markerPlane =
    report.markerPlane && markersMm !== null
      ? {
          ...report.markerPlane,
          homography: [
            [markersMm / base, 0, 0],
            [0, markersMm / base, 0],
            [0, 0, 1],
          ],
        }
      : report.markerPlane;
  return {
    ...report,
    hand: { ...report.hand!, landmarksPx: handOfLength(base) },
    markerPlane,
  } as LearningPhotoReport;
}

export function slateReport(
  participant: string,
  file: string,
): LearningPhotoReport {
  return {
    kitVersion: 1,
    gitSha: null,
    gitDirty: null,
    file,
    width: 1000,
    height: 1000,
    paperSize: "a4",
    exif: {
      focalLengthMm: null,
      focalLengthIn35mmFilm: null,
      pixelXDimension: null,
      pixelYDimension: null,
    },
    qrText: `https://open-mouse.vercel.app/l/v1/${participant}`,
    code: { kind: "participant", version: 1, participant },
    markers: [],
    reprojectionErrorMm: null,
    paperCorners: null,
    paperCornersSeen: 0,
    paperEdge: null,
    productGates: null,
    laplacianVariance: 300,
    hand: null,
    markerPlane: null,
    paperPlane: null,
    markerMm: null,
    paperMm: null,
    checks: [],
    verdict: "slate",
  } as unknown as LearningPhotoReport;
}

/**
 * One run log: for each participant a card photo, then their photos, in file
 * name order (the order `learn:sort` files them in), all sorted by the real
 * `sortReports`.
 */
export function runLogOf(
  photos: readonly SyntheticPhoto[],
  options: {
    readonly input?: string | null;
    readonly gitSha?: string | null;
  } = {},
): LearningRunLog {
  const reports: LearningPhotoReport[] = [];
  let n = 0;
  const name = () => `IMG_${String(++n).padStart(4, "0")}.jpg`;
  const participants: string[] = [];
  for (const p of photos)
    if (!participants.includes(p.participant)) participants.push(p.participant);
  for (const participant of participants) {
    reports.push(slateReport(participant, name()));
    for (const photo of photos.filter((p) => p.participant === participant)) {
      reports.push(withLandmarks(photo, photoReport(photo, name())));
    }
  }
  return buildRunLog({
    reports,
    sort: sortReports(reports),
    paperSize: "a4",
    input: options.input ?? "../Photos/session-1",
    provenance: {
      gitSha: options.gitSha ?? null,
      gitDirty: options.gitSha ? false : null,
    },
    now: new Date("2026-10-02T00:00:00Z"),
  });
}

/** A truth file with both hands filled (mm), or `null` for a value not measured. */
export function truthOf(
  participant: string,
  right: { handLengthMm: number | null; palmWidthMm: number | null },
  left: { handLengthMm: number | null; palmWidthMm: number | null } = right,
): Truth {
  return { ...emptyTruth(participant), right, left };
}
