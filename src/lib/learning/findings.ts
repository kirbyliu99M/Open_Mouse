/**
 * The pure steps between what the detectors return and what
 * `assembleLearningReport` takes: the printed-marker homography, the strip
 * homography of a side page, and the paper-edge homography for a given sheet
 * size. Split out of `src/client/learning/analyse.ts` so a synthetic scene can
 * drive them (the detectors themselves need a browser).
 */
import type { PaperSize } from "../contracts/measurement";
import { SHEET } from "../contracts/measurement";
import { evaluatePaperEdgeCalibration } from "../../client/paper/calibration";
import type { SheetQuadDetection } from "../../client/paper/detect";
import {
  estimateHomography,
  reprojectionErrorMm as computeReprojectionErrorMm,
  type Homography,
  type PointCorrespondence,
} from "../../client/geometry/homography";
import {
  buildMarkerCorrespondences,
  type DetectedMarker,
} from "../../client/photo/markers";
import { computeSheetLayout } from "../../client/sheet/layout";
import { computeKitLayout } from "./layout";
import type { ReportFindings } from "./report";

/**
 * The flat page's four corner markers as a homography (image px to sheet
 * mm), with how well they fit; `null` unless all four were found.
 */
export function markerReference(
  markers: readonly DetectedMarker[],
): NonNullable<ReportFindings["reference"]> | null {
  const { correspondences, missingIds } = buildMarkerCorrespondences(
    markers,
    computeSheetLayout(),
  );
  if (
    missingIds.length > 0 ||
    correspondences.length < SHEET.flatMarkerIds.length * 4
  ) {
    return null;
  }
  const homography = estimateHomography(correspondences);
  return {
    method: "markers",
    homography,
    reprojectionErrorMm: computeReprojectionErrorMm(
      homography,
      correspondences,
    ),
  };
}

/** Side-page homography from the two strip markers (8 corners); `null` unless both were found. */
export function sideHomography(
  markers: readonly DetectedMarker[],
): Homography | null {
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

export function stripReference(
  markers: readonly DetectedMarker[],
): NonNullable<ReportFindings["reference"]> | null {
  const homography = sideHomography(markers);
  return homography
    ? { method: "strip-markers", homography, reprojectionErrorMm: null }
    : null;
}

/**
 * The paper-edge plane for a detected quad and the sheet size the page is
 * printed on. The same chain the product's blank-paper path runs
 * (`evaluatePaperEdgeCalibration`), with the size passed in.
 */
export function paperFindings(
  quad: SheetQuadDetection | null,
  paperSize: PaperSize,
): ReportFindings["paper"] {
  if (!quad) return null;
  const geometry = quad.corners
    ? evaluatePaperEdgeCalibration(quad, paperSize, false).geometry
    : null;
  return {
    corners: quad.corners,
    cornersSeen: quad.cornersSeen,
    homography: geometry?.homography ?? null,
    edgeFitResidualMm: geometry?.edgeFitResidualMm ?? null,
  };
}
