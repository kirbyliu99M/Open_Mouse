/**
 * The pluggable "find the paper's four corners in this frame" seam.
 *
 * Direction change (Kirby, 2026-09-25): the user measures on ANY blank A4
 * (or Letter) sheet — no printed calibration sheet, no ArUco markers, no
 * bank card. The live lock-on corner-dots track the paper's own four
 * corners, found from its edges (like a document-scanner app), not
 * printed fiducials. Contract PR #58 (`contracts-paper-edge`, merged) adds
 * `PAPER_SIZES_MM`, `PAPER_EDGE_LIMITS` and a `method: "paper-edge"`
 * calibration to `src/lib/contracts/measurement.ts` for that pipeline
 * path; `src/client/paper/detect.ts` (PR #59, merged) is the real
 * detector.
 *
 * This module defines the interface the live viewfinder codes against
 * (`SheetQuadSource`) plus two implementations: `createMarkerBasedQuadSource`
 * (today's shipped printed-sheet flow, built on the existing
 * `detectMarkers` — a printed sheet still has markers near its corners)
 * and `createPaperEdgeQuadSource` (wraps the real `detectPaperQuad` in a
 * try/catch, since the live loop calls it up to 8×/s and a detector throw
 * must never crash it). `CameraCapture` picks between them by
 * `calibrationMode`.
 */
import type { Point2 } from "../geometry/homography";
import { detectMarkers, type DetectedMarker } from "../photo/markers";
import { detectPaperQuad, type DetectPaperQuadOptions } from "../paper/detect";
import { SHEET, type PaperSize } from "../../lib/contracts/measurement";
import { buildTrackedQuad, centroid } from "./quad";

export type { PaperSize };

export interface SheetQuadDetection {
  /** The paper's 4 corners (TL, TR, BR, BL), or `null` unless all 4 were found. */
  readonly corners: readonly [Point2, Point2, Point2, Point2] | null;
  readonly cornersSeen: 0 | 1 | 2 | 3 | 4;
  /** Per-corner (TL, TR, BR, BL) lock-on: whether *that specific* corner was found this sample, so the UI can lock brackets on individually rather than all-or-nothing. */
  readonly cornersFound: readonly [boolean, boolean, boolean, boolean];
  /** Per-corner (TL, TR, BR, BL) position when found, `null` when not — same order as `cornersFound`. */
  readonly partialCorners: readonly [
    Point2 | null,
    Point2 | null,
    Point2 | null,
    Point2 | null,
  ];
  /** Smallest fraction of any side's length actually seen, 0-1 (1 when not applicable, as for this temporary adapter). */
  readonly minSideCoverage: number;
  /** Mean distance of detected edge points from their fitted side, in frame px (0 when not applicable). */
  readonly edgeFitResidualPx: number;
}

export type SheetQuadSource = (
  frame: ImageData,
  paperSize: PaperSize,
  /** Passed to the paper detector (a focal length to assume); the marker-based source ignores it. */
  options?: DetectPaperQuadOptions,
) => SheetQuadDetection;

const NO_CORNERS: readonly [boolean, boolean, boolean, boolean] = [
  false,
  false,
  false,
  false,
];
const NO_PARTIAL: readonly [null, null, null, null] = [null, null, null, null];

const NONE: SheetQuadDetection = {
  corners: null,
  cornersSeen: 0,
  cornersFound: NO_CORNERS,
  partialCorners: NO_PARTIAL,
  minSideCoverage: 0,
  edgeFitResidualPx: 0,
};

/**
 * Temporary `SheetQuadSource`: finds the printed sheet's 4 flat-flap ArUco
 * markers (ids 0-3, `markers.ts`'s existing, already-shipped detector) and
 * reports each one's centroid as its corresponding paper corner — marker id
 * 0→TL, 1→TR, 2→BR, 3→BL, `layout.ts`'s own convention, so each bracket
 * locks on individually as its marker is found rather than waiting for all
 * four. `paperSize` is accepted for interface compatibility but ignored —
 * this adapter has no notion of a blank sheet's edges. `detectMarkersImpl`
 * is injectable for unit testing without needing real marker pixel data
 * (matches this app's existing DI convention, e.g. `ScanClient`'s
 * `runPhotoPipelineImpl`).
 */
export function createMarkerBasedQuadSource(
  detectMarkersImpl: (frame: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }) => DetectedMarker[] = detectMarkers,
): SheetQuadSource {
  return (frame) => {
    const detected = detectMarkersImpl(frame);
    const cornerIds = SHEET.flatMarkerIds as readonly [
      number,
      number,
      number,
      number,
    ]; // [TL, TR, BR, BL]
    const byId = new Map<number, DetectedMarker>();
    for (const marker of detected) {
      if (cornerIds.includes(marker.id) && !byId.has(marker.id)) {
        byId.set(marker.id, marker);
      }
    }

    const cornersFound = cornerIds.map((id) => byId.has(id)) as [
      boolean,
      boolean,
      boolean,
      boolean,
    ];
    const partialCorners = cornerIds.map((id) => {
      const marker = byId.get(id);
      return marker ? centroid(marker.corners) : null;
    }) as [Point2 | null, Point2 | null, Point2 | null, Point2 | null];
    const cornersSeen = cornersFound.filter(Boolean).length as
      0 | 1 | 2 | 3 | 4;

    if (cornersSeen < 4) {
      return { ...NONE, cornersSeen, cornersFound, partialCorners };
    }
    const quad = buildTrackedQuad([...byId.values()]);
    if (!quad) return { ...NONE, cornersSeen, cornersFound, partialCorners };
    return {
      corners: [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft],
      cornersSeen,
      cornersFound,
      partialCorners,
      minSideCoverage: 1,
      edgeFitResidualPx: 0,
    };
  };
}

/**
 * The real `SheetQuadSource` for paper-edge mode: `detectPaperQuad`
 * (src/client/paper/detect.ts) finds a blank A4/Letter sheet's own 4
 * corners from its edges — no markers, no card. Its own
 * `SheetQuadDetection` shape already matches this module's field-for-field
 * (corners/cornersSeen/cornersFound/partialCorners/minSideCoverage/
 * edgeFitResidualPx), so no conversion is needed, only a safety net: the
 * detector is still being hardened by its own author (orientation,
 * aspect-ratio strictness) and can throw on degenerate input (documented in
 * its own source as a deliberate bail-out, not a bug) — the live loop calls
 * this up to 8 times a second and must never crash from it, so every call
 * is wrapped and any throw reports "no corners found" instead.
 */
export function createPaperEdgeQuadSource(
  detectPaperQuadImpl: (
    frame: ImageData,
    paperSize: PaperSize,
    options?: DetectPaperQuadOptions,
  ) => SheetQuadDetection = detectPaperQuad,
): SheetQuadSource {
  return (frame, paperSize, options) => {
    try {
      return detectPaperQuadImpl(frame, paperSize, options);
    } catch {
      return NONE;
    }
  };
}
