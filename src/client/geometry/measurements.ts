/**
 * MediaPipe landmarks (image px) → HandMeasurements (sheet mm).
 *
 * Reads its arithmetic straight from `MEASUREMENT_DEFINITIONS` in
 * src/lib/contracts/measurement.ts rather than re-encoding it, so this stays
 * correct by construction if that contract's definitions are ever extended.
 * "distance" is a straight line; "chain" sums consecutive segment lengths
 * (never a straight line from base to tip, which undercounts a curled
 * finger).
 *
 * Two ways to get from landmarks to measurements:
 *  - `computeHandMeasurements`: the original, uncorrected path — every
 *    landmark projected straight onto the sheet plane (z = 0) via the
 *    homography. Kept as-is; still what callers get if they don't opt into
 *    parallax correction.
 *  - `computeCorrectedHandMeasurements`: back-projects each landmark onto
 *    the plane at its own height above the sheet first (parallax.ts, issue
 *    #16), following the focal policy documented on that function — EXIF
 *    focal length when available, else a well-conditioned homography-focal
 *    estimate, else no correction at all (never a silently-wrong one).
 * Both funnel through `measurementsFromSheetMm`, so the arithmetic itself
 * only lives in one place.
 */
import {
  MEASUREMENT_DEFINITIONS,
  handMeasurementsSchema,
  type HandMeasurements,
} from "../../lib/contracts/measurement";
import { centrePrincipalPoint, type Intrinsics } from "./camera-pose";
import { applyHomography, type Homography, type Point2 } from "./homography";
import {
  correctLandmarks,
  LANDMARK_HEIGHTS_MM,
  type FocalSource,
  resolveFocalPx,
} from "./parallax";

/** MediaPipe Hand Landmarker: 21 joint-centre landmarks, image pixels. */
export type Landmark = Point2;

const EXPECTED_LANDMARK_COUNT = 21;

type DefinitionKind = "distance" | "chain";

interface ParsedDefinition {
  kind: DefinitionKind;
  indices: number[];
}

const DEFINITION_PATTERN = /^(distance|chain)\(([\d,\s]+)\)$/;

function parseDefinition(field: string, definition: string): ParsedDefinition {
  const match = DEFINITION_PATTERN.exec(definition);
  if (!match) {
    throw new Error(
      `Unrecognised measurement definition for ${field}: "${definition}"`,
    );
  }
  const kind = match[1] as DefinitionKind;
  const indices = match[2].split(",").map((s) => Number(s.trim()));
  if (kind === "distance" && indices.length !== 2) {
    throw new Error(
      `"distance" definition for ${field} needs exactly 2 indices.`,
    );
  }
  if (kind === "chain" && indices.length < 2) {
    throw new Error(
      `"chain" definition for ${field} needs at least 2 indices.`,
    );
  }
  return { kind, indices };
}

function distanceMm(points: readonly Point2[], a: number, b: number): number {
  return Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
}

function chainMm(
  points: readonly Point2[],
  indices: readonly number[],
): number {
  let total = 0;
  for (let i = 1; i < indices.length; i++) {
    total += distanceMm(points, indices[i - 1], indices[i]);
  }
  return total;
}

function assertLandmarkCount(landmarks: readonly Landmark[], fn: string): void {
  if (landmarks.length !== EXPECTED_LANDMARK_COUNT) {
    throw new RangeError(
      `${fn} expects ${EXPECTED_LANDMARK_COUNT} MediaPipe landmarks, got ${landmarks.length}.`,
    );
  }
}

/**
 * Compute every field in `MEASUREMENT_DEFINITIONS` from 21 points already in
 * sheet mm, and validate the result against `handMeasurementsSchema` — so an
 * implausible measurement (or a bug) fails loudly here rather than reaching
 * the server. Shared by both the uncorrected and parallax-corrected paths
 * below.
 */
export function measurementsFromSheetMm(
  points: readonly Point2[],
): HandMeasurements {
  const measurements: Record<string, number> = {};
  for (const [field, definition] of Object.entries(MEASUREMENT_DEFINITIONS)) {
    const { kind, indices } = parseDefinition(field, definition);
    measurements[field] =
      kind === "distance"
        ? distanceMm(points, indices[0], indices[1])
        : chainMm(points, indices);
  }
  return handMeasurementsSchema.parse(measurements);
}

/**
 * Project 21 MediaPipe landmarks through the homography into sheet mm
 * (uncorrected — every landmark projected onto z = 0, the sheet plane
 * itself), then compute every field in `MEASUREMENT_DEFINITIONS`.
 */
export function computeHandMeasurements(
  landmarks: readonly Landmark[],
  homography: Homography,
): HandMeasurements {
  assertLandmarkCount(landmarks, "computeHandMeasurements");
  const points = landmarks.map((landmark) =>
    applyHomography(homography, landmark),
  );
  return measurementsFromSheetMm(points);
}

export interface CorrectedMeasurementsOptions {
  /** Focal length in px, from exif-focal.ts, for the decoded/oriented/downscaled bitmap. Null if EXIF had none. */
  readonly exifFocalPx: number | null;
  /** The decoded bitmap's pixel dimensions, for the principal point (image centre) and as the intrinsics' implicit frame. */
  readonly widthPx: number;
  readonly heightPx: number;
  /** Per-landmark heights above the sheet, mm. Defaults to `LANDMARK_HEIGHTS_MM`. */
  readonly heightsMm?: readonly number[];
}

export interface CorrectedMeasurementsResult {
  readonly measurements: HandMeasurements;
  /** False when neither EXIF nor a well-conditioned homography focal estimate was available — `measurements` is then the uncorrected path's result. */
  readonly parallaxCorrected: boolean;
  readonly focalSource: FocalSource;
}

/**
 * Parallax-corrected measurements (issue #16): back-project each landmark
 * onto the plane at its own height above the sheet (parallax.ts) instead of
 * straight onto z = 0, following the focal policy in
 * `resolveFocalPx` — EXIF focal length when present, else a
 * well-conditioned homography-focal estimate, else no correction (falls
 * back to the same uncorrected projection `computeHandMeasurements` uses,
 * with `parallaxCorrected: false` so the caller — and
 * `calibrationEvidenceSchema` — can tell).
 */
export function computeCorrectedHandMeasurements(
  landmarks: readonly Landmark[],
  homography: Homography,
  options: CorrectedMeasurementsOptions,
): CorrectedMeasurementsResult {
  assertLandmarkCount(landmarks, "computeCorrectedHandMeasurements");

  const principalPoint = centrePrincipalPoint(
    options.widthPx,
    options.heightPx,
  );
  const resolved = resolveFocalPx({
    exifFocalPx: options.exifFocalPx,
    homography,
    principalPoint,
  });

  if (resolved.fPx === null) {
    const points = landmarks.map((landmark) =>
      applyHomography(homography, landmark),
    );
    return {
      measurements: measurementsFromSheetMm(points),
      parallaxCorrected: false,
      focalSource: resolved.source,
    };
  }

  const intrinsics: Intrinsics = { fPx: resolved.fPx, ...principalPoint };
  const corrected = correctLandmarks(
    landmarks,
    homography,
    intrinsics,
    options.heightsMm ?? LANDMARK_HEIGHTS_MM,
  );
  return {
    measurements: measurementsFromSheetMm(corrected),
    parallaxCorrected: true,
    focalSource: resolved.source,
  };
}
