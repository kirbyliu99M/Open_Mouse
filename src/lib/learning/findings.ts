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
import {
  computeSheetLayout,
  type MarkerLayout,
} from "../../client/sheet/layout";
import { computeKitLayout } from "./layout";
import { sheetAMarkers, sheetBMarkers } from "./layoutv2";
import type { ReportFindings } from "./report";
import type { KitV2Sheet } from "./session";

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

/** Fewest sheet markers (16 corners) a kit v2 plane is built from. Sheet B has six; any four of them do. */
export const KIT_V2_MIN_MARKERS = 4;

export interface SheetCorrespondences {
  readonly correspondences: readonly PointCorrespondence[];
  /** Ids of the printed markers that were found (first occurrence each), in layout order. */
  readonly usedIds: readonly number[];
  /** Printed ids not found. */
  readonly missingIds: readonly number[];
}

/**
 * Match detected markers to a printed layout by id: four corner
 * correspondences for each printed marker that was found. Unlike
 * `buildMarkerCorrespondences` (which wants exactly the product sheet's
 * ids 0 to 3), the ids come from `layoutMarkers`, so sheet B's six markers
 * work, and whichever of them were found are used. Markers whose id is not
 * in the layout are ignored, and so is a second marker with an id already
 * seen. Pure.
 */
export function buildSheetCorrespondences(
  detected: readonly DetectedMarker[],
  layoutMarkers: readonly MarkerLayout[],
): SheetCorrespondences {
  const byId = new Map<number, DetectedMarker>();
  for (const marker of detected) {
    if (!byId.has(marker.id)) byId.set(marker.id, marker);
  }
  const correspondences: PointCorrespondence[] = [];
  const usedIds: number[] = [];
  const missingIds: number[] = [];
  for (const printed of layoutMarkers) {
    const found = byId.get(printed.id);
    if (!found) {
      missingIds.push(printed.id);
      continue;
    }
    usedIds.push(printed.id);
    for (let i = 0; i < 4; i++) {
      correspondences.push({
        src: found.corners[i]!,
        dst: printed.corners[i]!,
      });
    }
  }
  return { correspondences, usedIds, missingIds };
}

/**
 * The kit v2 sheet's plane from its printed markers: a homography (image px
 * to sheet mm) with how well the markers fit. Sheet A needs all four of the
 * product sheet's markers; sheet B needs any `KIT_V2_MIN_MARKERS` (four) or
 * more of its six. `null` below that.
 */
export function sheetReference(
  markers: readonly DetectedMarker[],
  sheet: KitV2Sheet,
): NonNullable<ReportFindings["reference"]> | null {
  const layoutMarkers = sheet === "A" ? sheetAMarkers() : sheetBMarkers();
  const { correspondences, usedIds } = buildSheetCorrespondences(
    markers,
    layoutMarkers,
  );
  const needed = sheet === "A" ? layoutMarkers.length : KIT_V2_MIN_MARKERS;
  if (usedIds.length < needed) return null;
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
 * (`evaluatePaperEdgeCalibration`), with the size passed in. It also keeps what
 * the detector saw and what the product's paper gates decided, so a saved
 * record can say why the product would refuse a sheet, not only where its
 * corners were.
 */
export function paperFindings(
  quad: SheetQuadDetection | null,
  paperSize: PaperSize,
): ReportFindings["paper"] {
  if (!quad) return null;
  const evaluation = evaluatePaperEdgeCalibration(quad, paperSize, false);
  const geometry = evaluation.geometry;
  return {
    corners: quad.corners,
    cornersSeen: quad.cornersSeen,
    homography: geometry?.homography ?? null,
    edgeFitResidualMm: geometry?.edgeFitResidualMm ?? null,
    detection: {
      regionFound: quad.paperRegionFound,
      minSideCoverage: quad.minSideCoverage,
      edgeFitResidualPx: quad.edgeFitResidualPx,
      worstSideIndex: quad.worstSideIndex,
      cornersFound: [...quad.cornersFound],
    },
    gates: {
      ok: evaluation.ok,
      errorCodes: evaluation.errors.map((e) => e.code),
      warningCodes: [],
    },
  };
}
