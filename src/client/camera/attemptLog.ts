/**
 * A local record of every scan attempt, kept in this browser only.
 *
 * Why: the debug panel's numbers live in page memory, so a reload lost them,
 * and when Kirby's scans were rejected there was nothing to look at afterwards
 * (2026-10-06: a perfect live preview and a rejected photo, with no way to say
 * why). Every analysis, from the camera or from an uploaded file, now leaves one
 * record here: what was captured, what the preview was, what the pipeline
 * concluded and the numbers its gates looked at.
 *
 * Privacy, by construction: a record is numbers, booleans and short strings.
 * `sanitizeAttempt` is the only way one is made or read back, and it rebuilds
 * the record field by field: every number is finite and rounded, every string
 * is cut short and stripped of data URLs, the lists are capped, and anything it
 * does not know is dropped. There is no field a photo could be put in. The
 * record never leaves the device (nothing here touches the network); the only
 * way out is Kirby copying the debug JSON himself. The newest 20 are kept.
 *
 * Everything but `readAttempts` / `writeAttempts` is pure. Those two take a
 * storage object and swallow every error: a page without storage (private
 * browsing, a blocked or full store) works the same, it just remembers nothing
 * between reloads.
 */
import { HAND_POSE_BUCKETS } from "@/lib/contracts/analytics";
import type { PaperCornerSource } from "@/lib/contracts/measurement";
import type { HandPoseGrade } from "../photo/handFlatness";
import type { PipelineResult } from "../photo/pipeline";
import type { AnalysisThread } from "../photo/offMainAnalysis";
import {
  isPaperDetectionStage,
  type PaperDetectionStage,
} from "../paper/detectionStage";
import { ATTEMPT_LOG_KEY, type StorageLike } from "./easyScanPreferences";
import {
  isExperimentTag,
  type ExperimentTag,
  type ShutterKind,
} from "./livePlacement";
import {
  meanFingerRatio,
  pickSoftHint,
  SOFT_HINT_CODES,
  type SoftHintCode,
  type SoftHintInput,
} from "../photo/softHint";
import type { PlacementDiagnostics } from "../photo/placementDiagnostics";
import { aspectOfSize, compareFov } from "./previewConstraints";

export { ATTEMPT_LOG_KEY };
export const MAX_ATTEMPTS = 20;

const MAX_ERRORS = 8;
const MAX_CODES = 8;
const MAX_CODE_LENGTH = 48;
const MAX_MESSAGE_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 80;
const MAX_TIME_LENGTH = 40;
const MAX_MODEL_LENGTH = 32;

export type AttemptMethod = "takePhoto" | "canvas" | "upload";

/**
 * What the picture came from: a frame of the video cut to the part on screen
 * ("frame", the shutter's default, method "canvas"), the camera's photo
 * ("takePhoto", off by default), or a file the person chose ("upload").
 */
export type AttemptCaptureSource = "frame" | "takePhoto" | "upload";

const HAND_POSES: readonly string[] = HAND_POSE_BUCKETS;

export interface AttemptError {
  readonly code: string;
  readonly message: string;
}

