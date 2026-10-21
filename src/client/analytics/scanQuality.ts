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
 * `paperCoverage`, `handPose` and `liveWait` (2026-10-19, candidate, shadow
 * mode) are likewise grades only: the sheet's least-seen side in three steps,
 * whether the fingers look laid flat in three (`assessHandFlatness`, never the
 * ratios behind it), and how long the live preview held the sheet before the
 * shot in four. Nothing is refused on any of them.
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
import { issueCodes } from "./props";

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
 * Paper aspect (2026-10-17, candidate): the sheet's observed width over height
 * is compared with the supported papers' true ones (A4 210 x 297 mm, Letter
 * 215.9 x 279.4 mm; the short side over the long) and the nearer one's
 * relative deviation is bucketed. A sheet seen flat and straight on reads
 * within a fraction of a percent; in Kirby's own scans nine ordinary photos
 * sat within 0.6 % and the one that read 26 mm short sat 6.3 % off. The
 * cut-offs are candidates, not a gate: nothing is refused on them.
 */
export const PAPER_ASPECT_A4 = 210 / 297;
export const PAPER_ASPECT_LETTER = 215.9 / 279.4;
export const PAPER_ASPECT_MID_FROM = 0.02;
export const PAPER_ASPECT_HIGH_FROM = 0.04;

/**
 * Paper coverage (2026-10-19, candidate): the smallest per-side share of the
 * sheet's edges that was seen. The photo gate already refuses under 0.4
 * (`minSideCoverage`); these are the two steps above it.
 */
export const PAPER_COVERAGE_MID_FROM = 0.6;
export const PAPER_COVERAGE_HIGH_FROM = 0.8;

/** Live wait (2026-10-19, candidate): seconds from the preview first finding the sheet to the shutter. */
export const LIVE_WAIT_MID_FROM_S = 3;
export const LIVE_WAIT_HIGH_FROM_S = 10;
export const LIVE_WAIT_TOP_FROM_S = 30;

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
 * How far the sheet's observed shape is from the nearer supported paper's true
 * one, as a fraction: `|observed / true - 1|` for A4 and for Letter, the
 * smaller of the two, under 2 %, 2 % to under 4 %, 4 % and over. The input is
 * the sheet's observed width over height (`observedAspect` in the paper
 * diagnostics). Not a finite positive number is `null`.
 */
export function paperAspectBucket(
  observedAspect: number | null | undefined,
): ScanQualityProps["paperAspect"] | null {
  if (
    typeof observedAspect !== "number" ||
    !Number.isFinite(observedAspect) ||
    observedAspect <= 0
  ) {
    return null;
  }
  // The detector already turns the corners so that TL to TR is the short side
  // (detect.ts, before it returns them), so this is a precaution: a value
  // above 1 would be a sheet read across the frame, and short over long does
  // not depend on which way it lies. The nearest of A4 and Letter is used, so
  // a strongly tilted A4 can fall one step short of the worst bucket.
  const shortOverLong =
    observedAspect > 1 ? 1 / observedAspect : observedAspect;
  const deviation = Math.min(
    Math.abs(shortOverLong / PAPER_ASPECT_A4 - 1),
    Math.abs(shortOverLong / PAPER_ASPECT_LETTER - 1),
  );
  if (deviation < PAPER_ASPECT_MID_FROM) return "under_2_pct";
  if (deviation < PAPER_ASPECT_HIGH_FROM) return "from_2_to_4_pct";
  return "from_4_pct";
}

/**
 * How much of the sheet's worst-seen side was visible: under 0.6, 0.6 to under
 * 0.8, 0.8 and over. A share outside 0 to 1, or not a finite number, is `null`.
 */
export function paperCoverageBucket(
  minSideCoverage: number | null | undefined,
): ScanQualityProps["paperCoverage"] | null {
  if (
    typeof minSideCoverage !== "number" ||
    !Number.isFinite(minSideCoverage) ||
    minSideCoverage < 0 ||
    minSideCoverage > 1
  ) {
    return null;
  }
  if (minSideCoverage < PAPER_COVERAGE_MID_FROM) return "under_0_6";
  if (minSideCoverage < PAPER_COVERAGE_HIGH_FROM) return "from_0_6_to_0_8";
  return "from_0_8";
}

/**
 * The grade of the fingers' flatness from the diagnostics' hand reading, or
 * `null` where there is none (no hand was detected, or the run stopped before
 * it). Only the grade is passed on; the two ratios behind it never are.
 */
export function handPoseBucket(
  hand: PipelineDiagnostics["hand"] | null | undefined,
): ScanQualityProps["handPose"] | null {
  return hand?.flatness?.pose ?? null;
}

/**
 * How long the live preview held the sheet before the shot, from milliseconds:
 * under 3 s, 3 to under 10, 10 to under 30, 30 and over. Not a finite
 * non-negative number (an upload, a typed length, a sheet never found live) is
 * `unknown`, a step of its own.
 */
