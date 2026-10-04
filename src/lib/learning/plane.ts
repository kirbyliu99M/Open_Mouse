/**
 * One calibration plane of one learning-kit photo, recorded so the mm
 * numbers can be worked out again later from the record alone.
 *
 * A top-down photo has two planes, both measured through the same product
 * algorithm (`computeCorrectedHandMeasurements`, the blank-paper path's):
 *  - "markers":    the printed ArUco squares (the reference),
 *  - "paper-edge": the sheet's own edges (what the product uses).
 * A side photo has one, the upright strip's markers ("strip-markers"). No
 * parallax correction is defined for it: the hand stands in front of the
 * strip, not on it.
 *
 * What is recorded is everything the arithmetic needs and nothing else: the
 * 3x3 image-to-plane homography, the 21 landmarks in the plane, and (when
 * the product's policy allows it) the camera focal length, principal point and
 * per-landmark heights the parallax correction used. `recomputePlane` runs
 * the same steps on those recorded values alone. Pure.
 */
import {
  centrePrincipalPoint,
  type Intrinsics,
} from "../../client/geometry/camera-pose";
import {
  applyHomography,
  type Homography,
  type Point2,
} from "../../client/geometry/homography";
import {
  computeCorrectedHandMeasurements,
  correctLandmarksByHandLength,
  measurementsFromSheetMm,
} from "../../client/geometry/measurements";
import {
  LANDMARK_HEIGHTS_MM_VERSION,
  correctLandmarks,
  resolveFocalPx,
  type FocalSource,
  type ResolvedFocal,
} from "../../client/geometry/parallax";
import type { HandMeasurements } from "../contracts/measurement";
import { failureKind } from "./errorkind";

/** The heights of a plane whose landmarks were not lifted off the sheet: 21 zeros. */
const NO_HEIGHTS_MM: readonly number[] = Array<number>(21).fill(0);

export type PlaneMethod = "markers" | "paper-edge" | "strip-markers";

/** How the parallax correction went. Recorded even when no hand was found. */
export interface ParallaxRecord {
  /**
   * True when `landmarksSheetMm` were back-projected at each landmark's own
   * height. False when no correction was possible (`focalSource` "none"),
   * when it failed (`error`), and when there is no hand (no landmarks).
   */
  readonly corrected: boolean;
  readonly focalSource: FocalSource;
  /** The focal length the correction used, in px of the decoded frame; `null` when there was none. */
  readonly focalPx: number | null;
  /** The EXIF-derived focal length offered to the policy before it chose (`null` without EXIF). */
  readonly exifFocalPx: number | null;
  readonly principalPoint: { readonly cx: number; readonly cy: number };
  readonly imageSize: { readonly width: number; readonly height: number };
  /**
   * Which set of landmark heights the build that wrote this record used
   * (`LANDMARK_HEIGHTS_MM_VERSION`). `recomputePlane` never reads it: it
   * works from `heightsMm`, so a log written by an older build (v1: the same
   * 21 millimetres for every photo) is worked out again from the heights it
   * recorded, not from the current version's.
   */
  readonly heightsVersion: string;
  /**
   * The 21 heights above the sheet, in mm, the landmarks were back-projected
   * at. From v2 on they differ from photo to photo (a fixed ratio times that
   * photo's own hand length). All 0 when `corrected` is false: the landmarks
   * were then projected onto the sheet itself.
   */
  readonly heightsMm: readonly number[];
  /**
   * Why the plane could not be turned into mm, when it could not: the error's
   * class name (`RangeError`, ...), never its message, which can quote values.
   */
  readonly error: string | null;
}

export interface PlaneCalibration {
  readonly method: PlaneMethod;
  /** Row-major 3x3, image px to plane mm. */
  readonly homography: readonly (readonly number[])[];
  /** How well the plane's own reference fitted, in mm; `null` where it does not apply. */
  readonly fit: {
    readonly reprojectionErrorMm: number | null;
    readonly edgeFitResidualMm: number | null;
  };
  /** `null` for a strip plane, where no correction is defined. */
  readonly parallax: ParallaxRecord | null;
  /**
   * The 21 hand landmarks in this plane's millimetres, the points the
   * measurements come from: back-projected at their own heights when
   * `parallax.corrected`, otherwise straight through the homography. `null`
   * when no hand was found or the points could not be worked out.
   */
  readonly landmarksSheetMm: readonly Point2[] | null;
}

export interface PlaneInput {
  readonly method: PlaneMethod;
  readonly homography: Homography;
  readonly fit: PlaneCalibration["fit"];
  /** The 21 landmarks in image px, or `null` when no hand was found. */
  readonly landmarksPx: readonly Point2[] | null;
  /** From the photo's EXIF, in px of the decoded frame; `null` without EXIF. */
  readonly exifFocalPx: number | null;
  readonly imageSize: { readonly width: number; readonly height: number };
  /** Set false for a strip plane. */
  readonly parallax: boolean;
}