export interface AttemptRecord {
  /** The shape of this record, so a later change can tell old ones apart. */
  readonly v: 1;
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly method: AttemptMethod | null;
  readonly captureSource: AttemptCaptureSource | null;
  /** The photo as it came from the camera or the file. */
  readonly photo: {
    readonly width: number | null;
    readonly height: number | null;
    readonly kb: number | null;
  };
  /**
   * The wait for the preview to be asked for the photo's shape ran out before
   * the camera answered (previewConstraints.ts), so the shutter opened anyway;
   * `null` for an upload.
   */
  readonly settleTimedOut: boolean | null;
  /** The live preview it was taken from (`null` sizes for an upload). */
  readonly preview: {
    readonly width: number | null;
    readonly height: number | null;
    /** (preview - photo) / photo in long over short; positive when the preview was the narrower view. */
    readonly aspectDiff: number | null;
    /** The two differ in shape by more than 2 %, so they did not show the same field of view. */
    readonly fovMismatch: boolean | null;
  };
  readonly result: "ok" | "error";
  /** Every error the pipeline reported, not only the first. */
  readonly errors: readonly AttemptError[];
  /** Non-blocking issues of a measured scan (a soft photo), by code. */
  readonly warnings: readonly string[];
  /** What the paper gates saw; `null` when no sheet was looked for (a scan with a typed hand length) or the run stopped first. */
  readonly paper: {
    readonly cornersSeen: number;
    readonly widthFraction: number | null;
    readonly heightFraction: number | null;
    readonly edgeFitResidualMm: number | null;
    /** The sheet's largest corner-angle deviation in degrees (how straight on the shot was), to 0.1; `null` without four corners. */
    readonly maxAngleDeviationDeg: number | null;
    /** The sheet's observed short side over long side (about 0.7071 for A4 seen flat), to 0.0001; `null` without four corners or in a record from before it was kept. */
    readonly observedAspect: number | null;
    /** `null` for a frame the person placed (no side was fitted), and never `null` in a record from before V3.2. */
    readonly minSideCoverage: number | null;
    /**
     * The four per-side coverages to 0.001, in the detector's side order (0 =
     * the short side from the top-left to the top-right corner, then
     * clockwise); `null` where they were not measured and in a record from
     * before they were kept. Paper geometry only: which edge was hidden.
     */
    readonly sideCoverages: readonly [number, number, number, number] | null;
    /** The side with the lowest coverage as the person sees it on screen; `null` without four corners, on a tie, or in an older record. */
    readonly worstSide: "top" | "bottom" | "left" | "right" | null;
    /** The paper gates that failed, whether or not the result reported them first. */
    readonly gateFailures: readonly string[];
    /**
     * Where the paper detector stopped when it found no sheet (scan S2,
     * candidate), one of `PAPER_DETECTION_STAGES`; `null` when a sheet was
     * found, and in a record from before it was kept. Anything else read back
     * is dropped to `null`.
     */
    readonly failureStage: PaperDetectionStage | null;
    /**
     * V3.2 F2 (candidate): where the corners came from, `auto` for the
     * detector's own (also every record from before it was kept), `adjusted`
     * or `manual` for a frame the person placed.
     */
    readonly cornersSource: PaperCornerSource;
  } | null;
  /** Laplacian variance of the analysed photo. */
  readonly sharpness: number | null;
  readonly hand: {
    readonly detected: boolean | null;
    readonly confidence: number | null;
    readonly handedness: "left" | "right" | null;
    /**
     * SHADOW MODE (2026-10-19, 未拍板 candidate): how flat the four fingers
     * looked (`assessHandFlatness`), as a grade; `null` in a record from before
     * it was kept or where no hand was detected. Nothing acted on it.
     */
    readonly handPose: HandPoseGrade | null;
    /** Mean finger reach over the palm length, to 0.001; `null` as `handPose` is, or when it is `unknown`. A ratio of distances, never a size. */
    readonly reachMean: number | null;
    /** The least straight finger's straightness (knuckle-to-tip over its joint chain), to 0.001; `null` as `reachMean` is. */
    readonly fingerStraightMin: number | null;
  };
  /**
   * How long the live preview had the sheet in view before this photo was
   * taken, in ms: from the first live sample that found the sheet's four
   * corners to the shutter. `null` for an upload, a typed hand length (the
   * loop looks for no sheet) or a sheet never found live, and in a record from
   * before it was kept. A long wait means the preview was stuck on a gate.
   */
  readonly liveWaitMs: number | null;
  /**
   * What the person saw and how it was carried over to the photo
   * (visibleView.ts): the stream's size, the part of it that was on screen, the
   * relation used between the stream and the photo, and whether that relation
   * holds (the stream was no wider a view than the photo). `null` for an
   * upload.
   */
  readonly view: {
    readonly stream: {
      readonly width: number | null;
      readonly height: number | null;
    };
    readonly visibleInStream: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    } | null;
    readonly model: string | null;
    readonly modelApplies: boolean | null;
    readonly aspectDiff: number | null;
  } | null;
  /** The picture the gates looked at; `crop` is set when the photo was cut down to the part the person saw. */
  readonly analysed: {
    readonly width: number | null;
    readonly height: number | null;
    readonly crop: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    } | null;
  };
  readonly parallaxCorrected: boolean | null;
  /**
   * The hand length and palm width the scan measured (the numbers its result and
   * submission carry), to 0.1 mm; `null` where the run did not end in a
   * measurement. Kept so a few scans in a row can be compared against a tape
   * measure from the debug JSON. Never sent anywhere.
   */
  readonly measured: {
    readonly handLengthMm: number | null;
    readonly palmWidthMm: number | null;
  };
  /**
   * Where the parallax correction's focal length came from (EXIF, the
   * homography, the nominal prior since landmark-raw-v3, or none: no
   * correction) and its value in px; `null` for both where the run stopped
   * before that.
   */
  readonly focal: {
    readonly source: "exif" | "homography" | "nominal" | "none" | null;
    readonly px: number | null;
  };
  /**
   * landmark-raw-v3 (candidate, design R7 §5.3): Kirby's S25 check. The
   * homography's own focal estimate (px, to 1) and whether it was judged
   * reliable, whether or not the correction used it; the same landmarks'
   * UNCORRECTED hand length, palm length and palm width; and the reported
   * (corrected) ones, all mm to 0.1. Local only: it is what Copy JSON shows
   * and is never sent (analytics has no field for a px or a mm). `null` on a
   * run that did not end in a measurement, and in a record from before v3.
   */
  readonly parallaxCheck: {
    readonly homographyFocal: {
      readonly px: number;
      readonly reliable: boolean;
    } | null;
    readonly uncorrected: AttemptLengths | null;
    readonly reported: AttemptLengths | null;
  } | null;
  /**
   * Shadow mode (candidate, 2026-10-16): the hand length a nominal focal length
   * would have given minus the one shown, to 0.1 mm; `null` where it was not
   * worked out. Local only, like the rest: it is what Copy JSON shows, and only
   * its coarse bucket is ever sent (`scan_quality.priorEffect`).
   */
  readonly shadowPrior: { readonly handLengthDeltaMm: number | null };
  readonly timingMs: {
    readonly decode: number | null;
    readonly paper: number | null;
    readonly hand: number | null;
    readonly total: number | null;
  };
  /**
   * V3.2 F8 (candidate): where the sheet detector and the sharpness ran,
   * `worker` (off the main thread) or `fallback` (the main thread: no worker,
   * or it failed); `null` where neither ran and in a record from before it was
   * kept. Anything else read back is dropped to `null`. Local only, never sent.
   */
  readonly analysisThread: AnalysisThread | null;
  /**
   * V3.2 F2, Kirby's accuracy check (candidate, only with `?debug=1`): how far
   * each corner he dragged ended from the detector's own, on a photo the
   * detector had measured. Pixel distances in the decoded photo (TL, TR, BR,
   * BL, to 0.1), that photo's long edge (so the distances can be scaled to
   * another photo size), and whether the magnifier was on. No coordinate, no
   * picture. `null` on every ordinary attempt.
   */
  readonly cornerCheck: {
    readonly magnifier: boolean;
    readonly distancesPx: readonly [number, number, number, number];
    readonly imageLongEdgePx: number | null;
  } | null;
  /**
   * V3.2 F16 (candidate): a parallax correction the safety check did not use
   * (`parallaxGuard.ts`): why, the first length that failed, the three ratios
   * (uncorrected over corrected, to 0.0001) and the focal length it had used
   * (px to 1). The scan was then measured uncorrected. `null` on every scan
   * whose correction was used or never made, and in a record from before F16.
   * Local only, never sent.
   */
  readonly parallaxGuard: {
    readonly reason: "lengthened" | "over_shortened" | "not_finite";
    readonly field: "handLength" | "palmLength" | "palmWidth";
    readonly ratios: {
      readonly handLength: number | null;
      readonly palmLength: number | null;
      readonly palmWidth: number | null;
    };
    readonly refusedFocal: {
      readonly source: "exif" | "homography" | "nominal" | null;
      readonly px: number | null;
    };
  } | null;
  /**
   * V3.2 F17 (candidate): the detector's second look with the hand's palm
   * (palmChoice.ts): why it took the region it took, how many sizeable
   * regions there were, palm points (of 5) inside the region taken and
   * inside the largest, and whether that answer replaced the first. Present
   * only on an attempt that had one. Local only, never sent.
   */
  readonly paperChoice?: AttemptPaperChoice;
  /**
   * V3.2 F19 (candidate): how the sheet's sides were fitted (each side's
   * residual in px to 0.001, `null` for a side not fitted; whether each
   * side's points reached both its ends; boundary points left out under the
   * hand; whether a hand mask was used; pieces joined), and the detector's
   * second call (what it carried, whether it was taken, its ms). Present only
   * on an attempt with a found sheet or a second call. Local only, never sent.
   */
  readonly paperEdgeFit?: AttemptPaperEdgeFit;
  /**
   * V3.3 WP1b (candidate, 未拍板; design F20 §5.1): where the hand lay on the
   * sheet, from the same corrected points the measurement used
   * (placementDiagnostics.ts). Present only on a measured paper-edge scan.
   * Summary numbers only: no landmark list. Local only, never sent.
   */
  readonly placement?: AttemptPlacement;
  /**
   * V3.3 WP1b: the 3D readings of MediaPipe's world landmarks (handWorld.ts),
   * present only where at least one could be worked out. No world point is
   * kept. Local only, never sent.
   */
  readonly world?: AttemptWorld;
  /**
   * V3.3 WP1b: the live viewfinder's last placement readings before the
   * shutter, and which shutter fired. Present only on a camera capture.
   * Local only, never sent.
   */
  readonly guidance?: AttemptGuidance;
  /**
   * V3.3 WP1b: the post-shot soft hint (softHint.ts `pickSoftHint`) this
   * photo WOULD get with today's candidate thresholds. Recorded only: it is
   * not shown anywhere. Present with `placement`. Local only, never sent.
   */
  readonly softHint?: AttemptSoftHint;
  /**
   * V3.3 WP3b (candidate 未拍板): the post-shot banner this photo got
   * (softHintBanner.ts): which one was shown, whether it was closed, and
   * whether the person then retook the photo or went on. Present only where
   * the banner was worked out (the hints on: `?debug=1` for now). Local
   * only, never sent.
   */
  readonly softHintBanner?: AttemptSoftHintBanner;
  /** V3.3 WP1b: the experiment tag picked in the debug panel for this scan (`?debug=1` only). */
  readonly experimentTag?: ExperimentTag;
  readonly userAgent: string;
}

/** Four per-finger values (index, middle, ring, little), kept as named fields rather than a list. */
export interface AttemptFingers {
  readonly index: number;
  readonly middle: number;
  readonly ring: number;
  readonly little: number;
}

export interface AttemptPlacement {
  /** mm to 0.1, positive inside the sheet. */
  readonly wristToEdgeMm: number | null;
  readonly wristEdge: "near-bottom" | "near-top" | null;
  /** Degrees to 0.1, signed. */
  readonly handAxisDeg: number | null;
  /** mm to 0.1. */
  readonly minSideMarginMm: number | null;
  readonly thumbOutside: boolean | null;
  /** To 0.0001. */
  readonly palmOverHand: number | null;
  /** To 0.0001 each. */
  readonly distalOverProximal: AttemptFingers | null;
  /** Whether the points were parallax-corrected (else the plain homography projection). */
  readonly corrected: boolean;
  /** MediaPipe image z, wrist minus the knuckles' mean, to 0.0001. */
  readonly zWristMinusMcp: number | null;
  /** mm to 1. */
  readonly camDistMm: number | null;
  readonly camOffsetMm: number | null;
  /** Non-thumb landmark nearest the picture's border: px to 0.1, and as a share of the short side to 0.0001. */
  readonly frameEdgePx: number | null;
  readonly frameEdgeFraction: number | null;
  /** Research: ring luma ÷ sheet luma, to 0.001. */
  readonly shadowRing: number | null;
  /** ms to 0.01. */
  readonly shadowRingMs: number | null;
}

export interface AttemptWorld {
  /** Degrees to 0.1. */
  readonly palmTiltDeg: number | null;
  readonly fingerFlexDeg: AttemptFingers | null;
  readonly fingerElevDeg: AttemptFingers | null;
  /** mm to 0.01. */
  readonly planarityRmsMm: number | null;
}

