/**
 * The pure paper-edge calibration chain: a `detectPaperQuad` result +
 * paper size → homography → the worst side's residual, converted to mm
 * along ITS OWN normal direction → the paper-specific gates → the
 * `paperEdgeEvidenceSchema`-validated calibration object
 * `assemblePaperEdgeSubmission` embeds in the submission.
 *
 * Extracted out of `src/client/photo/pipeline.ts`'s `runPaperEdgePipeline`
 * (2026-09-25 PR #59 review): that function is itself impure (Canvas,
 * hand detection, EXIF reads) and deliberately untested by Vitest — its
 * own header says so, and it's exercised by e2e only — which meant this
 * specific chain (px residual → mm via `localScaleMmPerPxAlongNormal` →
 * coverage/curl gates → schema-validated calibration) had no direct test
 * at all (hard rule 3: "critical-path logic is pure and tested"). This
 * module is that pure slice, on its own; `pipeline.ts` now calls
 * `computePaperEdgeGeometry` for its homography/residual step instead of
 * repeating the same 10 lines inline.
 */
import {
  buildPaperHomography,
  localScaleMmPerPx,
  localScaleMmPerPxAlongNormal,
  quadCentroid,
} from "./homography";
import type { SheetQuadDetection } from "./detect";
import { checkPaperEdgeGatesOnly, type GateFailure } from "../photo/gates";
import {
  paperEdgeEvidenceSchema,
  type PaperCornerSource,
  type PaperEdgeEvidence,
  type PaperSize,
} from "../../lib/contracts/measurement";
import type { Homography } from "../geometry/homography";
import { checkManualQuad, type Quad4 } from "./manualQuad";

export interface PaperEdgeGeometry {
  readonly homography: Homography;
  /** The worst fitted side's mean residual, converted to mm along THAT side's own normal direction. */
  readonly edgeFitResidualMm: number;
}

/**
 * Pure: build the homography from the detected corners and convert
 * `quad.edgeFitResidualPx` to mm along the worst side's own normal
 * direction (not a generic centroid-based average — 2026-09-25 PR #59
 * review nit; see `homography.ts#localScaleMmPerPxAlongNormal`'s own doc
 * comment for why that distinction matters). Falls back to the generic
 * centroid scale only if, oddly, no side contributed the residual —
 * shouldn't happen once `quad.corners` is non-null, since that already
 * requires all 4 sides to have been fit.
 *
 * Throws if `quad.corners` is `null` — call only after confirming the
 * paper was fully found (mirrors `computeHandMeasurements`'s own
 * precondition-throw convention elsewhere in this app).
 */
export function computePaperEdgeGeometry(
  quad: SheetQuadDetection,
  paperSize: PaperSize,
): PaperEdgeGeometry {
  if (!quad.corners) {
    throw new RangeError(
      "computePaperEdgeGeometry: quad.corners is null — call only once detectPaperQuad found all 4 corners.",
    );
  }
  const homography = buildPaperHomography(quad.corners, paperSize);
  const scaleMmPerPx =
    quad.worstSideIndex !== null
      ? localScaleMmPerPxAlongNormal(
          homography,
          quad.corners[quad.worstSideIndex],
          quad.corners[(quad.worstSideIndex + 1) % 4],
        )
      : localScaleMmPerPx(homography, quadCentroid(quad.corners));
  return {
    homography,
    edgeFitResidualMm: quad.edgeFitResidualPx * scaleMmPerPx,
  };
}

export interface PaperEdgeCalibrationResult {
  readonly ok: boolean;
  readonly errors: readonly GateFailure[];
  /** `null` when any paper gate failed. */
  readonly calibration: PaperEdgeEvidence | null;
  /** `null` only when `quad.corners` was itself `null` (fewer than 4 corners found) — there's no homography to build in that case. */
  readonly geometry: PaperEdgeGeometry | null;
}

