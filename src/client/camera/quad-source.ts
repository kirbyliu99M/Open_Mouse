/**
 * The pluggable "find the paper's four corners in this frame" seam.
 *
 * Direction change (Kirby, 2026-09-25): the user measures on ANY blank A4
 * (or Letter) sheet — no printed calibration sheet, no ArUco markers, no
 * bank card. The live lock-on brackets track the paper's own four corners,
 * found from its edges (like a document-scanner app), not printed
 * fiducials. Contract PR #58 (branch `contracts-paper-edge`, not yet
 * merged into this worktree) adds `PAPER_SIZES_MM`, `PAPER_EDGE_LIMITS` and
 * a `method: "paper-edge"` calibration to `src/lib/contracts/
 * measurement.ts` for that pipeline path.
 *
 * A separate builder owns writing the real paper-edge detector and wiring
 * it into `runPhotoPipeline`. To avoid colliding with that work, this
 * module only defines the interface the live viewfinder codes against
 * (`SheetQuadSource`) plus a temporary default implementation
 * (`createMarkerBasedQuadSource`) built on the *existing*, already-shipped
 * `detectMarkers` — a printed sheet still has markers near its corners, so
 * this keeps the live loop (and this task's e2e tests) working today. Swap
 * the default passed to `CameraCapture` for the real paper-edge detector
 * once it lands; nothing else in this file (or the component) needs to
 * change — that's the point of the seam.
 */
import type { Point2 } from "../geometry/homography";
import { detectMarkers, type DetectedMarker } from "../photo/markers";
import { SHEET } from "../../lib/contracts/measurement";
import { buildTrackedQuad } from "./quad";

/** Mirrors (not yet merged) src/lib/contracts/measurement.ts's PaperSize. */
export type PaperSize = "a4" | "letter";

export interface SheetQuadDetection {
  /** The paper's 4 corners (TL, TR, BR, BL), or `null` unless all 4 were found. */
  readonly corners: readonly [Point2, Point2, Point2, Point2] | null;
  readonly cornersSeen: 0 | 1 | 2 | 3 | 4;
  /** Smallest fraction of any side's length actually seen, 0-1 (1 when not applicable, as for this temporary adapter). */
  readonly minSideCoverage: number;
  /** Mean distance of detected edge points from their fitted side, in frame px (0 when not applicable). */
  readonly edgeFitResidualPx: number;
}

export type SheetQuadSource = (
  frame: ImageData,
  paperSize: PaperSize,
) => SheetQuadDetection;

const NONE: SheetQuadDetection = {
  corners: null,
  cornersSeen: 0,
  minSideCoverage: 0,
  edgeFitResidualPx: 0,
};

/**
 * Temporary `SheetQuadSource`: finds the printed sheet's 4 flat-flap ArUco
 * markers (ids 0-3, `markers.ts`'s existing, already-shipped detector) and
 * reports their centroids as the "paper corners". `paperSize` is accepted
 * for interface compatibility but ignored — this adapter has no notion of
 * a blank sheet's edges. `detectMarkersImpl` is injectable for unit
 * testing without needing real marker pixel data (matches this app's
 * existing DI convention, e.g. `ScanClient`'s `runPhotoPipelineImpl`).
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
    const flatIds = new Set<number>(SHEET.flatMarkerIds as readonly number[]);
    const seen = new Map<number, DetectedMarker>();
    for (const marker of detected) {
      if (flatIds.has(marker.id) && !seen.has(marker.id)) {
        seen.set(marker.id, marker);
      }
    }
    const cornersSeen = Math.min(seen.size, 4) as 0 | 1 | 2 | 3 | 4;
    if (cornersSeen < 4) {
      return { ...NONE, cornersSeen };
    }
    const quad = buildTrackedQuad([...seen.values()]);
    if (!quad) return { ...NONE, cornersSeen };
    return {
      corners: [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft],
      cornersSeen,
      minSideCoverage: 1,
      edgeFitResidualPx: 0,
    };
  };
}