/** One live reading: how long before the shutter (ms to 1), the fill (0.0001), mm and degrees (0.1), ratio (0.0001). */
export interface AttemptLiveReading {
  readonly ageMs: number | null;
  readonly fill: number | null;
  readonly wristToEdgeMm: number | null;
  readonly handAxisDeg: number | null;
  readonly palmOverHand: number | null;
  /** The fingers' mean distal/proximal ratio, to 0.0001 (2026-10-26). */
  readonly fingerRatioMean?: number | null;
}

export interface AttemptGuidance {
  readonly shutter: ShutterKind;
  /** The last three live readings, newest first; `null` where there were fewer. Named fields, not a list. */
  readonly live: {
    readonly latest: AttemptLiveReading | null;
    readonly previous: AttemptLiveReading | null;
    readonly earlier: AttemptLiveReading | null;
  };
}

export interface AttemptSoftHint {
  /** The hint that would be shown, after the repeat throttle. */
  readonly code: SoftHintCode | null;
  /** The hint chosen before the throttle (the device history entry). */
  readonly candidate: SoftHintCode | null;
  readonly suppressed: boolean;
}

export interface AttemptSoftHintBanner {
  /** The banner shown, after the repeat throttle; `null` for none. */
  readonly code: SoftHintCode | null;
  /** The banner chosen before the throttle (the device's banner history entry). */
  readonly candidate: SoftHintCode | null;
  readonly suppressed: boolean;
  /** The person closed it (the close button). */
  readonly dismissed: boolean;
  /** What came next: a retake, Continue, or neither yet. A retake wins over an earlier Continue. */
  readonly after: "retake" | "continue" | null;
}

export interface AttemptPaperEdgeFit {
  readonly sideResidualsPx:
    | readonly [number | null, number | null, number | null, number | null]
    | null;
  readonly sideEndsSeen: readonly [boolean, boolean, boolean, boolean] | null;
  readonly excludedPoints: number | null;
  readonly handMask: boolean;
  readonly piecesJoined: number | null;
  readonly secondLook: {
    readonly palm: boolean;
    readonly handMask: boolean;
    readonly used: boolean;
    readonly ms: number | null;
    /** F19 review: the masked second answer that was not taken; present only then. */
    readonly notUsed?: AttemptSecondLookNotUsed;
  } | null;
}

export interface AttemptSecondLookNotUsed {
  readonly cornersSeen: number | null;
  readonly sideResidualsPx:
    | readonly [number | null, number | null, number | null, number | null]
    | null;
  readonly excludedPoints: number | null;
  readonly piecesJoined: number | null;
}

export interface AttemptPaperChoice {
  readonly reason:
    | "only_candidate"
    | "largest_holds_palm"
    | "palm"
    | "no_candidate_holds_palm";
  readonly candidates: number | null;
  readonly palmInside: number | null;
  readonly largestPalmInside: number | null;
  readonly used: boolean;
}

/** Three lengths of one scan, mm to 0.1 (`parallaxCheck`). */
export interface AttemptLengths {
  readonly handLengthMm: number;
  readonly palmLengthMm: number;
  readonly palmWidthMm: number;
}

// ── Sanitising: the only door into a record ───────────────────────────────

/** A string cut to `max`, with anything shaped like a data URL taken out. `null` for a non-string. */
function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/data:[^\s"']*/gi, "[data removed]")
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, max);
}

function cleanNumber(value: unknown, digits: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

/** Exactly four finite shares in 0-1, to 0.001; anything else (a wrong length, a stray value) is `null`, never a partial list. */
function cleanSideCoverages(
  value: unknown,
): readonly [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const out: number[] = [];
  for (const item of value) {
    const n = cleanNumber(item, 3);
    if (n === null || n < 0 || n > 1) return null;
    out.push(n);
  }
  return [out[0], out[1], out[2], out[3]];
}

const cleanBool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanList<T>(
  value: unknown,
  max: number,
  clean: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (out.length >= max) break;
    const cleaned = clean(item);
    if (cleaned !== null) out.push(cleaned);
  }
  return out;
}

/**
 * Rebuilds `value` as an `AttemptRecord`, or `null` when it is not one (no
 * usable time, no result). Whatever it is given, what comes out holds only
 * finite rounded numbers, booleans, short strings and short lists.
 */
export function sanitizeAttempt(value: unknown): AttemptRecord | null {
  const raw = asObject(value);
  if (!raw) return null;
  const at = cleanString(raw.at, MAX_TIME_LENGTH);
  if (at === null || !Number.isFinite(Date.parse(at))) return null;
  if (raw.result !== "ok" && raw.result !== "error") return null;

  const photo = asObject(raw.photo);
  const preview = asObject(raw.preview);
  const paper = asObject(raw.paper);
  const hand = asObject(raw.hand);
  const analysed = asObject(raw.analysed);
  const crop = asObject(analysed?.crop);
  const view = asObject(raw.view);
  const viewStream = asObject(view?.stream);
  const viewVisible = asObject(view?.visibleInStream);
  const timing = asObject(raw.timingMs);
  const measured = asObject(raw.measured);
  const focal = asObject(raw.focal);
  const shadowPrior = asObject(raw.shadowPrior);
  const handedness = hand?.handedness;
  const handPose = hand?.handPose;
  const method = raw.method;

  return {
    v: 1,
    at,
    method:
      method === "takePhoto" || method === "canvas" || method === "upload"
        ? method
        : null,
    captureSource:
      raw.captureSource === "frame" ||
      raw.captureSource === "takePhoto" ||
      raw.captureSource === "upload"
        ? raw.captureSource
        : null,
    settleTimedOut: cleanBool(raw.settleTimedOut),
    photo: {
      width: cleanNumber(photo?.width, 0),
      height: cleanNumber(photo?.height, 0),
      kb: cleanNumber(photo?.kb, 0),
    },
    preview: {
      width: cleanNumber(preview?.width, 0),
      height: cleanNumber(preview?.height, 0),
      aspectDiff: cleanNumber(preview?.aspectDiff, 4),
      fovMismatch: cleanBool(preview?.fovMismatch),
    },
    result: raw.result,
    errors: cleanList(raw.errors, MAX_ERRORS, (item) => {
      const error = asObject(item);
      const code = cleanString(error?.code, MAX_CODE_LENGTH);
      if (code === null) return null;
      return {
        code,
        message: cleanString(error?.message, MAX_MESSAGE_LENGTH) ?? "",
      };
    }),
    warnings: cleanList(raw.warnings, MAX_CODES, (item) =>
      cleanString(item, MAX_CODE_LENGTH),
    ),
    paper: paper
      ? {
          cornersSeen: cleanNumber(paper.cornersSeen, 0) ?? 0,
          widthFraction: cleanNumber(paper.widthFraction, 4),
          heightFraction: cleanNumber(paper.heightFraction, 4),
          edgeFitResidualMm: cleanNumber(paper.edgeFitResidualMm, 3),
          maxAngleDeviationDeg: cleanNumber(paper.maxAngleDeviationDeg, 1),
          observedAspect: cleanNumber(paper.observedAspect, 4),
          // A placed frame has none; a record from before V3.2 always has one.
          minSideCoverage:
            paper.minSideCoverage === null
              ? null
              : (cleanNumber(paper.minSideCoverage, 3) ?? 0),
          sideCoverages: cleanSideCoverages(paper.sideCoverages),
          worstSide:
            paper.worstSide === "top" ||
            paper.worstSide === "bottom" ||
            paper.worstSide === "left" ||
            paper.worstSide === "right"
              ? paper.worstSide
              : null,
          gateFailures: cleanList(paper.gateFailures, MAX_CODES, (item) =>
            cleanString(item, MAX_CODE_LENGTH),
          ),
          failureStage: isPaperDetectionStage(paper.failureStage)
            ? paper.failureStage
            : null,
          cornersSource:
            paper.cornersSource === "adjusted" ||
            paper.cornersSource === "manual"
              ? paper.cornersSource
              : "auto",
        }
      : null,
    sharpness: cleanNumber(raw.sharpness, 2),
    hand: {
      detected: cleanBool(hand?.detected),
      confidence: cleanNumber(hand?.confidence, 3),
      handedness:
        handedness === "left" || handedness === "right" ? handedness : null,
      // Records stored before shadow mode have none: null, not an error.
      handPose:
        typeof handPose === "string" && HAND_POSES.includes(handPose)
          ? (handPose as HandPoseGrade)
          : null,
      reachMean: cleanNumber(hand?.reachMean, 3),
      fingerStraightMin: cleanNumber(hand?.fingerStraightMin, 3),
    },
    liveWaitMs: cleanNumber(raw.liveWaitMs, 0),
    view: view
      ? {
          stream: {
            width: cleanNumber(viewStream?.width, 0),
            height: cleanNumber(viewStream?.height, 0),
          },
          visibleInStream: viewVisible
            ? {
                x: cleanNumber(viewVisible.x, 1) ?? 0,
                y: cleanNumber(viewVisible.y, 1) ?? 0,
                width: cleanNumber(viewVisible.width, 1) ?? 0,
                height: cleanNumber(viewVisible.height, 1) ?? 0,
              }
            : null,
          model: cleanString(view.model, MAX_MODEL_LENGTH),
          modelApplies: cleanBool(view.modelApplies),
          aspectDiff: cleanNumber(view.aspectDiff, 4),
        }
      : null,
    analysed: {
      width: cleanNumber(analysed?.width, 0),
      height: cleanNumber(analysed?.height, 0),
      crop: crop
        ? {
            x: cleanNumber(crop.x, 0) ?? 0,
            y: cleanNumber(crop.y, 0) ?? 0,
            width: cleanNumber(crop.width, 0) ?? 0,
            height: cleanNumber(crop.height, 0) ?? 0,
          }
        : null,
    },
    parallaxCorrected: cleanBool(raw.parallaxCorrected),
    // Records stored before these fields existed have none: null, not an error.
    measured: {
      handLengthMm: cleanNumber(measured?.handLengthMm, 1),
      palmWidthMm: cleanNumber(measured?.palmWidthMm, 1),
    },
    focal: {
      source:
        focal?.source === "exif" ||
        focal?.source === "homography" ||
        focal?.source === "nominal" ||
        focal?.source === "none"
          ? focal.source
          : null,
      px: cleanNumber(focal?.px, 1),
    },
    // Records stored before shadow mode have none: null, not an error.
    shadowPrior: {
      handLengthDeltaMm: cleanNumber(shadowPrior?.handLengthDeltaMm, 1),
    },
    timingMs: {
      decode: cleanNumber(timing?.decode, 0),
      paper: cleanNumber(timing?.paper, 0),
      hand: cleanNumber(timing?.hand, 0),
      total: cleanNumber(timing?.total, 0),
    },
    analysisThread:
      raw.analysisThread === "worker" || raw.analysisThread === "fallback"
        ? raw.analysisThread
        : null,
    cornerCheck: cleanCornerCheck(raw.cornerCheck),
    // Records stored before landmark-raw-v3 have none: null, not an error.
    parallaxCheck: cleanParallaxCheck(raw.parallaxCheck),
    // Records stored before F16 have none: null, not an error.
    parallaxGuard: cleanParallaxGuard(raw.parallaxGuard),
    // Only on an attempt with F17's second look; absent on every other one.
    ...paperChoiceField(raw.paperChoice),
    // Only on an attempt F19 had something to say about; absent otherwise.
    ...paperEdgeFitField(raw.paperEdgeFit),
    // V3.3 WP1b: each only where it was recorded; absent on every older record.
    ...placementField(raw.placement),
    ...worldField(raw.world),
    ...guidanceField(raw.guidance),
    ...softHintField(raw.softHint),
    // V3.3 WP3b: only where the banner was worked out.
    ...softHintBannerField(raw.softHintBanner),
    ...(isExperimentTag(raw.experimentTag)
      ? { experimentTag: raw.experimentTag }
      : {}),
    userAgent: cleanString(raw.userAgent, MAX_USER_AGENT_LENGTH) ?? "",
  };
}