export interface PlaneResult {
  readonly plane: PlaneCalibration;
  /** `null` when there is no hand, no correction is defined, or a value fell outside the contract's ranges. */
  readonly measurements: HandMeasurements | null;
}

export function homographyToRows(h: Homography): number[][] {
  return h.map((row) => [...row]);
}

/** The recorded rows back as a `Homography`; throws on anything but a finite 3x3. */
export function rowsToHomography(
  rows: readonly (readonly number[])[],
): Homography {
  const ok =
    rows.length === 3 &&
    rows.every(
      (row) => row.length === 3 && row.every((v) => Number.isFinite(v)),
    );
  if (!ok) throw new RangeError("A homography must be a finite 3x3 matrix.");
  return rows.map((row) => [...row]) as unknown as Homography;
}

/**
 * Build a plane record and the measurements it gives. Returns `null` only
 * when the homography itself is not a finite 3x3 matrix (a log cannot hold
 * one).
 */
export function buildPlane(input: PlaneInput): PlaneResult | null {
  const rows = homographyToRows(input.homography);
  try {
    rowsToHomography(rows);
  } catch {
    return null;
  }
  const { homography, landmarksPx, exifFocalPx, imageSize } = input;
  const principalPoint = centrePrincipalPoint(
    imageSize.width,
    imageSize.height,
  );

  let parallax: ParallaxRecord | null = null;
  let points: Point2[] | null = null;
  let measurements: HandMeasurements | null = null;
  let heightsMm: readonly number[] = NO_HEIGHTS_MM;

  if (!input.parallax) {
    if (landmarksPx) {
      try {
        points = landmarksPx.map((p) => applyHomography(homography, p));
      } catch {
        points = null;
      }
    }
  } else {
    let error: string | null = null;
    let resolved: ResolvedFocal = { fPx: null, source: "none" };
    try {
      resolved = resolveFocalPx({ exifFocalPx, homography, principalPoint });
    } catch (err) {
      // A degenerate homography: no focal length, and no points either.
      error = failureKind(err);
    }
    let corrected = false;
    if (landmarksPx && error === null) {
      try {
        if (resolved.fPx === null) {
          points = landmarksPx.map((p) => applyHomography(homography, p));
        } else {
          const intrinsics: Intrinsics = {
            fPx: resolved.fPx,
            ...principalPoint,
          };
          // The same two-pass correction the product's blank-paper function
          // makes, and the heights it used are the ones recorded below.
          const result = correctLandmarksByHandLength(
            landmarksPx,
            homography,
            intrinsics,
          );
          points = result.points;
          heightsMm = result.heightsMm;
          corrected = true;
        }
      } catch (err) {
        points = null;
        error = failureKind(err);
      }
    }
    parallax = {
      corrected,
      focalSource: resolved.source,
      focalPx: resolved.fPx,
      exifFocalPx,
      principalPoint,
      imageSize: { width: imageSize.width, height: imageSize.height },
      heightsVersion: LANDMARK_HEIGHTS_MM_VERSION,
      heightsMm: [...heightsMm],
      error,
    };
    if (landmarksPx && points) {
      // The product's own function decides the measurements, so this record
      // cannot drift from the blank-paper path. A grip pose folds the
      // fingers and can fall outside the contract's ranges: no measurements
      // then, but the points above are still recorded.
      try {
        measurements = computeCorrectedHandMeasurements(
          landmarksPx,
          homography,
          {
            exifFocalPx,
            widthPx: imageSize.width,
            heightPx: imageSize.height,
          },
        ).measurements;
      } catch {
        measurements = null;
      }
    }
  }

  return {
    plane: {
      method: input.method,
      homography: rows,
      fit: input.fit,
      parallax,
      landmarksSheetMm: points,
    },
    measurements,
  };
}

/**
 * Work the plane's points and measurements out again from recorded values
 * only: the landmarks in px, the recorded homography, and the recorded
 * parallax settings (focal length, principal point, heights). Nothing is
 * looked up from the product's current constants, so a log stays
 * reproducible after those change.
 */
export function recomputePlane(
  landmarksPx: readonly Point2[],
  plane: Pick<PlaneCalibration, "homography" | "parallax">,
): { points: Point2[]; measurements: HandMeasurements | null } {
  const homography = rowsToHomography(plane.homography);
  const p = plane.parallax;
  let points: Point2[];
  if (p?.corrected) {
    if (p.focalPx === null) {
      throw new RangeError("A corrected plane must record its focal length.");
    }
    const intrinsics: Intrinsics = {
      fPx: p.focalPx,
      cx: p.principalPoint.cx,
      cy: p.principalPoint.cy,
    };
    points = correctLandmarks(landmarksPx, homography, intrinsics, p.heightsMm);
  } else {
    points = landmarksPx.map((pt) => applyHomography(homography, pt));
  }
  // A strip plane (no parallax record) has no measurements, as `buildPlane`
  // and the README say: the hand stands in front of the strip, not on it.
  if (!p) return { points, measurements: null };
  try {
    return { points, measurements: measurementsFromSheetMm(points) };
  } catch {
    return { points, measurements: null };
  }
}
