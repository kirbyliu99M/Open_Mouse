/**
 * v3.4 card reference (2026-11-05, candidate 未拍板): the submission of a
 * card-path scan, `card-edge` evidence (`cardEdgeEvidenceSchema`, Kirby OK
 * 2026-11-05). The measurements have the paper path's shape and scale
 * (cardHandMeasure.ts), parallax-corrected at the nominal focal.
 */
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type CardEdgeEvidence,
  type HandMeasurements,
  type ScanSubmission,
} from "../../lib/contracts/measurement";
import type { Point2 } from "../geometry/homography";
import type { CardSizeMm } from "./detect/cardMeasure";

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The detector's worst side residual (px) in mm at the card's own scale:
 * the card's true long side over its mean long side in the image.
 * `null` for a degenerate quad.
 */
export function cardFitMm(
  worstResidualPx: number,
  corners: readonly Point2[],
  cardSize: CardSizeMm,
): number | null {
  if (corners.length !== 4 || !Number.isFinite(worstResidualPx)) return null;
  const a = (dist(corners[0], corners[1]) + dist(corners[2], corners[3])) / 2;
  const b = (dist(corners[1], corners[2]) + dist(corners[3], corners[0])) / 2;
  const longPx = Math.max(a, b);
  if (!(longPx > 0)) return null;
  return (Math.max(0, worstResidualPx) * cardSize.longMm) / longPx;
}

/** A card-path scan as a contract-valid submission. Throws what the contract throws. */
export function buildCardSubmission(input: {
  readonly hand: "left" | "right";
  readonly measurements: HandMeasurements;
  readonly cardSize: CardSizeMm;
  readonly searchPass: "slot" | "hand-side";
  readonly cardFitRmsMm: number;
}): ScanSubmission {
  const calibration: CardEdgeEvidence = {
    method: "card-edge",
    cardSizeMm: {
      longMm: input.cardSize.longMm,
      shortMm: input.cardSize.shortMm,
    },
    searchPass: input.searchPass,
    cardFitRmsMm: input.cardFitRmsMm,
    parallaxCorrected: true,
    focalSource: "nominal",
  };
  return scanSubmissionSchema.parse({
    hand: input.hand,
    measurements: input.measurements,
    calibration,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  });
}