/** The F17 choice, rebuilt field by field; without a known reason it is left out. */
function paperChoiceField(value: unknown): {
  paperChoice?: AttemptPaperChoice;
} {
  const o = asObject(value);
  if (!o) return {};
  const reason = o.reason;
  if (
    reason !== "only_candidate" &&
    reason !== "largest_holds_palm" &&
    reason !== "palm" &&
    reason !== "no_candidate_holds_palm"
  )
    return {};
  return {
    paperChoice: {
      reason,
      candidates: cleanNumber(o.candidates, 0),
      palmInside: cleanNumber(o.palmInside, 0),
      largestPalmInside: cleanNumber(o.largestPalmInside, 0),
      used: o.used === true,
    },
  };
}

/** The F19 record, rebuilt field by field; anything that is not an object is left out. */
function paperEdgeFitField(value: unknown): {
  paperEdgeFit?: AttemptPaperEdgeFit;
} {
  const o = asObject(value);
  if (!o) return {};
  const residuals = cleanResiduals(o.sideResidualsPx);
  const ends =
    Array.isArray(o.sideEndsSeen) &&
    o.sideEndsSeen.length === 4 &&
    o.sideEndsSeen.every((v) => typeof v === "boolean")
      ? (o.sideEndsSeen as [boolean, boolean, boolean, boolean])
      : null;
  const look = asObject(o.secondLook);
  return {
    paperEdgeFit: {
      sideResidualsPx: residuals,
      sideEndsSeen: ends ? [ends[0], ends[1], ends[2], ends[3]] : null,
      excludedPoints: cleanNumber(o.excludedPoints, 0),
      handMask: o.handMask === true,
      piecesJoined: cleanNumber(o.piecesJoined, 0),
      secondLook: look
        ? {
            palm: look.palm === true,
            handMask: look.handMask === true,
            used: look.used === true,
            ms: cleanNumber(look.ms, 0),
            ...notUsedField(look.notUsed),
          }
        : null,
    },
  };
}

/** Four per-side residuals (px, to 0.001; each `null` when not a finite number), or `null` unless an array of four. */
function cleanResiduals(
  value: unknown,
): [number | null, number | null, number | null, number | null] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  return value.map((v) => cleanNumber(v, 3)) as [
    number | null,
    number | null,
    number | null,
    number | null,
  ];
}

/** F19 review: the masked second answer that was not taken, rebuilt field by field; left out unless an object. */
function notUsedField(value: unknown): {
  notUsed?: AttemptSecondLookNotUsed;
} {
  const o = asObject(value);
  if (!o) return {};
  return {
    notUsed: {
      cornersSeen: cleanNumber(o.cornersSeen, 0),
      sideResidualsPx: cleanResiduals(o.sideResidualsPx),
      excludedPoints: cleanNumber(o.excludedPoints, 0),
      piecesJoined: cleanNumber(o.piecesJoined, 0),
    },
  };
}

// ── V3.3 WP1b: placement, world, guidance, soft hint ──────────────────────

/** Sizes beyond these are not a reading of a hand on a sheet and are dropped to `null`. */
const MAX_PLACEMENT_MM = 2000;
const MAX_CAMERA_MM = 10000;
const MAX_FRAME_EDGE_PX = 20000;
const MAX_AGE_MS = 60000;

function cleanBounded(
  value: unknown,
  digits: number,
  min: number,
  max: number,
): number | null {
  const n = cleanNumber(value, digits);
  return n !== null && n >= min && n <= max ? n : null;
}

/** Four finite per-finger values from a 4-list or from named fields, or `null` as a whole. */
function cleanFingers(
  value: unknown,
  digits: number,
  min: number,
  max: number,
): AttemptFingers | null {
  let items: unknown[] | null = null;
  if (Array.isArray(value)) items = value.length === 4 ? value : null;
  else {
    const o = asObject(value);
    if (o) items = [o.index, o.middle, o.ring, o.little];
  }
  if (!items) return null;
  const out: number[] = [];
  for (const item of items) {
    const n = cleanBounded(item, digits, min, max);
    if (n === null) return null;
    out.push(n);
  }
  return { index: out[0], middle: out[1], ring: out[2], little: out[3] };
}