/**
 * The full pure chain, in one call: quad + paperSize → geometry (above)
 * → the 4 paper-specific gates (`checkPaperEdgeGatesOnly` —
 * found / all corners seen / edge coverage / curled; NOT the hand gates,
 * which need actual hand-detection data the pipeline only has later) →
 * the validated calibration object. `paperEdgeEvidenceSchema`'s fields
 * (method, paperSize, edgeFitResidualMm, minSideCoverage,
 * parallaxCorrected) never depend on hand data at all — `parallaxCorrected`
 * is a parameter here because it's the one piece genuinely decided
 * elsewhere (whether EXIF or a homography-focal estimate was usable), not
 * derivable from the quad.
 *
 * Unlike `computePaperEdgeGeometry` alone, this never throws for a
 * `quad.corners === null` input — the "all 4 corners found" gate is one
 * of the things it checks, so a caller can hand it ANY `detectPaperQuad`
 * result directly rather than pre-filtering. (`pipeline.ts` still
 * short-circuits on `!quad.corners` itself, before even reaching this
 * function, purely to pick between two differently-worded retake
 * messages — see `checkPaperFound` vs `checkPaperCornersSeen`.)
 */
export function evaluatePaperEdgeCalibration(
  quad: SheetQuadDetection,
  paperSize: PaperSize,
  parallaxCorrected: boolean,
): PaperEdgeCalibrationResult {
  const geometry = quad.corners
    ? computePaperEdgeGeometry(quad, paperSize)
    : null;
  const { errors } = checkPaperEdgeGatesOnly({
    paperRegionFound: quad.paperRegionFound,
    cornersSeen: quad.cornersSeen,
    minSideCoverage: quad.minSideCoverage,
    // No geometry (no corners) means no meaningful curl residual either —
    // 0 so that check trivially passes, since the corners-seen check
    // above already fails this quad regardless.
    edgeFitResidualMm: geometry?.edgeFitResidualMm ?? 0,
  });
  if (errors.length > 0 || !geometry) {
    return { ok: false, errors, calibration: null, geometry };
  }
  const calibration = paperEdgeEvidenceSchema.parse({
    method: "paper-edge",
    paperSize,
    edgeFitResidualMm: geometry.edgeFitResidualMm,
    minSideCoverage: quad.minSideCoverage,
    parallaxCorrected,
  });
  return { ok: true, errors: [], calibration, geometry };
}

/**
 * What a placed frame's calibration needs from the pipeline: the four
 * corners (already labelled by `orientManualQuad`, in the analysed photo's
 * pixels), where they came from, and the analysed photo's size.
 */
export interface ManualPaperCalibrationInput {
  readonly corners: Quad4;
  readonly cornersSource: Exclude<PaperCornerSource, "auto">;
  readonly paperSize: PaperSize;
  readonly image: { readonly width: number; readonly height: number };
  readonly parallaxCorrected: boolean;
}

/** The result shape `finishPaperEdge` reads: a placed frame has a homography but no fitted edge. */
export interface ManualPaperCalibrationResult {
  readonly ok: boolean;
  readonly errors: readonly GateFailure[];
  readonly calibration: PaperEdgeEvidence | null;
  readonly geometry: { readonly homography: Homography } | null;
}

/**
 * The placed-frame counterpart of `evaluatePaperEdgeCalibration` (V3.2 F2,
 * candidate). The homography is `buildPaperHomography`, the same as for the
 * detector's corners. The coverage and curl gates do not apply (there is no
 * fitted edge to measure), so the calibration leaves `edgeFitResidualMm` and
 * `minSideCoverage` out rather than claim a check that did not happen; what
 * is checked instead is `checkManualQuad` (the screen checks it too, before
 * it lets the frame be used). A frame that fails it is reported as a hidden
 * corner, the failure that offers the adjustment again.
 */
export function evaluateManualPaperCalibration(
  input: ManualPaperCalibrationInput,
): ManualPaperCalibrationResult {
  const check = checkManualQuad(input.corners, input.image);
  if (!check.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "PAPER_CORNER_HIDDEN",
          message:
            "The frame you placed can't be used — drag its four corners onto the paper's corners, or retake the photo.",
        },
      ],
      calibration: null,
      geometry: null,
    };
  }
  const homography = buildPaperHomography(input.corners, input.paperSize);
  const calibration = paperEdgeEvidenceSchema.parse({
    method: "paper-edge",
    paperSize: input.paperSize,
    cornersSource: input.cornersSource,
    parallaxCorrected: input.parallaxCorrected,
  });
  return { ok: true, errors: [], calibration, geometry: { homography } };
}
