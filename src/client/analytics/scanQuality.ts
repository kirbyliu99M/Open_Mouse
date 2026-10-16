/**
 * The `scan_quality` event's properties, from what the pipeline measured about
 * the photo (2026-10-16, candidate). Pure: it reads a `PipelineDiagnostics` and
 * returns enums and one boolean, never a number. The exact Laplacian variance,
 * the focal length in px, the photo's size and the edge-fit distance stay in
 * the browser; only the bucket each falls in leaves it (hard rule 5, and the
 * contract's list of what is never sent).
 *
 * A value that is missing, not finite or negative makes the whole mapping
 * `null`: the caller sends nothing rather than a guessed bucket. The cut-offs
 * are the contract's candidates (src/lib/contracts/analytics.ts).
 *
 * `priorEffect` is the one bucket of a difference between two ways of
 * correcting the photo (shadow mode, src/client/geometry/nominalFocalShadow.ts):
 * the millimetre delta stays on the device, in the diagnostics, and only its
 * bucket leaves.
 */
import type { AnalyticsEventProps, ScanFlow } from "@/lib/contracts/analytics";
import type { AttemptMethod } from "../camera/attemptLog";
import { GATE_THRESHOLDS } from "../photo/gates";
import type { PipelineDiagnostics } from "../photo/diagnostics";

type ScanQualityProps = AnalyticsEventProps<"scan_quality">;

/** Sharpness: the LOW_SHARPNESS gate, and twice it where "near" ends. */
const SHARPNESS_GATE = GATE_THRESHOLDS.minLaplacianVariance;
const SHARPNESS_CLEAR_FROM = SHARPNESS_GATE * 2;

/** Resolution: the decoded photo's long edge in px. */
export const RESOLUTION_MID_FROM_PX = 1280;
export const RESOLUTION_HIGH_FROM_PX = 1920;

/** Edge fit: the worst side's mean edge-fit distance in mm. */
export const EDGE_FIT_MID_FROM_MM = 0.5;
export const EDGE_FIT_HIGH_FROM_MM = 1;

/**
 * Paper skew: the largest corner-angle deviation of the sheet in degrees
 * (`computeQuadSkew`). The auto-shutter's own limit is 12 (camera/constants.ts)
 * and is a different thing, left as it is.
 */
export const PAPER_SKEW_MID_FROM_DEG = 3;
export const PAPER_SKEW_HIGH_FROM_DEG = 6;
export const PAPER_SKEW_TOP_FROM_DEG = 9;

/**
 * Prior effect (shadow mode): the hand length with a nominal focal length
 * minus the one the person was shown, in mm. A candidate cut-off pair.
 */
export const PRIOR_EFFECT_NEAR_MM = 2;
export const PRIOR_EFFECT_FAR_MM = 5;