/** The placement block, rebuilt field by field; left out unless an object. */
function placementField(value: unknown): { placement?: AttemptPlacement } {
  const o = asObject(value);
  if (!o) return {};
  return {
    placement: {
      wristToEdgeMm: cleanBounded(
        o.wristToEdgeMm,
        1,
        -MAX_PLACEMENT_MM,
        MAX_PLACEMENT_MM,
      ),
      wristEdge:
        o.wristEdge === "near-bottom" || o.wristEdge === "near-top"
          ? o.wristEdge
          : null,
      handAxisDeg: cleanBounded(o.handAxisDeg, 1, -180, 180),
      minSideMarginMm: cleanBounded(
        o.minSideMarginMm,
        1,
        -MAX_PLACEMENT_MM,
        MAX_PLACEMENT_MM,
      ),
      thumbOutside: cleanBool(o.thumbOutside),
      palmOverHand: cleanBounded(o.palmOverHand, 4, 0, 10),
      distalOverProximal: cleanFingers(o.distalOverProximal, 4, 0, 100),
      corrected: o.corrected === true,
      zWristMinusMcp: cleanBounded(o.zWristMinusMcp, 4, -100, 100),
      camDistMm: cleanBounded(o.camDistMm, 0, 0, MAX_CAMERA_MM),
      camOffsetMm: cleanBounded(o.camOffsetMm, 0, 0, MAX_CAMERA_MM),
      frameEdgePx: cleanBounded(
        o.frameEdgePx,
        1,
        -MAX_FRAME_EDGE_PX,
        MAX_FRAME_EDGE_PX,
      ),
      frameEdgeFraction: cleanBounded(o.frameEdgeFraction, 4, -100, 100),
      shadowRing: cleanBounded(o.shadowRing, 3, 0, 1000),
      shadowRingMs: cleanBounded(o.shadowRingMs, 2, 0, MAX_AGE_MS),
    },
  };
}

/** The world block, rebuilt field by field; left out unless an object with at least one value. */
function worldField(value: unknown): { world?: AttemptWorld } {
  const o = asObject(value);
  if (!o) return {};
  const world: AttemptWorld = {
    palmTiltDeg: cleanBounded(o.palmTiltDeg, 1, 0, 90),
    fingerFlexDeg: cleanFingers(o.fingerFlexDeg, 1, 0, 360),
    fingerElevDeg: cleanFingers(o.fingerElevDeg, 1, 0, 90),
    planarityRmsMm: cleanBounded(o.planarityRmsMm, 2, 0, MAX_PLACEMENT_MM),
  };
  const any =
    world.palmTiltDeg !== null ||
    world.fingerFlexDeg !== null ||
    world.fingerElevDeg !== null ||
    world.planarityRmsMm !== null;
  return any ? { world } : {};
}

/**
 * One live reading, or `null` as a whole when its age is missing or beyond
 * `MAX_AGE_MS`: values without a known, recent age would read as the
 * placement just before the shutter when they may be stale.
 */
function cleanLiveReading(value: unknown): AttemptLiveReading | null {
  const o = asObject(value);
  if (!o) return null;
  const ageMs = cleanBounded(o.ageMs, 0, 0, MAX_AGE_MS);
  if (ageMs === null) return null;
  return {
    ageMs,
    fill: cleanBounded(o.fill, 4, 0, 10),
    wristToEdgeMm: cleanBounded(
      o.wristToEdgeMm,
      1,
      -MAX_PLACEMENT_MM,
      MAX_PLACEMENT_MM,
    ),
    handAxisDeg: cleanBounded(o.handAxisDeg, 1, -180, 180),
    palmOverHand: cleanBounded(o.palmOverHand, 4, 0, 10),
    fingerRatioMean: cleanBounded(o.fingerRatioMean, 4, 0, 100),
  };
}

/** The guidance block; left out without a known shutter. */
function guidanceField(value: unknown): { guidance?: AttemptGuidance } {
  const o = asObject(value);
  if (!o) return {};
  const shutter = o.shutter;
  if (shutter !== "auto" && shutter !== "manual" && shutter !== "no-sheet")
    return {};
  const live = asObject(o.live);
  return {
    guidance: {
      shutter,
      live: {
        latest: cleanLiveReading(live?.latest),
        previous: cleanLiveReading(live?.previous),
        earlier: cleanLiveReading(live?.earlier),
      },
    },
  };
}

const SOFT_HINTS: readonly string[] = SOFT_HINT_CODES;
const cleanSoftHintCode = (value: unknown): SoftHintCode | null =>
  typeof value === "string" && SOFT_HINTS.includes(value)
    ? (value as SoftHintCode)
    : null;

/** The soft hint block; left out unless an object. */
function softHintField(value: unknown): { softHint?: AttemptSoftHint } {
  const o = asObject(value);
  if (!o) return {};
  return {
    softHint: {
      code: cleanSoftHintCode(o.code),
      candidate: cleanSoftHintCode(o.candidate),
      suppressed: o.suppressed === true,
    },
  };
}

/** The banner block; left out unless an object. */
function softHintBannerField(value: unknown): {
  softHintBanner?: AttemptSoftHintBanner;
} {
  const o = asObject(value);
  if (!o) return {};
  return {
    softHintBanner: {
      code: cleanSoftHintCode(o.code),
      candidate: cleanSoftHintCode(o.candidate),
      suppressed: o.suppressed === true,
      dismissed: o.dismissed === true,
      after: o.after === "retake" || o.after === "continue" ? o.after : null,
    },
  };
}

/**
 * This device's BANNER history for its throttle (softHintBanner.ts): the
 * candidate of every earlier record that worked a banner out, oldest first.
 * Kept apart from `softHintHistoryOf` (the record-only hint, with today's
 * thresholds), so the two never count each other's photos. Pure.
 */
export function softHintBannerHistoryOf(
  records: readonly AttemptRecord[],
): (SoftHintCode | null)[] {
  const out: (SoftHintCode | null)[] = [];
  for (const record of records) {
    if (record.softHintBanner) out.push(record.softHintBanner.candidate);
  }
  return out;
}

export interface SoftHintBannerOutcome {
  readonly dismissed?: boolean;
  readonly after?: "retake" | "continue";
}

/**
 * The list with the banner of the record made at `at` updated: `dismissed`
 * once set stays set; `after` "retake" is never replaced by "continue". A
 * list without that record (or a record without a banner) is returned as it
 * was. Pure.
 */
export function withSoftHintBannerOutcome(
  list: readonly AttemptRecord[],
  at: string,
  outcome: SoftHintBannerOutcome,
): AttemptRecord[] {
  return list.map((record) => {
    if (record.at !== at || !record.softHintBanner) return record;
    const banner = record.softHintBanner;
    const after =
      banner.after === "retake" ? "retake" : (outcome.after ?? banner.after);
    const dismissed = banner.dismissed || outcome.dismissed === true;
    if (after === banner.after && dismissed === banner.dismissed) return record;
    return { ...record, softHintBanner: { ...banner, after, dismissed } };
  });
}

/**
 * Writes the banner's outcome into the stored record made at `at` (read
 * again first, as `recordAttempt` does) and returns the page's list with it
 * too. Best-effort: a missing, blocked or full store changes only the page's
 * list. Never throws.
 */
export function recordSoftHintBannerOutcome(
  storage: StorageLike | null,
  at: string,
  outcome: SoftHintBannerOutcome,
  session: readonly AttemptRecord[] = [],
): AttemptRecord[] {
  try {
    const stored = readAttempts(storage);
    if (stored)
      writeAttempts(storage, withSoftHintBannerOutcome(stored, at, outcome));
  } catch {
    // The log is a convenience: it must never break a scan.
  }
  return withSoftHintBannerOutcome(session, at, outcome);
}

/**
 * This device's soft-hint history for the throttle (softHint.ts): the
 * candidate of every earlier record that has one, oldest first. Records from
 * before V3.3, or of runs without a placement, are not part of it. Pure.
 */
export function softHintHistoryOf(
  records: readonly AttemptRecord[],
): (SoftHintCode | null)[] {
  const out: (SoftHintCode | null)[] = [];
  for (const record of records) {
    if (record.softHint) out.push(record.softHint.candidate);
  }
  return out;
}

/** The placement block's raw input, from the pipeline's diagnostics. */
function placementRaw(p: PlacementDiagnostics): Record<string, unknown> {
  return {
    ...p.placement,
    corrected: p.corrected,
    zWristMinusMcp: p.zWristMinusMcp,
    camDistMm: p.camDistMm,
    camOffsetMm: p.camOffsetMm,
    frameEdgePx: p.frameEdge?.minPx ?? null,
    frameEdgeFraction: p.frameEdge?.fractionOfShortSide ?? null,
    shadowRing: p.shadowRing,
    shadowRingMs: p.shadowRingMs,
  };
}

