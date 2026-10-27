/**
 * The single prioritised cue line and the three status chips
 * (docs/design/camera-capture-2026-09-25/README.md's numbered priority
 * list, revised 2026-09-25 for Kirby's plain-paper direction change: the
 * lock-on target is a blank sheet of paper's four corners, not a printed
 * sheet's ArUco markers — see src/client/camera/quad-source.ts's header).
 * Pure — combines the checks in quad.ts/light.ts/steadiness.ts into one
 * ordered decision, so the priority order itself is unit-tested directly
 * rather than only exercised incidentally through the component.
 */
import type { Locale } from "../../lib/contracts/locale";
import {
  cameraCuesCopy,
  type CameraCuesCopy,
} from "../../lib/copy/camera-cues";
import { CAMERA_CONSTANTS } from "./constants";
import {
  computeQuadSkew,
  isQuadSkewed,
  computeQuadWidthFraction,
  computeQuadSizeStatusWithHysteresis,
  type Quad,
  type QuadSizeStatus,
} from "./quad";
import { computeLightStatus, type LightStatus } from "./light";
import type { LivePaperGate, PaperSide } from "./paperGate";
import {
  paperStageLines,
  type PaperDetectionStage,
} from "../paper/detectionStage";
import type {
  PlacementCueCode,
  PlacementCueInput,
} from "./placementHysteresis";

/**
 * The cue codes that name where the paper detector stopped (scan S2,
 * 2026-10-21, candidate): one per stage that has something to say. The words
 * are `src/lib/copy/paper-stage.ts`'s live lines, in "may" words.
 */
export type PaperStageCueCode =
  | "stage-no-bright-region"
  | "stage-region-split"
  | "stage-aspect-mismatch"
  | "stage-too-small";

export type CueCode =
  | "place-paper"
  | "no-corners"
  | "some-corners"
  | "tilted"
  | "edge-covered"
  | "edge-covered-top"
  | "edge-covered-bottom"
  | "edge-covered-left"
  | "edge-covered-right"
  | "paper-curled"
  | "too-far"
  | "too-close"
  | "dark"
  | "bright"
  | "hold-still"
  | "out-of-focus"
  | "perfect"
  | PaperStageCueCode
  | PlacementCueCode;

export interface Cue {
  readonly code: CueCode;
  readonly message: string;
  /** True only for "perfect" — every check passed, auto-capture may run. */
  readonly allPass: boolean;
}

const CUE_KEYS: Record<
  Exclude<CueCode, PaperStageCueCode>,
  keyof CameraCuesCopy["paper"]
> = {
  "place-paper": "placePaper",
  "no-corners": "noCorners",
  "some-corners": "someCorners",
  tilted: "tilted",
  "edge-covered": "edgeCovered",
  "edge-covered-top": "edgeCoveredTop",
  "edge-covered-bottom": "edgeCoveredBottom",
  "edge-covered-left": "edgeCoveredLeft",
  "edge-covered-right": "edgeCoveredRight",
  "paper-curled": "paperCurled",
  "too-far": "tooFar",
  "too-close": "tooClose",
  dark: "dark",
  bright: "bright",
  "hold-still": "holdStill",
  "out-of-focus": "outOfFocus",
  perfect: "perfect",
  // V3.3 WP3a (candidate): the live hand hints (placementHysteresis.ts).
  "hand-missing": "handMissing",
  "wrist-onto-paper": "wristOntoPaper",
  "wrist-align": "wristAlign",
  "hand-inside": "handInside",
  "hand-straight": "handStraight",
  "hand-flat": "layHandFlat",
};

/**
 * The cue codes that name a paper-gate reason. Each (reason, side) is its own
 * code, so the debounce (cueDebounce.ts) can ask for the SAME reason and side
 * twice in a row before the words change.
 */
export const PAPER_GATE_CUE_CODES: readonly CueCode[] = [
  "edge-covered",
  "edge-covered-top",
  "edge-covered-bottom",
  "edge-covered-left",
  "edge-covered-right",
  "paper-curled",
];

/** Each detector stage that has its own cue, and that cue. */
const STAGE_CUE_CODES: Partial<Record<PaperDetectionStage, PaperStageCueCode>> =
  {
    no_bright_region: "stage-no-bright-region",
    region_split: "stage-region-split",
    aspect_mismatch: "stage-aspect-mismatch",
    too_small: "stage-too-small",
  };

const STAGE_OF_CUE: Record<PaperStageCueCode, PaperDetectionStage> = {
  "stage-no-bright-region": "no_bright_region",
  "stage-region-split": "region_split",
  "stage-aspect-mismatch": "aspect_mismatch",
  "stage-too-small": "too_small",
};

