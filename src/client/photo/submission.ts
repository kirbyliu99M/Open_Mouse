/**
 * Assemble a validated `ScanSubmission` (src/lib/contracts/measurement.ts)
 * from the pipeline's intermediate results. Pure — no network call: issue
 * #10 scopes the actual POST to a separate (backend) task, so this module's
 * job ends at a validated object. `parallaxCorrected` is hardcoded `false`
 * (the side photo isn't built yet; see the contract's own comment).
 */
import {
  printedSheetEvidenceSchema,
  paperEdgeEvidenceSchema,
  userLengthEvidenceSchema,
  scanSubmissionSchema,
  MEASUREMENT_MODEL_VERSION,
  type ScanSubmission,
  type HandMeasurements,
  type PrintedSheetEvidence,
  type PaperEdgeEvidence,
  type PaperSize,
  type UserLengthEvidence,
} from "../../lib/contracts/measurement";

export interface AssembleScanSubmissionInput {
  readonly hand: "left" | "right";
  readonly gripStyleStated?: "palm" | "claw" | "fingertip";
  readonly measurements: HandMeasurements;
  readonly markerIds: readonly number[];
  readonly reprojectionErrorMm: number;
  readonly cardScaleRatio: number;
}

/**
 * Throws a Zod error (via `scanSubmissionSchema.parse`) if the assembled
 * object doesn't satisfy the contract — deliberately loud, since that
 * schema is the only thing standing between this browser and a server that
 * trusts the numbers it receives.
 */
export function assembleScanSubmission(
  input: AssembleScanSubmissionInput,
): ScanSubmission & { calibration: PrintedSheetEvidence } {
  const calibration: PrintedSheetEvidence = {
    markerIds: [...input.markerIds].sort((a, b) => a - b),
    reprojectionErrorMm: input.reprojectionErrorMm,
    cardScaleRatio: input.cardScaleRatio,
    parallaxCorrected: false,
  };

  const submission = {
    hand: input.hand,
    measurements: input.measurements,
    calibration,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
    ...(input.gripStyleStated !== undefined
      ? { gripStyleStated: input.gripStyleStated }
      : {}),
  };

  // Validate the whole body, then keep the narrower printed-sheet type this
  // builder always produces.
  const parsed = scanSubmissionSchema.parse(submission);
  return {
    ...parsed,
    calibration: printedSheetEvidenceSchema.parse(parsed.calibration),
  };
}

export interface AssemblePaperEdgeSubmissionInput {
  readonly hand: "left" | "right";
  readonly gripStyleStated?: "palm" | "claw" | "fingertip";
  readonly measurements: HandMeasurements;
  readonly paperSize: PaperSize;
  /** `detectPaperQuad`'s residual, already converted to sheet mm (see `src/client/paper/homography.ts#localScaleMmPerPx`). */
  readonly edgeFitResidualMm: number;
  /** `detectPaperQuad`'s coverage metric, 0–1. */
  readonly minSideCoverage: number;
  /** Whether parallax correction actually ran (`computeCorrectedHandMeasurements`'s own flag) — unlike the printed-sheet builder, this is NOT hardcoded, since the paper-edge path always attempts it. */
  readonly parallaxCorrected: boolean;
}

/**
 * The paper-edge counterpart to `assembleScanSubmission`: same contract
 * (`scanSubmissionSchema`), a different calibration shape
 * (`paperEdgeEvidenceSchema`) — no marker ids or card scale, since a
 * blank sheet has neither.
 */
export function assemblePaperEdgeSubmission(
  input: AssemblePaperEdgeSubmissionInput,
): ScanSubmission & { calibration: PaperEdgeEvidence } {
  const calibration: PaperEdgeEvidence = {
    method: "paper-edge",
    paperSize: input.paperSize,
    edgeFitResidualMm: input.edgeFitResidualMm,
    minSideCoverage: input.minSideCoverage,
    parallaxCorrected: input.parallaxCorrected,
  };

  const submission = {
    hand: input.hand,
    measurements: input.measurements,
    calibration,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
    ...(input.gripStyleStated !== undefined
      ? { gripStyleStated: input.gripStyleStated }
      : {}),
  };

  const parsed = scanSubmissionSchema.parse(submission);
  return {
    ...parsed,
    calibration: paperEdgeEvidenceSchema.parse(parsed.calibration),
  };
}

export function assembleUserLengthSubmission(input: {
  readonly hand: "left" | "right";
  readonly gripStyleStated?: "palm" | "claw" | "fingertip";
  readonly measurements: HandMeasurements;
  readonly handLengthMm: number;
}): ScanSubmission & { calibration: UserLengthEvidence } {
  const calibration: UserLengthEvidence = {
    method: "user-length",
    referenceMeasurement: "handLengthMm",
    referenceMm: input.handLengthMm,
    parallaxCorrected: false,
  };
  const parsed = scanSubmissionSchema.parse({
    hand: input.hand,
    measurements: input.measurements,
    calibration,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
    ...(input.gripStyleStated !== undefined
      ? { gripStyleStated: input.gripStyleStated }
      : {}),
  });
  return {
    ...parsed,
    calibration: userLengthEvidenceSchema.parse(parsed.calibration),
  };
}