/** Lengths of at most this many mm are kept (a hand is under 300). */
const MAX_LENGTH_MM = 1000;

/** Exactly three finite lengths in 0-1000 mm, to 0.1; anything else is `null` as a whole. */
function cleanLengths(value: unknown): AttemptLengths | null {
  const o = asObject(value);
  if (!o) return null;
  const out: number[] = [];
  for (const key of ["handLengthMm", "palmLengthMm", "palmWidthMm"]) {
    const n = cleanNumber(o[key], 1);
    if (n === null || n < 0 || n > MAX_LENGTH_MM) return null;
    out.push(n);
  }
  return { handLengthMm: out[0], palmLengthMm: out[1], palmWidthMm: out[2] };
}

/** Focal lengths of at most this many px are kept. */
const MAX_FOCAL_PX = 100000;

/** The S25 check, rebuilt field by field; anything that is not one is `null`. */
function cleanParallaxCheck(value: unknown): AttemptRecord["parallaxCheck"] {
  const check = asObject(value);
  if (!check) return null;
  const h = asObject(check.homographyFocal);
  const px = cleanNumber(h?.px, 1);
  const homographyFocal =
    h &&
    px !== null &&
    px > 0 &&
    px <= MAX_FOCAL_PX &&
    typeof h.reliable === "boolean"
      ? { px, reliable: h.reliable }
      : null;
  const uncorrected = cleanLengths(check.uncorrected);
  const reported = cleanLengths(check.reported);
  if (!homographyFocal && !uncorrected && !reported) return null;
  return { homographyFocal, uncorrected, reported };
}

/** The F16 refusal, rebuilt field by field; without a known reason and field it is `null` as a whole. */
function cleanParallaxGuard(value: unknown): AttemptRecord["parallaxGuard"] {
  const guard = asObject(value);
  if (!guard) return null;
  const reason = guard.reason;
  const field = guard.field;
  if (
    reason !== "lengthened" &&
    reason !== "over_shortened" &&
    reason !== "not_finite"
  )
    return null;
  if (field !== "handLength" && field !== "palmLength" && field !== "palmWidth")
    return null;
  const ratios = asObject(guard.ratios);
  const focal = asObject(guard.refusedFocal);
  const px = cleanNumber(focal?.px, 0);
  return {
    reason,
    field,
    ratios: {
      handLength: cleanNumber(ratios?.handLength, 4),
      palmLength: cleanNumber(ratios?.palmLength, 4),
      palmWidth: cleanNumber(ratios?.palmWidth, 4),
    },
    refusedFocal: {
      source:
        focal?.source === "exif" ||
        focal?.source === "homography" ||
        focal?.source === "nominal"
          ? focal.source
          : null,
      px: px !== null && px > 0 && px <= MAX_FOCAL_PX ? px : null,
    },
  };
}

/** Distances of at most this many pixels are kept; anything larger is not a corner check. */
const MAX_CORNER_DISTANCE_PX = 5000;

/**
 * The accuracy check, rebuilt: a boolean, exactly four finite distances in
 * 0-5000 px to 0.1, and a whole long edge; anything else is `null` as a whole.
 */
function cleanCornerCheck(value: unknown): AttemptRecord["cornerCheck"] {
  const check = asObject(value);
  if (!check || typeof check.magnifier !== "boolean") return null;
  const list = check.distancesPx;
  if (!Array.isArray(list) || list.length !== 4) return null;
  const out: number[] = [];
  for (const item of list) {
    const n = cleanNumber(item, 1);
    if (n === null || n < 0 || n > MAX_CORNER_DISTANCE_PX) return null;
    out.push(n);
  }
  const edge = cleanNumber(check.imageLongEdgePx, 0);
  return {
    magnifier: check.magnifier,
    distancesPx: [out[0], out[1], out[2], out[3]],
    imageLongEdgePx: edge !== null && edge > 0 ? edge : null,
  };
}

// ── The ring buffer ───────────────────────────────────────────────────────

/** `list` with `record` added at the end, and only the newest `max` kept. A `record` that is not one is not added. */
export function appendAttempt(
  list: readonly AttemptRecord[],
  record: unknown,
  max: number = MAX_ATTEMPTS,
): AttemptRecord[] {
  const clean = sanitizeAttempt(record);
  const next = clean ? [...list, clean] : [...list];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** What was stored, as records: anything that does not parse, is not a list or is not a record is left out; at most the newest 20. */
export function parseAttempts(raw: string | null | undefined): AttemptRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: AttemptRecord[] = [];
  for (const item of parsed) {
    const record = sanitizeAttempt(item);
    if (record) records.push(record);
  }
  return records.length > MAX_ATTEMPTS
    ? records.slice(records.length - MAX_ATTEMPTS)
    : records;
}

export function serialiseAttempts(list: readonly AttemptRecord[]): string {
  return JSON.stringify(list);
}

/** The stored attempts, or `null` where storage is missing or throws. */
export function readAttempts(
  storage: StorageLike | null,
): AttemptRecord[] | null {
  if (!storage) return null;
  try {
    return parseAttempts(storage.getItem(ATTEMPT_LOG_KEY));
  } catch {
    return null;
  }
}

