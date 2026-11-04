/**
 * v3.4 card reference (2026-11-05, candidate 未拍板): the submission of a
 * card-path scan.
 *
 * The measurements have the paper path's shape and scale (every field of
 * `MEASUREMENT_DEFINITIONS`, parallax-corrected at the nominal focal,
 * `cardHandMeasure.ts`), so the engine reads them the same way.
 *
 * The calibration evidence is the open question (需要 Kirby 決定). The
 * contract (`calibrationEvidenceSchema`, strict) has no card-reference
 * method, the DB column `calibration_method` is a Postgres enum, and this
 * task may not change either. Until Claude/Kirby add one, a card scan is
 * sent as `paper-edge` evidence with `cornersSource: "adjusted"` (the
 * contract then needs no fitted-edge numbers) and `paperSize: "a4"`:
 * accepted by the server unchanged, but MISLABELLED (no sheet was used),
 * so card scans cannot be told apart from adjusted-paper scans in the data.
 * `CARD_EVIDENCE_PLACEHOLDER` marks every place that depends on this; the
 * feature flag keeps the card mode off in production meanwhile.
 *
 * Proposed fix (contract, Claude's): an optional `reference: "id1-card"`
 * (plus `cardFitRmsMm`, `tiltDeg`) on `paperEdgeEvidenceSchema` (jsonb only,
 * no migration), or a new `card` method with an enum migration.
 */
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type HandMeasurements,
  type ScanSubmission,
} from "../../lib/contracts/measurement";

/** True while card scans are sent as placeholder paper-edge evidence (see the file comment). */
export const CARD_EVIDENCE_PLACEHOLDER = true;

/** A card-path scan as a contract-valid submission. Throws what the contract throws. */
export function buildCardSubmission(input: {
  readonly hand: "left" | "right";
  readonly measurements: HandMeasurements;
}): ScanSubmission {
  return scanSubmissionSchema.parse({
    hand: input.hand,
    measurements: input.measurements,
    calibration: {
      method: "paper-edge",
      paperSize: "a4",
      cornersSource: "adjusted",
      parallaxCorrected: true,
      focalSource: "nominal",
    },
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  });
}