export function liveWaitBucket(
  liveWaitMs: number | null | undefined,
): NonNullable<AnalyticsEventProps<"scan_capture_attempted">["liveWait"]> {
  if (
    typeof liveWaitMs !== "number" ||
    !Number.isFinite(liveWaitMs) ||
    liveWaitMs < 0
  ) {
    return "unknown";
  }
  const seconds = liveWaitMs / 1000;
  if (seconds < LIVE_WAIT_MID_FROM_S) return "under_3_s";
  if (seconds < LIVE_WAIT_HIGH_FROM_S) return "from_3_to_10_s";
  if (seconds < LIVE_WAIT_TOP_FROM_S) return "from_10_to_30_s";
  return "from_30_s";
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
 * Whether the sheet's corners in these diagnostics came from the detector.
 * A frame a person placed (V3.2 F2, `cornersSource` `adjusted` or `manual`)
 * is not the detector's: its angle and coverage say nothing about how the
 * detector sees paper, and `scan_rejected` has no field that could tell the
 * two apart, so the paper shadow grades are left out for it.
 */
function detectorCorners(
  diagnostics: PipelineDiagnostics | null | undefined,
): boolean {
  const source = diagnostics?.paper?.cornersSource;
  return source === undefined || source === "auto";
}

/**
 * The `paperSkew` a rejected scan may carry: present only when the pipeline
 * found the sheet's four corners itself (its diagnostics hold the angle).
 * `undefined` otherwise, or for a frame a person placed, and the caller
 * leaves the property out.
 */
export function rejectedPaperSkew(
  diagnostics: PipelineDiagnostics | null | undefined,
): ScanQualityProps["paperSkew"] | undefined {
  if (!detectorCorners(diagnostics)) return undefined;
  return paperSkewBucket(diagnostics?.paper?.maxAngleDeviationDeg) ?? undefined;
}

/**
 * The `paperCoverage` a rejected scan may carry: present only when the
 * pipeline found the sheet's four corners itself (the contract's rule),
 * `undefined` otherwise, or for a frame a person placed.
 */
export function rejectedPaperCoverage(
  diagnostics: PipelineDiagnostics | null | undefined,
): ScanQualityProps["paperCoverage"] | undefined {
  const paper = diagnostics?.paper;
  if (!paper || paper.widthFraction === null || !detectorCorners(diagnostics))
    return undefined;
  return paperCoverageBucket(paper.minSideCoverage) ?? undefined;
}

/**
 * The `handPose` a rejected scan may carry: present only when a hand was
 * detected and its flatness read, `undefined` otherwise.
 */
export function rejectedHandPose(
  diagnostics: PipelineDiagnostics | null | undefined,
): ScanQualityProps["handPose"] | undefined {
  return handPoseBucket(diagnostics?.hand) ?? undefined;
}

/**
 * The shadow buckets a `scan_rejected` event may carry, as the properties to
 * spread into it: each only where it can be worked out, so an event never holds
 * a guessed grade.
 */
export function rejectedShadowProps(
  diagnostics: PipelineDiagnostics | null | undefined,
): Pick<
  AnalyticsEventProps<"scan_rejected">,
  "paperSkew" | "paperCoverage" | "handPose"
> {
  const paperSkew = rejectedPaperSkew(diagnostics);
  const paperCoverage = rejectedPaperCoverage(diagnostics);
  const handPose = rejectedHandPose(diagnostics);
  return {
    ...(paperSkew ? { paperSkew } : {}),
    ...(paperCoverage ? { paperCoverage } : {}),
    ...(handPose ? { handPose } : {}),
  };
}

/**
 * The whole `scan_rejected` payload for a photo the pipeline refused: the flow,
 * the attempt, the issue codes and the shadow grades (`rejectedShadowProps`).
 * Both call sites (the easy scan and the printed-sheet page) build the event
 * here, so a grade cannot be dropped from one of them without a test failing.
 */
export function buildScanRejected(input: {
  readonly flow: ScanFlow;
  readonly attempt: number;
  readonly errors: readonly { readonly code: string }[];
  readonly diagnostics: PipelineDiagnostics | null | undefined;
}): AnalyticsEventProps<"scan_rejected"> {
  return {
    flow: input.flow,
    attempt: input.attempt,
    codes: issueCodes(input.errors.map((e) => e.code)),
    ...rejectedShadowProps(input.diagnostics),
  };
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
  const paperAspect = paperAspectBucket(diagnostics.paper?.observedAspect);
  // A shadow that could not be worked out is a step of its own, not a reason
  // to drop the whole event (the focal source, the buckets and the skew are
  // still true), and it is where the shadow is most worth watching.
  const priorEffect =
    priorEffectBucket(diagnostics.shadowPrior?.handLengthDeltaMm) ??
    "unavailable";
  if (!sharpness || !resolution || !edgeFit || !paperSkew || !paperAspect) {
    return null;
  }
  // Shadow buckets: left out, not guessed, where they cannot be worked out.
  const paperCoverage = paperCoverageBucket(diagnostics.paper?.minSideCoverage);
  const handPose = handPoseBucket(diagnostics.hand);
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
    paperAspect,
    priorEffect,
    ...(paperCoverage ? { paperCoverage } : {}),
    ...(handPose ? { handPose } : {}),
  };
}