function isPaperStageCueCode(code: CueCode): code is PaperStageCueCode {
  return code in STAGE_OF_CUE;
}

/**
 * The cue for where the detector stopped, or `null` where the stage has no
 * cue of its own (`exception` and `unknown` say nothing a "point the camera"
 * cue does not, so those keep the existing no-paper cues) or there is none.
 */
export function cueCodeForPaperStage(
  stage: PaperDetectionStage | null | undefined,
): PaperStageCueCode | null {
  return stage ? (STAGE_CUE_CODES[stage] ?? null) : null;
}

/**
 * The REASON behind a paper-gate or stage cue code (the side name is not part
 * of it), `null` for any other cue. The four stage cues share ONE reason,
 * "paper-stage", the way the four covered sides share "edge-covered": a
 * stage that flips between samples (a sheet at a threshold) still counts as
 * the same run, and the debounce then shows the plain no-paper text, so a
 * flipping stage cannot keep an old cue (even "perfect") on screen. The
 * debounce (cueDebounce.ts) asks for the same reason twice in a row before
 * any of these is shown.
 */
export type PaperGateReason = "edge-covered" | "paper-curled" | "paper-stage";

export function paperGateReason(code: CueCode): PaperGateReason | null {
  if (code === "paper-curled") return "paper-curled";
  if (isPaperStageCueCode(code)) return "paper-stage";
  return PAPER_GATE_CUE_CODES.includes(code) ? "edge-covered" : null;
}

const EDGE_COVERED_BY_SIDE: Record<PaperSide, CueCode> = {
  top: "edge-covered-top",
  bottom: "edge-covered-bottom",
  left: "edge-covered-left",
  right: "edge-covered-right",
};

/**
 * The cue a failed live paper gate calls for, or `null` when it calls for
 * none (a pass, or nothing evaluated yet). A refusal this module has no
 * words for reads as the corners cue: the paper is not usable as it lies.
 */
export function cueCodeForPaperGate(
  gate: LivePaperGate | undefined,
): CueCode | null {
  if (!gate) return null;
  switch (gate.kind) {
    case "pass":
    case "not-evaluated":
      return null;
    case "edge-covered":
      return gate.side ? EDGE_COVERED_BY_SIDE[gate.side] : "edge-covered";
    case "curled":
      return "paper-curled";
    case "blocked":
      return "some-corners";
  }
}

export type CueCalibrationMode = "printed-sheet" | "paper-edge";

/**
 * The words of a cue in a locale. `locale` is a parameter, never read from
 * anywhere in here: this module is pure.
 */
export function cueMessage(
  code: CueCode,
  mode: CueCalibrationMode,
  locale: Locale,
): string {
  if (isPaperStageCueCode(code)) {
    return paperStageLines(STAGE_OF_CUE[code], locale).live;
  }
  const table = cameraCuesCopy(locale);
  return (mode === "printed-sheet" ? table.sheet : table.paper)[CUE_KEYS[code]];
}

function cue(code: CueCode, mode: CueCalibrationMode, locale: Locale): Cue {
  return {
    code,
    message: cueMessage(code, mode, locale),
    allPass: code === "perfect",
  };
}

/** The cue for a code, as `pickCue` would have built it. */
export function cueFromCode(
  code: CueCode,
  mode: CueCalibrationMode,
  locale: Locale,
): Cue {
  return cue(code, mode, locale);
}

/**
 * The easy scan's cue line. "Perfect" reads "Got it — hold still" there, and
 * being out of focus reads "Tap the paper to focus" where a tap can set the
 * focus (otherwise the plain "Waiting for a sharp picture"). The words come
 * from the cue's code, so a cue built earlier still reads right in the locale
 * now shown.
 */
export function easyCueText(
  cue: Cue,
  options: { readonly tapToFocus: boolean; readonly locale: Locale },
): string {
  const table = cameraCuesCopy(options.locale);
  if (cue.code === "perfect") return table.gotIt;
  if (cue.code === "out-of-focus" && options.tapToFocus)
    return table.tapToFocus;
  return cueMessage(cue.code, "paper-edge", options.locale);
}

/**
 * The hint line under the viewfinder: what is happening now, when it is not
 * already the cue. Empty otherwise. While out of focus it says so, unless the
 * cue already says exactly that (no tap to focus): the same words twice would
 * only be read out twice.
 */
export function easyHintText(input: {
  readonly cueCode: CueCode | null;
  readonly ringFraction: number;
  readonly tapToFocus: boolean;
  readonly locale: Locale;
}): string {
  const table = cameraCuesCopy(input.locale);
  if (input.cueCode === "out-of-focus")
    return input.tapToFocus ? table.paper.outOfFocus : "";
  if (input.cueCode === "perfect" && input.ringFraction > 0)
    return table.holdStillTakingPhoto;
  return "";
}

