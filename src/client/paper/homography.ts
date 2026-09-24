/**
 * Image-px → sheet-mm homography for the paper-edge calibration path:
 * the 4 detected paper corners (`detect.ts`) map directly to the paper's
 * known physical size (`PAPER_SIZES_MM` — duplicated in `detect.ts` as
 * `PAPER_ASPECT`; a unit test keeps the two paper-size tables in sync)
 * instead of 16 ArUco marker corners. Same underlying DLT solver as the
 * printed sheet (`src/client/geometry/homography.ts`), just fed 4
 * correspondences instead of 16.
 */
import {
  applyHomography,
  estimateHomography,
  type Homography,
  type Point2,
  type PointCorrespondence,
} from "../geometry/homography";
import type { PaperSize } from "./detect";

/** Mirrors `PAPER_SIZES_MM` in `src/lib/contracts/measurement.ts`. */
export const PAPER_SIZES_MM: Record<
  PaperSize,
  { width: number; height: number }
> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

/**
 * Build the homography from the paper's 4 detected corners (TL, TR, BR,
 * BL, image px — `detect.ts`'s ordering) to sheet mm, with the same
 * (0,0) top-left / x-right / y-down convention every other homography in
 * this app uses.
 */
export function buildPaperHomography(
  corners: readonly [Point2, Point2, Point2, Point2],
  paperSize: PaperSize,
): Homography {
  const { width, height } = PAPER_SIZES_MM[paperSize];
  const dst: readonly Point2[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const correspondences: PointCorrespondence[] = corners.map((src, i) => ({
    src,
    dst: dst[i],
  }));
  return estimateHomography(correspondences);
}

/**
 * Local mm-per-px scale of `homography` near `atPx`, via a tiny finite
 * difference along each image axis. The homography is projective (not
 * affine), so this is only exact in the limit — but it's exactly what's
 * needed to turn a small pixel residual (a few px) into the millimetre
 * figure `paperEdgeEvidenceSchema.edgeFitResidualMm` records, and the
 * residual itself is small enough that the local-linear approximation
 * error is negligible next to it.
 */
export function localScaleMmPerPx(
  homography: Homography,
  atPx: Point2,
  deltaPx = 1,
): number {
  const centre = applyHomography(homography, atPx);
  const dx = applyHomography(homography, { x: atPx.x + deltaPx, y: atPx.y });
  const dy = applyHomography(homography, { x: atPx.x, y: atPx.y + deltaPx });
  const scaleX = Math.hypot(dx.x - centre.x, dx.y - centre.y) / deltaPx;
  const scaleY = Math.hypot(dy.x - centre.x, dy.y - centre.y) / deltaPx;
  return (scaleX + scaleY) / 2;
}

/** Centroid of the 4 corners — the natural point to evaluate `localScaleMmPerPx` at. */
export function quadCentroid(
  corners: readonly [Point2, Point2, Point2, Point2],
): Point2 {
  let x = 0;
  let y = 0;
  for (const c of corners) {
    x += c.x;
    y += c.y;
  }
  return { x: x / 4, y: y / 4 };
}