/** A finite number of at least 0; anything else is not a measurement. */
function nonNegative(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export function sharpnessBucket(
  laplacianVariance: number | null | undefined,
): ScanQualityProps["sharpness"] | null {
  if (!nonNegative(laplacianVariance)) return null;
  if (laplacianVariance < SHARPNESS_GATE) return "below_gate";
  if (laplacianVariance < SHARPNESS_CLEAR_FROM) return "near_gate";
  return "clear";
}

export function resolutionBucket(
  decoded:
    { readonly width: number; readonly height: number } | null | undefined,
): ScanQualityProps["resolution"] | null {
  if (!decoded) return null;
  const { width, height } = decoded;
  // A real photo has a positive size on both edges.
  if (!nonNegative(width) || !nonNegative(height)) return null;
  if (width === 0 || height === 0) return null;
  const longEdge = Math.max(width, height);
  if (longEdge < RESOLUTION_MID_FROM_PX) return "under_1280";
  if (longEdge < RESOLUTION_HIGH_FROM_PX) return "from_1280_to_1919";
  return "from_1920";
}

export function edgeFitBucket(
  edgeFitResidualMm: number | null | undefined,
): ScanQualityProps["edgeFit"] | null {
  if (!nonNegative(edgeFitResidualMm)) return null;
  if (edgeFitResidualMm < EDGE_FIT_MID_FROM_MM) return "under_0_5_mm";
  if (edgeFitResidualMm < EDGE_FIT_HIGH_FROM_MM) return "from_0_5_to_1_mm";
  return "from_1_mm";
}

/**
 * How straight on the shot was, from the sheet's largest corner-angle
 * deviation in degrees: under 3, 3 to under 6, 6 to under 9, 9 and over. A
 * negative or non-finite value (an angle cannot be either) is `null`.
 */
export function paperSkewBucket(
  maxAngleDeviationDeg: number | null | undefined,
): ScanQualityProps["paperSkew"] | null {
  if (!nonNegative(maxAngleDeviationDeg)) return null;
  if (maxAngleDeviationDeg < PAPER_SKEW_MID_FROM_DEG) return "under_3";
  if (maxAngleDeviationDeg < PAPER_SKEW_HIGH_FROM_DEG) return "from_3_to_6";
  if (maxAngleDeviationDeg < PAPER_SKEW_TOP_FROM_DEG) return "from_6_to_9";
  return "from_9";
}

/**
 * How far the nominal-focal shadow hand length is from the shown one, in four
 * wide steps. `deltaMm` is shadow minus shown: at or below -5 is
 * `lower_5_plus`, above -5 up to -2 `lower_2_to_5`, between -2 and 2 (neither
 * included) `within_2`, 2 and over `higher_2_plus`. Not a finite number is
 * `null`: the shadow could not be worked out.
 */
export function priorEffectBucket(
  deltaMm: number | null | undefined,
): ScanQualityProps["priorEffect"] | null {
  if (typeof deltaMm !== "number" || !Number.isFinite(deltaMm)) return null;
  if (deltaMm <= -PRIOR_EFFECT_FAR_MM) return "lower_5_plus";
  if (deltaMm <= -PRIOR_EFFECT_NEAR_MM) return "lower_2_to_5";
  if (deltaMm < PRIOR_EFFECT_NEAR_MM) return "within_2";
  return "higher_2_plus";
}

/**
 * The `paperSkew` a rejected scan may carry: present only when the pipeline
 * found the sheet's four corners (its diagnostics hold the angle). `undefined`
 * otherwise, and the caller leaves the property out.
 */
export function rejectedPaperSkew(
  diagnostics: PipelineDiagnostics | null | undefined,
): ScanQualityProps["paperSkew"] | undefined {
  return paperSkewBucket(diagnostics?.paper?.maxAngleDeviationDeg) ?? undefined;
}

export interface ScanQualityInput {
  readonly flow: ScanFlow;
  readonly attempt: number;
  /** How the picture was captured; `null` when that was not recorded. */
  readonly method: AttemptMethod | null | undefined;
  readonly diagnostics: PipelineDiagnostics | null | undefined;
}

/**
 * The `scan_quality` properties for one measured photo, or `null` when any
 * needed value is missing (no diagnostics, no focal record, no sheet fit, an
 * unknown capture method). The caller sends nothing for `null`.
 */
export function buildScanQuality(
  input: ScanQualityInput,
): ScanQualityProps | null {
  const { flow, attempt, method, diagnostics } = input;
  if (!diagnostics || !method) return null;
  const focal = diagnostics.focal;
  if (!focal) return null;
  if (typeof diagnostics.parallaxCorrected !== "boolean") return null;
  const sharpness = sharpnessBucket(diagnostics.laplacianVariance);
  const resolution = resolutionBucket(diagnostics.decoded);
  const edgeFit = edgeFitBucket(diagnostics.paper?.edgeFitResidualMm);
  const paperSkew = paperSkewBucket(diagnostics.paper?.maxAngleDeviationDeg);
  const priorEffect = priorEffectBucket(
    diagnostics.shadowPrior?.handLengthDeltaMm,
  );
  if (!sharpness || !resolution || !edgeFit || !paperSkew || !priorEffect) {
    return null;
  }
  return {
    flow,
    attempt,
    method,
    focalSource: focal.source,
    parallaxCorrected: diagnostics.parallaxCorrected,
    sharpness,
    resolution,
    edgeFit,
    paperSkew,
    priorEffect,
  };
}