export interface CueInput {
  /** How many of the paper's four corners were found in this sample. */
  readonly cornersSeen: 0 | 1 | 2 | 3 | 4;
  /** The tracked paper quad — required once cornersSeen === 4. */
  readonly quad: Quad | null;
  readonly frameWidth: number;
  readonly meanLuma: number;
  readonly clippedFraction: number;
  readonly steady: boolean;
  readonly sharpEnough: boolean;
  /**
   * The photo's own paper gate, run on this sample's detection
   * (paperGate.ts). Omit where the flow has no such gate (the printed sheet):
   * the cue is then exactly what it was before.
   */
  readonly paperGate?: LivePaperGate;
  /**
   * Milliseconds since a paper quad was last found at all (0 corners seen
   * continuously). Only consulted when `cornersSeen === 0`, to escalate
   * from the generic "point the camera" cue to a more specific one.
   */
  readonly msSinceLastDetection: number;
  /**
   * Where the paper detector stopped on this sample when it found no sheet
   * (`SheetQuadDetection.failureStage`, scan S2). Omit where there is none
   * (the printed sheet): the cue is then exactly what it was before.
   */
  readonly paperStage?: PaperDetectionStage | null;
  /**
   * Whether the live loop has found the whole sheet at least once since it
   * started (EasyScanCamera's `firstSheetSeenAtRef`). `false`: no stage cue,
   * the "point the camera" / "place a blank sheet" cues exactly as before
   * S2, because with no sheet ever seen the stage most likely describes the
   * desk, not a sheet (an empty brown desk reads as no_bright_region, a white
   * mug as too_small). Omitted: treated as seen.
   */
  readonly sheetSeenYet?: boolean;
  /**
   * V3.3 WP4 (candidate): the distance status the previous sample got
   * (`computeQuadSizeStatusWithHysteresis`). Omitted or `null`: the plain
   * bounds, exactly as before.
   */
  readonly previousSizeStatus?: QuadSizeStatus | null;
  /**
   * V3.3 WP3a (candidate 未拍板): the hand's settled live state
   * (placementHysteresis.ts `placementCueInput`). Omitted or `null` (the
   * hints are off, the hand detector is not loaded, the reading is stale):
   * the cue is exactly what it was before WP3.
   */
  readonly placement?: PlacementCueInput | null;
}

/** The cues that say the paper itself passed (only the phone is left to hold or focus). */
/** The detector stages a forearm across the sheet ends in (detect.ts RETRY_STAGES). */
const HAND_CUT_STAGES: readonly PaperDetectionStage[] = [
  "region_split",
  "aspect_mismatch",
];

const PAPER_PASSED_CODES: readonly CueCode[] = [
  "perfect",
  "hold-still",
  "out-of-focus",
];

/**
 * The one cue to show, per the spec's fixed priority order. Every input
 * after corner count is only consulted once 4/4 corners are found and a
 * quad exists — a partial corner set always short-circuits to
 * "some-corners".
 *
 * V3.3 WP3a (candidate 未拍板; F20 design §4.1): with `input.placement`, the
 * hand's hint comes after the paper's own checks (corners, tilt, distance,
 * light, edges) and before "hold still" and focus:
 *   find the sheet → distance → light → edges → hand on the paper → wrist /
 *   inside / direction → flat → hold still → focus → perfect.
 * A hand hint is never "perfect" (`allPass` false). It is a HINT: the live
 * loop fills the ring from the cue WITHOUT `placement` (EasyScanCamera), so
 * the auto-capture is what it was. §4.3: with the wrist at the bottom edge,
 * "the bottom edge is covered" is not said; the rest of the order is read
 * as if the edges had passed, and where that would say "perfect" (the ring
 * is not filling: the edge still fails) it says "hold still".
 */
export function pickCue(
  input: CueInput,
  mode: CueCalibrationMode,
  locale: Locale,
): Cue {
  const paper = pickPaperCue(input, mode, locale);
  const placement = input.placement;
  if (!placement) return paper;
  // Kirby's S25 test 2026-10-27 (candidate 未拍板): a hand laid in the
  // middle of the sheet puts the forearm across it, and the detector finds
  // the sheet cut in two or the wrong shape; no corners, so no hand hint
  // could be worked out, and the paper's words ("place a blank sheet") were
  // wrong. With a hand seen, those stages say where the wrist goes instead.
  if (
    input.cornersSeen <= 0 &&
    placement.handSeen &&
    input.paperStage != null &&
    HAND_CUT_STAGES.includes(input.paperStage)
  )
    return cue("wrist-align", mode, locale);
  if (PAPER_PASSED_CODES.includes(paper.code))
    return placement.hint ? cue(placement.hint, mode, locale) : paper;
  if (paper.code === "edge-covered-bottom" && placement.wristNearBottomEdge) {
    if (placement.hint) return cue(placement.hint, mode, locale);
    const rest = pickPaperCue(
      { ...input, paperGate: { kind: "pass" } },
      mode,
      locale,
    );
    return rest.code === "perfect" ? cue("hold-still", mode, locale) : rest;
  }
  return paper;
}