/** Whether the store took the list. Best-effort: a full or blocked store must never break a scan. */
export function writeAttempts(
  storage: StorageLike | null,
  list: readonly AttemptRecord[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ATTEMPT_LOG_KEY, serialiseAttempts(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * What is stored and what this page has recorded this session, as one list in
 * time order, without repeats, the newest 20. The two differ when another tab
 * has written (the store has records this page lacks) and when the store cannot
 * be written (this page has records the store lacks).
 */
export function mergeAttempts(
  stored: readonly AttemptRecord[],
  session: readonly AttemptRecord[],
  max: number = MAX_ATTEMPTS,
): AttemptRecord[] {
  const seen = new Set<string>();
  const all: { record: AttemptRecord; order: number }[] = [];
  for (const record of [...stored, ...session]) {
    const key = JSON.stringify(record);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ record, order: all.length });
  }
  all.sort(
    (a, b) =>
      Date.parse(a.record.at) - Date.parse(b.record.at) || a.order - b.order,
  );
  const list = all.map((entry) => entry.record);
  return list.length > max ? list.slice(list.length - max) : list;
}

/**
 * Adds `record` to what is stored (read again each time, so two tabs do not
 * overwrite each other) and returns the list to show. `session` is the page's
 * own list. While the store can be read and written it is the truth, and the
 * page's copy is not written back over it (a log deleted in another tab stays
 * deleted). Where the store cannot be written (a full quota lets the page read
 * and refuse the write) or cannot be read at all, the page's list covers what
 * it could not keep, so the debug panel still shows every attempt of the
 * session.
 */
export function recordAttempt(
  storage: StorageLike | null,
  record: unknown,
  session: readonly AttemptRecord[] = [],
): AttemptRecord[] {
  const stored = readAttempts(storage);
  const fromStore = appendAttempt(stored ?? session, record);
  if (writeAttempts(storage, fromStore)) return fromStore;
  return appendAttempt(mergeAttempts(stored ?? [], session), record);
}

// ── Making a record from a run ────────────────────────────────────────────

export interface AttemptCapture {
  readonly method: AttemptMethod | null;
  /** Where the picture came from; absent is read as unknown. */
  readonly captureSource?: AttemptCaptureSource | null;
  /**
   * For a frame of the video: the stream's size and the part of it that was on
   * screen, which is the whole of the picture analysed.
   */
  readonly frame?: {
    readonly stream: { readonly width: number; readonly height: number };
    readonly visibleInStream: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  };
  readonly photoWidth: number | null;
  readonly photoHeight: number | null;
  readonly photoKb: number | null;
  /** The preview settle wait ran out (see `AttemptRecord.settleTimedOut`); `null`/absent for an upload. */
  readonly settleTimedOut?: boolean | null;
  /** From the live preview first finding the sheet to the shutter, in ms (see `AttemptRecord.liveWaitMs`); `null`/absent when it never did. */
  readonly liveWaitMs?: number | null;
  /** The live preview's frame at the moment of capture; `null` for an upload. */
  readonly previewWidth: number | null;
  readonly previewHeight: number | null;
  /**
   * V3.3 WP1b: which shutter fired and the live placement readings before it,
   * newest last, each with its age at the shutter (ms). Absent for an upload.
   */
  readonly guidance?: {
    readonly shutter: ShutterKind;
    readonly live: readonly {
      readonly ageMs: number | null;
      readonly fill: number | null;
      readonly wristToEdgeMm: number | null;
      readonly handAxisDeg: number | null;
      readonly palmOverHand: number | null;
    }[];
  } | null;
  /** V3.3 WP1b: the debug panel's experiment tag for this scan; absent otherwise. */
  readonly experimentTag?: string | null;
}

export type AttemptOutcome =
  | { readonly kind: "result"; readonly result: PipelineResult }
  /**
   * Kirby's corner check (V3.2 F2, `?debug=1` only): no analysis ran; the
   * record holds the distances and the magnifier switch, nothing else.
   */
  | {
      readonly kind: "cornerCheck";
      readonly magnifier: boolean;
      readonly distancesPx: readonly [number, number, number, number];
      readonly imageLongEdgePx: number | null;
    }
  /** The pipeline threw (the detector would not load, an unexpected failure). */
  | {
      readonly kind: "thrown";
      readonly code: string;
      readonly message: string;
    };

/**
 * The record for one analysis. The output has been through `sanitizeAttempt`,
 * so it is safe to store whatever the pipeline put in its result.
 */
export function buildAttemptRecord(input: {
  readonly at: Date | string;
  readonly userAgent: string;
  readonly capture: AttemptCapture;
  readonly outcome: AttemptOutcome;
  /** V3.3 WP1b: this device's earlier soft-hint candidates (`softHintHistoryOf`), oldest first. */
  readonly softHintHistory?: readonly (SoftHintCode | null)[];
  /** V3.3 WP3b: the banner this photo got (softHintBanner.ts); absent while the hints are off. */
  readonly softHintBanner?: {
    readonly code: SoftHintCode | null;
    readonly candidate: SoftHintCode | null;
    readonly suppressed: boolean;
  };
}): AttemptRecord {
  const { capture, outcome } = input;
  const at = input.at instanceof Date ? input.at.toISOString() : input.at;

  const photoAspect = aspectOfSize(capture.photoWidth, capture.photoHeight);
  // A frame of the video IS the preview (cut to the screen's part): there is
  // no second image source to compare it with.
  const fov =
    capture.captureSource !== "frame" &&
    photoAspect !== null &&
    capture.previewWidth !== null &&
    capture.previewHeight !== null
      ? compareFov(
          { width: capture.previewWidth, height: capture.previewHeight },
          photoAspect,
        )
      : null;

  let result: "ok" | "error" = "error";
  let errors: readonly AttemptError[] = [];
  let warnings: readonly string[] = [];
  let diagnostics: PipelineResultDiagnostics | undefined;
  if (outcome.kind === "thrown") {
    errors = [{ code: outcome.code, message: outcome.message }];
  } else if (outcome.kind === "cornerCheck") {
    // Not an analysis: nothing failed, and no pipeline numbers are recorded.
    result = "ok";
  } else {
    const pipeline = outcome.result;
    diagnostics = pipeline.diagnostics;
    if (pipeline.status === "ok") {
      result = "ok";
      warnings = pipeline.warnings.map((warning) => warning.code);
    } else if (pipeline.status === "error") {
      errors = pipeline.errors.map((error) => ({
        code: error.code,
        message: error.message,
      }));
    } else {
      // "needsManualCard" cannot happen without a printed sheet; the screen says "UNEXPECTED".
      errors = [{ code: "UNEXPECTED", message: "Something went wrong." }];
    }
  }

  const record = sanitizeAttempt({
    v: 1,
    at,
    method: capture.method,
    captureSource: capture.captureSource ?? null,
    settleTimedOut: capture.settleTimedOut ?? null,
    photo: {
      width: capture.photoWidth,
      height: capture.photoHeight,
      kb: capture.photoKb,
    },
    preview: {
      width: capture.previewWidth,
      height: capture.previewHeight,
      aspectDiff: fov?.aspectDiff ?? null,
      fovMismatch: fov?.fovMismatch ?? null,
    },
    result,
    errors,
    warnings,
    paper: diagnostics?.paper ?? null,
    sharpness: diagnostics?.laplacianVariance ?? null,
    // The flatness is flattened into the three summary fields; the sanitizer
    // below keeps nothing but those (no landmark, no depth, no millimetre).
    hand: diagnostics?.hand
      ? {
          detected: diagnostics.hand.detected,
          confidence: diagnostics.hand.confidence,
          handedness: diagnostics.hand.handedness,
          handPose: diagnostics.hand.flatness?.pose ?? null,
          reachMean: diagnostics.hand.flatness?.reachMean ?? null,
          fingerStraightMin:
            diagnostics.hand.flatness?.fingerStraightMin ?? null,
        }
      : {
          detected: null,
          confidence: null,
          handedness: null,
          handPose: null,
          reachMean: null,
          fingerStraightMin: null,
        },
    liveWaitMs: capture.liveWaitMs ?? null,
    view:
      diagnostics?.view ??
      (capture.frame
        ? {
            stream: capture.frame.stream,
            visibleInStream: capture.frame.visibleInStream,
            model: "frame",
            modelApplies: true,
            aspectDiff: 0,
          }
        : null),
    analysed: {
      width: diagnostics?.analysed?.width ?? null,
      height: diagnostics?.analysed?.height ?? null,
      crop: diagnostics?.fovCrop ?? null,
    },
    parallaxCorrected: diagnostics?.parallaxCorrected ?? null,
    measured: result === "ok" ? (diagnostics?.measured ?? null) : null,
    focal: diagnostics?.focal ?? null,
    shadowPrior: diagnostics?.shadowPrior ?? null,
    timingMs: {
      decode: diagnostics?.decodeMs ?? null,
      paper: diagnostics?.paperMs ?? null,
      hand: diagnostics?.handMs ?? null,
      total: diagnostics?.totalMs ?? null,
    },
    analysisThread: diagnostics?.analysisThread ?? null,
    parallaxCheck:
      result === "ok" && diagnostics?.shadowPrior
        ? {
            homographyFocal: diagnostics.shadowPrior.homographyFocal ?? null,
            uncorrected: diagnostics.shadowPrior.uncorrected ?? null,
            reported: diagnostics.shadowPrior.reported ?? null,
          }
        : null,
    parallaxGuard:
      result === "ok" ? (diagnostics?.parallaxGuard ?? null) : null,
    cornerCheck:
      outcome.kind === "cornerCheck"
        ? {
            magnifier: outcome.magnifier,
            distancesPx: outcome.distancesPx,
            imageLongEdgePx: outcome.imageLongEdgePx,
          }
        : null,
    ...(diagnostics?.paperChoice
      ? { paperChoice: diagnostics.paperChoice }
      : {}),
    ...(diagnostics?.paperEdgeFit
      ? {
          paperEdgeFit: {
            sideResidualsPx:
              diagnostics.paperEdgeFit.edgeFit?.sideResidualsPx ?? null,
            sideEndsSeen:
              diagnostics.paperEdgeFit.edgeFit?.sideEndsSeen ?? null,
            excludedPoints:
              diagnostics.paperEdgeFit.edgeFit?.excludedPoints ?? null,
            // F19 review: whether the fit recorded here (its residuals and
            // points left out) used the mask. Only with no fit to record (no
            // sheet in the result) does it say whether the second call
            // carried the hand.
            handMask: diagnostics.paperEdgeFit.edgeFit
              ? diagnostics.paperEdgeFit.edgeFit.handMask === true
              : diagnostics.paperEdgeFit.secondLook?.handMask === true,
            piecesJoined:
              diagnostics.paperEdgeFit.edgeFit?.piecesJoined ?? null,
            secondLook: diagnostics.paperEdgeFit.secondLook,
          },
        }
      : {}),
    // V3.3 WP1b (log only): the placement record, the soft hint it would
    // give, the live guidance and the experiment tag; each only where known.
    ...(diagnostics?.placement
      ? {
          placement: placementRaw(diagnostics.placement),
          world: diagnostics.placement.world,
          softHint: softHintOf(
            diagnostics,
            diagnostics.placement,
            input.softHintHistory ?? [],
          ),
        }
      : {}),
    ...(capture.guidance ? { guidance: guidanceRaw(capture.guidance) } : {}),
    ...(input.softHintBanner
      ? {
          softHintBanner: {
            code: input.softHintBanner.code,
            candidate: input.softHintBanner.candidate,
            suppressed: input.softHintBanner.suppressed,
            dismissed: false,
            after: null,
          },
        }
      : {}),
    ...(capture.experimentTag ? { experimentTag: capture.experimentTag } : {}),
    userAgent: input.userAgent,
  });
  // `result` and `at` are set above, so the record is always valid; the
  // fallback only keeps the type honest.
  return (
    record ?? {
      v: 1,
      at: new Date(0).toISOString(),
      method: null,
      captureSource: null,
      settleTimedOut: null,
      photo: { width: null, height: null, kb: null },
      preview: {
        width: null,
        height: null,
        aspectDiff: null,
        fovMismatch: null,
      },
      result: "error",
      errors: [],
      warnings: [],
      paper: null,
      sharpness: null,
      hand: {
        detected: null,
        confidence: null,
        handedness: null,
        handPose: null,
        reachMean: null,
        fingerStraightMin: null,
      },
      liveWaitMs: null,
      view: null,
      analysed: { width: null, height: null, crop: null },
      parallaxCorrected: null,
      measured: { handLengthMm: null, palmWidthMm: null },
      focal: { source: null, px: null },
      shadowPrior: { handLengthDeltaMm: null },
      timingMs: { decode: null, paper: null, hand: null, total: null },
      analysisThread: null,
      parallaxCheck: null,
      parallaxGuard: null,
      cornerCheck: null,
      userAgent: "",
    }
  );
}

type PipelineResultDiagnostics = NonNullable<PipelineResult["diagnostics"]>;

/**
 * One photo's readings for the soft-hint picker (softHint.ts), from the
 * pipeline's diagnostics: the same numbers the record-only hint and the
 * post-shot banner (V3.3 WP3b) both go by. Pure.
 */
export function softHintInputOf(
  diagnostics: PipelineResultDiagnostics,
  placement: PlacementDiagnostics,
): SoftHintInput {
  return {
    wristToEdgeMm: placement.placement.wristToEdgeMm,
    handAxisDeg: placement.placement.handAxisDeg,
    minSideMarginMm: placement.placement.minSideMarginMm,
    palmOverHand: placement.placement.palmOverHand,
    reachMean: diagnostics.hand?.flatness?.reachMean ?? null,
    palmTiltDeg: placement.world.palmTiltDeg,
    fingerFlexDeg: placement.world.fingerFlexDeg,
    fingerRatioMean: meanFingerRatio(placement.placement.distalOverProximal),
    sharpness: diagnostics.laplacianVariance ?? null,
    paperWidthFraction: diagnostics.paper?.widthFraction ?? null,
  };
}

/**
 * The soft hint this photo would get (softHint.ts), with today's candidate
 * thresholds and the device's history. Recorded only; never shown. A throw
 * is no hint.
 */
function softHintOf(
  diagnostics: PipelineResultDiagnostics,
  placement: PlacementDiagnostics,
  history: readonly (SoftHintCode | null)[],
): AttemptSoftHint {
  try {
    const hint = pickSoftHint(softHintInputOf(diagnostics, placement), history);
    return {
      code: hint.code,
      candidate: hint.candidate,
      suppressed: hint.suppressed,
    };
  } catch {
    return { code: null, candidate: null, suppressed: false };
  }
}

/** The live readings as the record's named fields, newest first. */
function guidanceRaw(
  guidance: NonNullable<AttemptCapture["guidance"]>,
): Record<string, unknown> {
  const live = Array.isArray(guidance.live) ? guidance.live : [];
  const at = (k: number) => live[live.length - 1 - k] ?? null;
  return {
    shutter: guidance.shutter,
    live: { latest: at(0), previous: at(1), earlier: at(2) },
  };
}

// ── For the debug panel ───────────────────────────────────────────────────

const pct = (value: number | null) =>
  value === null ? "?" : `${Math.round(value * 100)}%`;

/** One line for the panel: when, how, what happened and the numbers that matter. */
export function describeAttempt(record: AttemptRecord): string {
  // The record's time is UTC; the Z says so.
  const time = `${record.at.slice(11, 19)}Z`;
  const photo =
    record.photo.width && record.photo.height
      ? `${record.photo.width}×${record.photo.height}`
      : "?×?";
  const outcome =
    record.result === "ok"
      ? "ok"
      : record.errors.map((error) => error.code).join("+") || "error";
  const parts = [
    time,
    record.captureSource === "frame" ? "frame" : (record.method ?? "?"),
    photo,
    outcome,
  ];
  if (record.paper)
    parts.push(
      `paper ${pct(record.paper.widthFraction)}×${pct(record.paper.heightFraction)}`,
      `resid ${record.paper.edgeFitResidualMm ?? "?"} mm`,
    );
  if (record.paper?.failureStage)
    parts.push(`stage ${record.paper.failureStage}`);
  if (record.paper && record.paper.cornersSource !== "auto")
    parts.push(`corners ${record.paper.cornersSource}`);
  if (record.cornerCheck)
    parts.push(
      `corner check ${record.cornerCheck.magnifier ? "magnifier on" : "magnifier off"} · ${record.cornerCheck.distancesPx.join("/")} px`,
    );
  if (record.paper?.sideCoverages)
    parts.push(
      `edge ${record.paper.worstSide ?? "?"} worst · cov ${record.paper.sideCoverages.join("/")}`,
    );
  if (record.paperEdgeFit?.sideResidualsPx)
    parts.push(
      `side resid ${record.paperEdgeFit.sideResidualsPx.map((v) => v ?? "?").join("/")} px`,
    );
  if (record.paperEdgeFit?.handMask)
    parts.push(
      `hand mask · ${record.paperEdgeFit.excludedPoints ?? "?"} pts out${
        (record.paperEdgeFit.piecesJoined ?? 1) > 1
          ? ` · ${record.paperEdgeFit.piecesJoined} pieces joined`
          : ""
      }`,
    );
  if (record.paperEdgeFit?.secondLook) {
    const look = record.paperEdgeFit.secondLook;
    const missed = look.notUsed;
    parts.push(
      `second look ${look.used ? "used" : "not used"}${
        missed
          ? ` (with hand mask: ${missed.cornersSeen ?? "?"} corners · resid ${
              missed.sideResidualsPx
                ? missed.sideResidualsPx.map((v) => v ?? "?").join("/")
                : "?"
            } px · ${missed.excludedPoints ?? "?"} pts out${
              (missed.piecesJoined ?? 1) > 1
                ? ` · ${missed.piecesJoined} pieces joined`
                : ""
            })`
          : ""
      }`,
    );
  }
  if (record.hand.handPose !== null)
    parts.push(
      `pose ${record.hand.handPose}${
        record.hand.reachMean !== null
          ? ` (reach ${record.hand.reachMean})`
          : ""
      }`,
    );
  if (record.liveWaitMs !== null)
    parts.push(`live ${(record.liveWaitMs / 1000).toFixed(1)} s`);
  if (record.preview.fovMismatch) parts.push("FOV mismatch");
  if (record.view && record.view.modelApplies === false)
    parts.push("view model n/a");
  if (record.settleTimedOut) parts.push("settle timed out");
  if (record.analysed.crop) parts.push("cropped");
  if (record.measured.handLengthMm !== null)
    parts.push(`len ${record.measured.handLengthMm.toFixed(1)} mm`);
  if (record.measured.palmWidthMm !== null)
    parts.push(`palm ${record.measured.palmWidthMm.toFixed(1)} mm`);
  if (record.placement)
    parts.push(
      `wrist ${record.placement.wristToEdgeMm ?? "?"} mm · axis ${record.placement.handAxisDeg ?? "?"}°`,
    );
  if (record.guidance) parts.push(`shutter ${record.guidance.shutter}`);
  if (record.experimentTag) parts.push(`tag ${record.experimentTag}`);
  return parts.join(" · ");
}
