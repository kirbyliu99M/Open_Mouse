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
  readonly userAgent: string;
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
  } | null;
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
  const residuals =
    Array.isArray(o.sideResidualsPx) && o.sideResidualsPx.length === 4
      ? (o.sideResidualsPx.map((v) => cleanNumber(v, 3)) as [
          number | null,
          number | null,
          number | null,
          number | null,
        ])
      : null;
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
          }
        : null,
    },
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
            handMask:
              diagnostics.paperEdgeFit.edgeFit?.handMask === true ||
              diagnostics.paperEdgeFit.secondLook?.handMask === true,
            piecesJoined:
              diagnostics.paperEdgeFit.edgeFit?.piecesJoined ?? null,
            secondLook: diagnostics.paperEdgeFit.secondLook,
          },
        }
      : {}),
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
  if (record.paperEdgeFit?.secondLook)
    parts.push(
      `second look ${record.paperEdgeFit.secondLook.used ? "used" : "not used"}`,
    );
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
  return parts.join(" · ");
}
