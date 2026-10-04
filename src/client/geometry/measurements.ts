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
 *    The heights scale with the photo's own hand length, which is itself
 *    measured from corrected points: see `correctLandmarksByHandLength`.
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
  landmarkHeightsMm,
  REFERENCE_HAND_LENGTH_MM,
  REFERENCE_LANDMARK_HEIGHTS_MM,
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

function evaluateDefinition(
  points: readonly Point2[],
  { kind, indices }: ParsedDefinition,
): number {
  return kind === "distance"
    ? distanceMm(points, indices[0], indices[1])
    : chainMm(points, indices);
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
    measurements[field] = evaluateDefinition(
      points,
      parseDefinition(field, definition),
    );
  }
  return handMeasurementsSchema.parse(measurements);
}

/**
 * The hand length the landmark heights are scaled to: exactly the contract's
 * own `handLengthMm` definition (`MEASUREMENT_DEFINITIONS.handLengthMm`, today
 * the straight distance from landmark 0, the wrist, to landmark 12, the middle
 * fingertip, in sheet mm). It is read from the contract, not written out here,
 * so the number the heights are scaled to is always the number reported as
 * `handLengthMm`. Unlike `measurementsFromSheetMm` it does not check the
 * result against the contract's ranges: it is an intermediate value.
 */
export function handLengthFromSheetMm(points: readonly Point2[]): number {
  return evaluateDefinition(
    points,
    parseDefinition("handLengthMm", MEASUREMENT_DEFINITIONS.handLengthMm),
  );
}

/**
 * The correction counts as settled when the hand length measured from the
 * corrected points is within this many mm of the length the heights were
 * scaled to.
 */
export const HAND_LENGTH_SETTLED_MM = 0.01;

/**
 * Most correction passes `correctLandmarksByHandLength` makes by default. A
 * hand that has not settled by then is returned as it stands, with
 * `converged: false` (never thrown): the cap only guards a geometry where the
 * passes would not converge.
 */
export const MAX_CORRECTION_PASSES = 8;

export interface HandLengthCorrection {
  /** The 21 landmarks in sheet mm, back-projected at `heightsMm`. */
  readonly points: Point2[];
  /** The 21 heights the points were back-projected at (the last pass's). */
  readonly heightsMm: number[];
  /**
   * The hand length `heightsMm` is scaled to (`heightsMm` is
   * `landmarkHeightsMm(handLengthMm)`). Within `HAND_LENGTH_SETTLED_MM` of the
   * hand length measured from `points`, unless the passes ran out.
   */
  readonly handLengthMm: number;
  /** How many back-projection passes it took, 1 up to the cap. */
  readonly passes: number;
  /**
   * True when the hand length measured from `points` is within
   * `HAND_LENGTH_SETTLED_MM` of `handLengthMm`. False when the cap was reached
   * first: `points` and `heightsMm` are then the last pass's, not settled.
   */
  readonly converged: boolean;
}

export interface HandLengthCorrectionOptions {
  /** Most passes to make, an integer of 1 or more. Default `MAX_CORRECTION_PASSES`. */
  readonly maxPasses?: number;
}

/**
 * Parallax-correct 21 landmarks with heights proportional to the hand's own
 * length (landmark-heights-v2, parallax.ts). The length is not known until the
 * landmarks are corrected, so the passes repeat until the heights and the
 * length agree:
 *
 *  1. back-project at the reference heights (a hand of 190 mm) and measure the
 *     hand length from those points (`handLengthFromSheetMm`);
 *  2. if it is within `HAND_LENGTH_SETTLED_MM` of the length the heights were
 *     scaled to, stop; otherwise back-project again at `landmarkHeightsMm` of
 *     the length just measured, and measure again (at most
 *     `options.maxPasses` passes in all, `MAX_CORRECTION_PASSES` by default;
 *     `converged` says whether it settled before the cap).
 *
 * Each pass shrinks the disagreement about twelvefold. In the unit-test scenes
 * (hands of 160 to 220 mm, a camera 350 or 450 mm up, a hand up to 160 mm from
 * the point under the camera, hands standing at the v2 heights and at the v1
 * ones) the first pass is off by up to 2.5 mm, and the passes settle in at
 * most 5, so a further pass would change the hand length by under 0.001 mm.
 * (Stopping after two passes, as an earlier version did, left up to 0.22 mm
 * for a hand far from the camera's axis.) A pure function of its inputs. The
 * result is only as good as the ratios: it makes the heights consistent with
 * the length, it does not make them true.
 *
 * A pass whose length cannot give heights (not finite, or zero) throws the
 * RangeError of `landmarkHeightsMm`, and so does a `maxPasses` that is not an
 * integer of 1 or more.
 */
export function correctLandmarksByHandLength(
  landmarksPx: readonly Point2[],
  homography: Homography,
  intrinsics: Intrinsics,
  options: HandLengthCorrectionOptions = {},
): HandLengthCorrection {
  const maxPasses = options.maxPasses ?? MAX_CORRECTION_PASSES;
  if (!Number.isInteger(maxPasses) || maxPasses < 1) {
    throw new RangeError(
      "correctLandmarksByHandLength: maxPasses must be an integer of 1 or more.",
    );
  }
  let heightsMm: number[] = [...REFERENCE_LANDMARK_HEIGHTS_MM];
  let scaledToMm = REFERENCE_HAND_LENGTH_MM;
  let points = correctLandmarks(landmarksPx, homography, intrinsics, heightsMm);
  let measuredMm = handLengthFromSheetMm(points);
  let passes = 1;
  // `!(x < tolerance)` rather than `x >= tolerance`: a length that is NaN must
  // go on and throw in `landmarkHeightsMm`, not be taken as settled.
  while (
    passes < maxPasses &&
    !(Math.abs(measuredMm - scaledToMm) < HAND_LENGTH_SETTLED_MM)
  ) {
    scaledToMm = measuredMm;
    heightsMm = landmarkHeightsMm(scaledToMm);
    points = correctLandmarks(landmarksPx, homography, intrinsics, heightsMm);
    measuredMm = handLengthFromSheetMm(points);
    passes++;
  }
  return {
    points,
    heightsMm,
    handLengthMm: scaledToMm,
    passes,
    converged: Math.abs(measuredMm - scaledToMm) < HAND_LENGTH_SETTLED_MM,
  };
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
  /**
   * Per-landmark heights above the sheet, mm. Overrides the product's own
   * (`correctLandmarksByHandLength`: proportional to the hand length), and
   * then a single pass is made at exactly these heights.
   */
  readonly heightsMm?: readonly number[];
}

export interface CorrectedMeasurementsResult {
  readonly measurements: HandMeasurements;
  /** False when neither EXIF nor a well-conditioned homography focal estimate was available — `measurements` is then the uncorrected path's result. */
  readonly parallaxCorrected: boolean;
  readonly focalSource: FocalSource;
  /** The 21 heights the points were back-projected at; `null` when `parallaxCorrected` is false. */
  readonly heightsMm: readonly number[] | null;
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
      heightsMm: null,
    };
  }

  const intrinsics: Intrinsics = { fPx: resolved.fPx, ...principalPoint };
  const { points, heightsMm } = options.heightsMm
    ? {
        points: correctLandmarks(
          landmarks,
          homography,
          intrinsics,
          options.heightsMm,
        ),
        heightsMm: [...options.heightsMm],
      }
    : correctLandmarksByHandLength(landmarks, homography, intrinsics);
  return {
    measurements: measurementsFromSheetMm(points),
    parallaxCorrected: true,
    focalSource: resolved.source,
    heightsMm,
  };
}