/** `pickCue` without the hand: the paper's, the phone's and the light's checks only. */
function pickPaperCue(
  input: CueInput,
  mode: CueCalibrationMode,
  locale: Locale,
): Cue {
  if (input.cornersSeen <= 0) {
    // Where the detector stopped, when that step has words of its own; the
    // "point the camera" cues otherwise.
    // Candidate order (未拍板, scan S2 review): no stage cue before a sheet
    // was ever seen; after the place-paper timeout, "no bright region" in
    // light the Light chip calls ok yields to "place a blank sheet" (the
    // sheet is most likely gone, and "may be too dark" would contradict the
    // chip). The other stages keep their cue after the timeout.
    const timedOut =
      input.msSinceLastDetection >
      CAMERA_CONSTANTS.noDetection.placePaperTimeoutMs;
    const stageCode =
      input.sheetSeenYet === false
        ? null
        : cueCodeForPaperStage(input.paperStage);
    const stageYields =
      stageCode === "stage-no-bright-region" &&
      timedOut &&
      computeLightStatus(input.meanLuma, input.clippedFraction) === "ok";
    if (stageCode && !stageYields) return cue(stageCode, mode, locale);
    if (timedOut) return cue("place-paper", mode, locale);
    return cue("no-corners", mode, locale);
  }
  if (input.cornersSeen < 4) return cue("some-corners", mode, locale);
  if (!input.quad) return cue("some-corners", mode, locale);

  const skew = computeQuadSkew(input.quad);
  if (isQuadSkewed(skew)) return cue("tilted", mode, locale);

  const widthFraction = computeQuadWidthFraction(input.quad, input.frameWidth);
  // V3.3 WP4 (candidate): with the last sample's status, a distance cue that
  // is up waits until the fill is well back inside the range.
  const sizeStatus = computeQuadSizeStatusWithHysteresis(
    widthFraction,
    input.previousSizeStatus,
  );
  if (sizeStatus === "too-far") return cue("too-far", mode, locale);
  if (sizeStatus === "too-close") return cue("too-close", mode, locale);

  const light: LightStatus = computeLightStatus(
    input.meanLuma,
    input.clippedFraction,
  );
  if (light === "dark") return cue("dark", mode, locale);
  if (light === "bright") return cue("bright", mode, locale);

  // The same gate the photo is judged by: a covered edge or a paper that is
  // not flat would be refused after the shutter, so the shutter must not fire.
  // After the light cues: poor light can itself cause the edge failure, so it
  // is fixed first.
  const gateCode = cueCodeForPaperGate(input.paperGate);
  if (gateCode) return cue(gateCode, mode, locale);

  // Shake and focus are different problems with different fixes: holding
  // still cannot bring a soft picture into focus, so they are told apart.
  if (!input.steady) return cue("hold-still", mode, locale);
  if (!input.sharpEnough) return cue("out-of-focus", mode, locale);

  return cue("perfect", mode, locale);
}

export interface StatusChip {
  readonly label: string;
  readonly pass: boolean;
}

export interface StatusChips {
  readonly paper: StatusChip;
  readonly steady: StatusChip;
  readonly light: StatusChip;
}

/**
 * The three always-visible status chips (`Paper 4/4`, `Steady`, `Light`) —
 * redundant with the cue line for anyone scanning rather than reading, per
 * the spec.
 */
export function computeStatusChips(
  input: CueInput,
  mode: CueCalibrationMode,
  locale: Locale,
): StatusChips {
  const words = cameraCuesCopy(locale);
  const paperPass = input.cornersSeen >= 4;
  const light = computeLightStatus(input.meanLuma, input.clippedFraction);
  return {
    paper: {
      label: (mode === "printed-sheet" ? words.sheetChip : words.paperChip)(
        input.cornersSeen,
      ),
      pass: paperPass,
    },
    // "Steady" means what the "hold-still" cue means: shake only. A soft
    // picture is the "out-of-focus" cue's business, and holding still cannot fix it.
    steady: { label: words.steadyChip, pass: input.steady },
    light: { label: words.lightChip, pass: light === "ok" },
  };
}

export { CAMERA_CONSTANTS };
