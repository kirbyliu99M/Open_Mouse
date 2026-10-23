/**
 * The paper-frame adjustment screen's logic (V3.2 F2, candidate, 未拍板), pure
 * so that every rule the screen follows is tested without a browser (the repo
 * has no DOM test library): when the entry is offered, how a drag moves a
 * corner, the keyboard steps, where the magnifier goes, the hidden-corner
 * edge marks, and when the frame may be used. `PaperAdjust.tsx` only wires
 * pointer and key events to `adjustReducer` and draws the state.
 *
 * Coordinates: corners are always in the photo's pixels (the overlay's, the
 * whole decoded photo). Pointer positions are screen (CSS) px relative to the
 * stage. `fit` converts between them.
 *
 * Why the drag is relative: a corner never jumps to where the finger lands.
 * It moves by however far the finger moves, from wherever the press began,
 * so a 48 px target does not turn into a 48 px error (R5 §5.2), and a corner
 * can be dragged with the finger beside it, or (once chosen) from anywhere on
 * the photo, like a trackpad.
 */
import type { Point2 } from "../geometry/homography";
import type { PaperSize } from "../paper/detect";
import {
  MANUAL_QUAD_LIMITS,
  checkManualQuad,
  cornerDistancesPx,
  defaultAdjustFrame,
  centredPaperFrame,
  neighbourCorners,
  solveHiddenCorner,
  type CornerIndex,
  type DefaultAdjustFrame,
  type FrameSize,
  type HiddenCornerProblem,
  type ManualQuadProblem,
  type Quad4,
} from "../paper/manualQuad";
import { orderQuadCorners } from "../paper/quad-math";
import type {
  PhotoOverlay,
  PipelineIssue,
  RunPhotoPipelineInput,
} from "../photo/pipeline";
import type { ScanSubmission } from "../../lib/contracts/measurement";
import type { ReusedFocal } from "../geometry/parallax";

/** The screen's named sizes. CSS px unless said otherwise. */
export const PAPER_ADJUST_LAYOUT = {
  /** A handle's touch target (Apple 44 pt, Android 48 dp; R5 §5.1). */
  handleTargetPx: 48,
  /** The visible ring inside it. */
  handleDotPx: 18,
  /** The magnifier's diameter. */
  magnifierPx: 128,
  /** How much the magnifier enlarges the photo as shown on screen (at least 4x, R5 E4). */
  magnifierZoom: 4,
  /** The radius around a touch point taken to be under the finger. */
  fingerRadiusPx: 28,
  /** The gap kept between the finger's disc and the magnifier. */
  fingerGapPx: 16,
  /** The magnifier keeps this far from the stage's edges. */
  edgeMarginPx: 8,
  /** One arrow-key press moves a corner by this much of the screen; Shift moves ten times as far. */
  keyStepScreenPx: 1,
  keyBigStepFactor: 10,
} as const;

// ── When the screen is offered ──────────────────────────────────────────

/**
 * Whether an error is about the paper (F7: every one of them offers the
 * adjustment, like Adobe Scan): any `PAPER_*` code, whatever the gate.
 */
export function isPaperIssue(code: string | undefined): boolean {
  return typeof code === "string" && code.startsWith("PAPER_");
}

/**
 * - `rescue`: after a failure, to place the frame by hand and measure again.
 * - `review`: a photo measured from the detector's own corners (F7; since
 *   V3.2 F15 it opens by itself before any length is shown): those corners,
 *   which may be confirmed as they are (the measurement already made is
 *   shown, nothing runs again) or moved (measured again from the moved frame).
 */
export type AdjustEntry = "rescue" | "review";

/** A frame the person placed and measured with (`manualPaperCorners`). */
export interface PlacedFrame {
  readonly corners: Quad4;
  readonly source: "adjusted" | "manual";
}

/** What `adjustEntryFor` needs to know about the result on screen. */
export type AdjustableResult =
  | { readonly kind: "none" | "processing" }
  | {
      readonly kind: "gateFailure";
      readonly errors: readonly PipelineIssue[];
      readonly overlay: PhotoOverlay | null;
      /** The frame this run was given, when the person placed one. */
      readonly placedFrame?: PlacedFrame | null;
    }
  | {
      readonly kind: "measured";
      readonly overlay: PhotoOverlay;
      readonly submission: ScanSubmission;
    };

function decodedPhoto(overlay: PhotoOverlay | null): overlay is PhotoOverlay {
  return Boolean(overlay && overlay.imageWidth > 0 && overlay.imageHeight > 0);
}

/**
 * Which adjustment, if any, the sheet offers (F7, Kirby's phone test
 * 2026-10-21, candidate: like Adobe Scan, a failed photo can always have its
 * corners fixed):
 *
 * - `rescue`: on a photo that decoded, after ANY paper failure (every
 *   `PAPER_*` code, wherever it is in the list), and after any failure of a
 *   run that measured with a frame the person placed (a hand gate that turned
 *   it back: the frame opens again where it was). Not after a hand failure
 *   on the detector's own frame (no hand found, the hand off the sheet):
 *   moving the frame cannot fix that, and the sheet's words say why.
 * - `review`: on a photo measured from the detector's own corners
 *   (`cornersSource` auto), starting from those corners. Since V3.2 F15 it
 *   is not a button on the sheet: it opens by itself (`adjustOpensDirectly`)
 *   before the sheet and its lengths are shown. (F15 also removed Kirby's
 *   `?debug=1` corner check: every confirm of `review` records it instead,
 *   `confirmCornerCheck`.)
 */
export function adjustEntryFor(result: AdjustableResult): AdjustEntry | null {
  if (result.kind === "gateFailure") {
    if (!decodedPhoto(result.overlay)) return null;
    if (result.placedFrame) return "rescue";
    return result.errors.some((e) => isPaperIssue(e.code)) ? "rescue" : null;
  }
  if (result.kind === "measured") {
    const calibration = result.submission.calibration;
    const autoCorners =
      "method" in calibration &&
      calibration.method === "paper-edge" &&
      (calibration.cornersSource ?? "auto") === "auto";
    if (!autoCorners || !result.overlay.paperCorners) return null;
    return "review";
  }
  return null;
}

/**
 * Whether an error is about the hand itself (no hand found, the hand read
 * unclearly, the hand off the sheet or tilted, fingers not straight): moving
 * the paper's frame cannot fix it. `LOW_LANDMARK_CONFIDENCE` is one (the hand
 * detection is the same photo's, whatever the frame). `HANDEDNESS_MISMATCH`
 * is not one (the hand button fixes it).
 */
export function isHandIssue(code: string | undefined): boolean {
  return (
    typeof code === "string" &&
    (code.startsWith("HAND_") ||
      code.startsWith("FINGER_") ||
      code === "LOW_LANDMARK_CONFIDENCE")
  );
}

/**
 * Whether a result opens the adjustment screen by itself, in place of its
 * sheet.
 *
 * V3.2 F15 (Kirby's phone test of preview 5, 2026-10-23, candidate: "after
 * the photo lines up, go straight into the adjustment page; once the user
 * confirms, show the calculated lengths"): a photo measured from the
 * detector's own four corners (`adjustEntryFor` is `review`) always does, so
 * no length is shown before the frame is confirmed. A photo measured with a
 * frame placed or moved by hand (`cornersSource` not auto), or with a typed
 * length, shows its sheet at once (the frame was just confirmed, or there is
 * none).
 *
 * V3.2 F14 (Kirby's phone test of preview 5, 2026-10-22, candidate): a
 * failure opens it in place of the failure sheet when it is a photo turned
 * back on the paper. Only a photo turned back on the paper (any `PAPER_*` code) with the
 * detector's own frame (no frame placed by hand yet), whose photo decoded, and
 * with no failure of the hand itself among its errors (those keep the failure
 * sheet and its reason: a frame cannot fix them). A photo taken because the
 * sheet was never found (`noSheetCapture.ts`) is such a photo whenever its
 * analysis does not find the sheet either. A frame placed by hand that is
 * turned back again shows the failure sheet, with its reason and the
 * adjustment as the secondary way on (F7), so the screen never reopens in a
 * loop.
 */
export function adjustOpensDirectly(result: AdjustableResult): boolean {
  if (result.kind === "measured") return adjustEntryFor(result) === "review";
  return (
    result.kind === "gateFailure" &&
    decodedPhoto(result.overlay) &&
    !result.placedFrame &&
    result.errors.some((e) => isPaperIssue(e.code)) &&
    !result.errors.some((e) => isHandIssue(e.code))
  );
}

/**
 * `curled` when the detector measured the sheet as not lying flat
 * (`PAPER_CURLED`, F7, candidate), `null` otherwise. A frame placed by hand
 * cannot fix that measurement error. Since F14 the adjustment screen shows no
 * line for it (Kirby: no need for multiple indicators); a frame confirmed over
 * it is remembered, and the results page says it instead (F13,
 * `paperCurledNoteFor`).
 */
export function adjustWarningFor(result: AdjustableResult): "curled" | null {
  return result.kind === "gateFailure" &&
    result.errors.some((e) => e.code === "PAPER_CURLED")
    ? "curled"
    : null;
}

/**
 * V3.2 F13 (candidate): whether the results page should add that the paper
 * may not have been flat. Only for a scan measured with a frame placed or
 * moved by hand (`cornersSource` not auto) on a photo whose sheet the
 * detector had found curled (`PAPER_CURLED`, `curledBefore`). Kept in this
 * browser only (`ScanLocalNotes`); the submission is not changed.
 */
export function paperCurledNoteFor(input: {
  readonly submission: Pick<ScanSubmission, "calibration">;
  readonly curledBefore: boolean;
}): boolean {
  if (!input.curledBefore) return false;
  const calibration = input.submission.calibration;
  return (
    "method" in calibration &&
    calibration.method === "paper-edge" &&
    (calibration.cornersSource ?? "auto") !== "auto"
  );
}

/**
 * The `paper` of the `scan_measured` event for a run: `none` with a typed
 * length (no sheet used), `adjusted` with a frame the person placed (rescue;
 * the contract has no `manual` there), else `detected`. Read when the run
 * starts, so a choice made while the photo is analysed cannot change it.
 */
export function scanMeasuredPaper(input: {
  readonly typedLength: boolean;
  readonly placedFrame: boolean;
}): "none" | "adjusted" | "detected" {
  if (input.typedLength) return "none";
  return input.placedFrame ? "adjusted" : "detected";
}

/**
 * What a run of the pipeline is given about the paper, and the `paper` its
 * `scan_measured` event records, from ONE reading of the inputs so the two
 * cannot disagree: a typed length uses no sheet (no frame either, there is
 * nothing to frame); with paper, a frame the person placed goes to the
 * pipeline (`manualPaperCorners`) and the event says `adjusted`.
 */
export function pipelinePaperInput(input: {
  readonly typedLengthMm: number | null;
  readonly paperSize: PaperSize;
  readonly manualPaperCorners?: RunPhotoPipelineInput["manualPaperCorners"];
}): {
  readonly pipeline: Pick<
    RunPhotoPipelineInput,
    "calibration" | "manualPaperCorners"
  >;
  readonly paper: "none" | "adjusted" | "detected";
} {
  const typedLength = input.typedLengthMm !== null;
  const corners = typedLength ? undefined : input.manualPaperCorners;
  return {
    pipeline: {
      calibration:
        input.typedLengthMm !== null
          ? { method: "user-length", handLengthMm: input.typedLengthMm }
          : { method: "paper-edge", paperSize: input.paperSize },
      ...(corners ? { manualPaperCorners: corners } : {}),
    },
    paper: scanMeasuredPaper({ typedLength, placedFrame: Boolean(corners) }),
  };
}

/**
 * What confirming the adjustment does, from the entry that was open and the
 * result on screen now:
 *
 * - `rerun`: a rescue on a photo still turned back, or a moved frame on a
 *   measured photo (`review`), with the file at hand: the same pipeline
 *   again, on the same file, with the frame.
 * - `none`: anything else (a `review` frame confirmed as it opened, the
 *   result changed meanwhile, no file, no entry): nothing runs, and no
 *   measurement changes; a measured photo's sheet then shows the measurement
 *   already made.
 */
export type AdjustConfirmAction =
  { readonly kind: "rerun" } | { readonly kind: "none" };

export function adjustConfirmAction(input: {
  readonly entry: AdjustEntry | null;
  readonly result: AdjustableResult;
  readonly hasFile: boolean;
  /**
   * Whether any corner is somewhere other than where the screen opened it
   * (`frameMoved`). Read by `review` only (F7): a frame confirmed as it opened
   * changes nothing (`none`: the measurement on screen stays, `cornersSource`
   * auto and the submission exactly as they were); a moved one measures again
   * (`rerun`, `cornersSource` adjusted).
   */
  readonly moved?: boolean;
}): AdjustConfirmAction {
  const { entry, result } = input;
  if (entry === "rescue" && result.kind === "gateFailure" && input.hasFile)
    return { kind: "rerun" };
  if (
    entry === "review" &&
    result.kind === "measured" &&
    input.hasFile &&
    input.moved === true
  )
    return { kind: "rerun" };
  return { kind: "none" };
}

/**
 * The corner record a confirm writes to this device's attempt log (V3.2 F15,
 * in place of the `?debug=1` corner check, candidate): on the screen that
 * opened by itself on a measured photo (`review`), how far each confirmed
 * corner is from the detector's own (`cornerCheckDistances`, photo px; all
 * zero when nothing moved) and the photo's long edge. `null` for any other
 * entry or a result with no detector corners. Never sent anywhere: only the
 * local attempt log reads it. The magnifier is always on (its switch went
 * with the corner check).
 */
export function confirmCornerCheck(input: {
  readonly entry: AdjustEntry | null;
  readonly result: AdjustableResult;
  readonly corners: Quad4;
}): {
  readonly magnifier: true;
  readonly distancesPx: readonly [number, number, number, number];
  readonly imageLongEdgePx: number | null;
} | null {
  const { entry, result } = input;
  if (entry !== "review" || result.kind !== "measured") return null;
  const detected = result.overlay.paperCorners;
  if (!detected) return null;
  const longEdge = Math.max(
    result.overlay.imageWidth,
    result.overlay.imageHeight,
  );
  return {
    magnifier: true,
    distancesPx: cornerCheckDistances(input.corners, detected),
    imageLongEdgePx:
      Number.isFinite(longEdge) && longEdge > 0 ? longEdge : null,
  };
}

/** Whether any corner is now somewhere other than where the screen opened it. */
export function frameMoved(
  state: Pick<AdjustState, "corners" | "start">,
): boolean {
  return state.corners.some((c, i) => {
    const from = state.start.corners[i as CornerIndex];
    return c.x !== from.x || c.y !== from.y;
  });
}

// ── The focal length a placed frame keeps (F10 item 2) ─────────────────

/**
 * The focal length of a photo's automatic run that a frame placed on the same
 * photo may keep (R6 F1, candidate 未拍板): EXIF, the homography estimate
 * the run judged reliable, or (landmark-raw-v3) the nominal prior, with a
 * finite positive value. `null` for none (`source` none: the placed frame
 * then measures exactly as before).
 */
export function reusableFocal(
  focal:
    { readonly source: string; readonly px: number | null } | null | undefined,
): ReusedFocal | null {
  if (
    !focal ||
    (focal.source !== "exif" &&
      focal.source !== "homography" &&
      focal.source !== "nominal")
  )
    return null;
  const px = focal.px;
  if (px === null || !Number.isFinite(px) || !(px > 0)) return null;
  return { fPx: px, source: focal.source };
}

/**
 * What a run is told to reuse: only a run with a placed frame, and only the
 * focal length of the automatic run of the very same file (a new photo has its
 * own lens settings and its own run).
 */
export function reusedFocalFor<F>(input: {
  readonly placedFrame: boolean;
  readonly file: F;
  readonly auto: { readonly file: F; readonly focal: ReusedFocal } | null;
}): ReusedFocal | null {
  if (!input.placedFrame || !input.auto) return null;
  return input.auto.file === input.file ? input.auto.focal : null;
}

// ── Fitting the photo on screen ─────────────────────────────────────────

export interface PhotoFit {
  /** Screen px per photo px. */
  readonly scale: number;
  /** Where the photo's top-left corner is on the stage. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** The photo's size on screen. */
  readonly width: number;
  readonly height: number;
}

/**
 * The whole photo, as large as fits in `box` less `inset` on every side
 * (object-fit: contain), centred. The inset keeps a handle on a corner at the
 * photo's very edge whole and reachable.
 */
export function fitPhoto(
  image: FrameSize,
  box: FrameSize,
  inset = 0,
): PhotoFit {
  const room = { width: box.width - 2 * inset, height: box.height - 2 * inset };
  if (!(
    image.width > 0 &&
    image.height > 0 &&
    room.width > 0 &&
    room.height > 0
  )) {
    return { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
  }
  const scale = Math.min(room.width / image.width, room.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    scale,
    offsetX: (box.width - width) / 2,
    offsetY: (box.height - height) / 2,
    width,
    height,
  };
}

export function toScreen(p: Point2, fit: PhotoFit): Point2 {
  return { x: fit.offsetX + p.x * fit.scale, y: fit.offsetY + p.y * fit.scale };
}

export function toImage(p: Point2, fit: PhotoFit): Point2 {
  return {
    x: (p.x - fit.offsetX) / fit.scale,
    y: (p.y - fit.offsetY) / fit.scale,
  };
}

// ── The state ────────────────────────────────────────────────────────────

export type PointerKind = "touch" | "mouse" | "pen";

export interface DragState {
  readonly index: CornerIndex;
  readonly pointerId: number;
  readonly pointerType: PointerKind;
  /** Where the press began and where the pointer is now (screen px). */
  readonly startPointer: Point2;
  readonly pointer: Point2;
  /** Where the corner was when the press began (photo px). */
  readonly startCorner: Point2;
  /**
   * Whether the pointer has left `startPointer` at any time in this drag. Once
   * it has, the corner follows it exactly, back to `startCorner` when the
   * pointer comes back to where it pressed.
   */
  readonly moved: boolean;
  /**
   * Whether the press began on this corner's handle (`pointerDown` named it),
   * not on the photo dragging the chosen corner.
   */
  readonly onHandle: boolean;
  /** The frame as it was when the press began, for `dragCancel` (F10). */
  readonly before: {
    readonly corners: Quad4;
    readonly placed: readonly [boolean, boolean, boolean, boolean];
    readonly solved: readonly [boolean, boolean, boolean, boolean];
    readonly notice: AdjustNotice | null;
  };
}

export interface EdgeMarkState {
  /** The hidden corner being worked out. */
  readonly index: CornerIndex;
  /** The points marked so far (photo px): first on the edge to the previous corner, then the next. */
  readonly points: readonly Point2[];
}

export type AdjustNotice =
  | { readonly kind: "edgeSolved"; readonly index: CornerIndex }
  | { readonly kind: "edgeProblem"; readonly problem: HiddenCornerProblem }
  | { readonly kind: "chooseCorner" }
  /**
   * The hidden corner's edges are worked out from its two neighbours, so both
   * must be placed first (a starting guess is not on the paper's corner):
   * `missing` is one that is not.
   */
  | {
      readonly kind: "placeNeighboursFirst";
      readonly index: CornerIndex;
      readonly missing: CornerIndex;
    }
  /** A neighbour of a worked-out corner moved, so that corner is no longer placed. */
  | { readonly kind: "edgeUndone"; readonly index: CornerIndex };

export interface AdjustState {
  readonly entry: AdjustEntry;
  readonly image: FrameSize;
  /** The sheet's size, for the centred frame (`centre`, F10). */
  readonly paperSize: PaperSize;
  /** The frame the screen opened with (`reset` goes back to it). */
  readonly start: DefaultAdjustFrame;
  readonly corners: Quad4;
  /**
   * Whether a corner may be used as it is (`openingPlaced`, F14): every
   * corner of a frame with any clue opens placed; a corner of the centred
   * frame is placed once the person moved, nudged or worked it out. A
   * worked-out corner whose neighbour then moved is not placed any more.
   */
  readonly placed: readonly [boolean, boolean, boolean, boolean];
  /**
   * A corner worked out from its two neighbours' edges (`edgeTap`). It holds
   * only while both neighbours stay where they were: when either moves, the
   * corner goes back to not placed (`withCorner`), to be worked out again or
   * dragged.
   */
  readonly solved: readonly [boolean, boolean, boolean, boolean];
  readonly selected: CornerIndex | null;
  readonly drag: DragState | null;
  readonly edge: EdgeMarkState | null;
  readonly notice: AdjustNotice | null;
}

const NONE_SOLVED = [false, false, false, false] as const;
const ALL_PLACED = [true, true, true, true] as const;

/**
 * Which corners a frame opens with as placed (V3.2 F14, Kirby's phone test of
 * preview 5, 2026-10-22: "its auto fit may be correct, so you don't have to
 * force the user to manually adjust every corner", candidate): all four,
 * whatever the frame came from (the detector's corners, three found and the
 * fourth worked out, the rough quad around the bright region, a frame placed
 * before), so the person may confirm at once and drag only what is off. Only
 * the centred sheet, which knows nothing of where the paper is, keeps every
 * corner to be moved, so it is never measured with as it opened. (A frame
 * placed before by hand where the detector had none also has `from`
 * `centred`, but its corners are marked detected: it opens placed.)
 */
export function openingPlaced(
  start: DefaultAdjustFrame,
): readonly [boolean, boolean, boolean, boolean] {
  // The centred sheet has no clue to trust, and the fourth corner of a
  // three-corner find starts deliberately inside the sheet (`isGuessedCorner`):
  // neither is an automatic fit, so those corners still need a move (Claude's
  // call on F14, 2026-10-22). Every other corner opens placed.
  return start.from === "centred" || start.from === "partial"
    ? start.detected
    : ALL_PLACED;
}

/**
 * The opening state:
 *
 * - `rescue` after a run with a frame the person placed (`previous`): that
 *   frame again, every corner placed (F7: the corners are kept). Its source
 *   stays what it was: a frame first placed from the detector's corners is
 *   `adjusted`, one placed where it had none `manual`.
 * - otherwise (`rescue`, `review`) the best guess there is
 *   (`defaultAdjustFrame`): for `review`, the four corners it measured with;
 *   after a failure, the corners it found, else its rough quad around the
 *   bright region (`paperGuessCorners`, F10: also after `PAPER_NOT_FOUND`,
 *   which F7 opened on the centred sheet), else the centred sheet. Every
 *   corner opens placed except on the centred sheet and the inferred fourth
 *   corner of a three-corner find (`openingPlaced`, F14).
 */
export function startAdjust(input: {
  readonly entry: AdjustEntry;
  readonly overlay: PhotoOverlay;
  readonly paperSize: PaperSize;
  /** The frame the run on screen was given, when the person placed one. */
  readonly previous?: PlacedFrame | null;
}): AdjustState {
  const image = {
    width: input.overlay.imageWidth,
    height: input.overlay.imageHeight,
  };
  const previous =
    input.entry === "rescue" &&
    input.previous &&
    checkManualQuad(input.previous.corners, image).ok
      ? input.previous
      : null;
  const start: DefaultAdjustFrame = previous
    ? {
        corners: [
          { ...previous.corners[0] },
          { ...previous.corners[1] },
          { ...previous.corners[2] },
          { ...previous.corners[3] },
        ],
        detected: [true, true, true, true],
        // `adjustReadiness` reads the source off `from`: "detected" is
        // adjusted, anything else manual.
        from: previous.source === "adjusted" ? "detected" : "centred",
      }
    : defaultAdjustFrame({
        corners: input.overlay.paperCorners ?? null,
        partialCorners: input.overlay.paperPartialCorners ?? null,
        guessCorners:
          input.entry === "rescue"
            ? (input.overlay.paperGuessCorners ?? null)
            : null,
        image,
        paperSize: input.paperSize,
      });
  return {
    entry: input.entry,
    image,
    paperSize: input.paperSize,
    start,
    corners: start.corners,
    placed: openingPlaced(start),
    solved: NONE_SOLVED,
    selected: null,
    drag: null,
    edge: null,
    notice: null,
  };
}

export type AdjustAction =
  | { readonly type: "select"; readonly index: CornerIndex }
  /** A press on a handle (`index`) or on the photo (`index: null`: drags the chosen corner). */
  | {
      readonly type: "pointerDown";
      readonly index: CornerIndex | null;
      readonly pointerId: number;
      readonly pointerType: PointerKind;
      readonly point: Point2;
    }
  | {
      readonly type: "pointerMove";
      readonly pointerId: number;
      readonly point: Point2;
      /** Screen px per photo px at this moment. */
      readonly scale: number;
    }
  | { readonly type: "pointerUp"; readonly pointerId: number }
  | {
      readonly type: "nudge";
      readonly index: CornerIndex;
      readonly dx: -1 | 0 | 1;
      readonly dy: -1 | 0 | 1;
      readonly big: boolean;
      readonly scale: number;
    }
  | { readonly type: "edgeStart" }
  /** A tap on the photo while marking edges (photo px). */
  | { readonly type: "edgeTap"; readonly point: Point2 }
  | { readonly type: "edgeCancel" }
  | { readonly type: "reset" }
  /**
   * F10 (rescue only): start again from the centred sheet, every corner not
   * placed, for when the opening guess is plainly wrong. It becomes the
   * opening frame (`reset` then goes back to it).
   */
  | { readonly type: "centre" }
  /**
   * F10: a second finger came down during a corner drag (a pinch begins): the
   * corner goes back to where the drag started, as if it never moved.
   */
  | { readonly type: "dragCancel" };

/**
 * A dragged or nudged corner may go past the photo's edge (F10, R6 F2: a sheet
 * corner just out of frame), as far as `checkManualQuad` allows
 * (`MANUAL_QUAD_LIMITS.maxOutsideFraction` of the photo's width or height),
 * and no further. Clamping it to the edge instead widened the palm by 1.0 mm
 * with the corner 2 % out (R6 E3, simulated).
 */
export function clampToAllowed(p: Point2, image: FrameSize): Point2 {
  const mx = image.width * MANUAL_QUAD_LIMITS.maxOutsideFraction;
  const my = image.height * MANUAL_QUAD_LIMITS.maxOutsideFraction;
  return {
    x: Math.min(image.width + mx, Math.max(-mx, p.x)),
    y: Math.min(image.height + my, Math.max(-my, p.y)),
  };
}

/**
 * Whether `index` is the corner the detector did not find while it found the
 * other three: its start is only a guess inside the sheet.
 */
export function isGuessedCorner(
  state: Pick<AdjustState, "start">,
  index: CornerIndex,
): boolean {
  return state.start.from === "partial" && !state.start.detected[index];
}

/**
 * `index` moved to `corner` and is placed. `solved` says whether it was worked
 * out from its edges (else the person put it there). A worked-out neighbour
 * of it was found from where `index` was, so it goes back to not placed, and
 * the notice says so.
 */
function withCorner(
  state: AdjustState,
  index: CornerIndex,
  corner: Point2,
  solvedNow = false,
): AdjustState {
  const before = state.corners[index];
  const corners = [...state.corners] as [Point2, Point2, Point2, Point2];
  corners[index] = corner;
  const placed = [...state.placed] as [boolean, boolean, boolean, boolean];
  placed[index] = true;
  const solved = [...state.solved] as [boolean, boolean, boolean, boolean];
  solved[index] = solvedNow;
  let notice = state.notice;
  if (before.x !== corner.x || before.y !== corner.y) {
    for (const n of neighbourCorners(index)) {
      if (!solved[n]) continue;
      solved[n] = false;
      placed[n] = false;
      notice = { kind: "edgeUndone", index: n };
    }
  }
  return { ...state, corners, placed, solved, notice };
}

/** A neighbour of `index` that is not placed, or `null` when both are. */
function unplacedNeighbour(
  state: AdjustState,
  index: CornerIndex,
): CornerIndex | null {
  for (const n of neighbourCorners(index)) if (!state.placed[n]) return n;
  return null;
}

/** Every change the screen makes, as one pure function. */
export function adjustReducer(
  state: AdjustState,
  action: AdjustAction,
): AdjustState {
  switch (action.type) {
    case "select":
      // Only chooses the corner (F14: a tap confirms nothing any more; every
      // corner of a frame with a clue opens placed, `openingPlaced`).
      return { ...state, selected: action.index, notice: null };
    case "pointerDown": {
      if (state.drag) return state; // one pointer at a time
      const index = action.index ?? state.selected;
      if (index === null) return { ...state, notice: { kind: "chooseCorner" } };
      return {
        ...state,
        selected: index,
        notice: null,
        drag: {
          index,
          pointerId: action.pointerId,
          pointerType: action.pointerType,
          startPointer: action.point,
          pointer: action.point,
          startCorner: state.corners[index],
          moved: false,
          onHandle: action.index !== null,
          before: {
            corners: state.corners,
            placed: state.placed,
            solved: state.solved,
            notice: state.notice,
          },
        },
      };
    }
    case "pointerMove": {
      const drag = state.drag;
      if (!drag || drag.pointerId !== action.pointerId || !(action.scale > 0))
        return state;
      const corner = clampToAllowed(
        {
          x:
            drag.startCorner.x +
            (action.point.x - drag.startPointer.x) / action.scale,
          y:
            drag.startCorner.y +
            (action.point.y - drag.startPointer.y) / action.scale,
        },
        state.image,
      );
      // A press that has not moved yet changes nothing (a tap only selects);
      // once it has moved, the corner is always start + movement, including
      // a return to the very point where the press began.
      const moved =
        drag.moved ||
        action.point.x !== drag.startPointer.x ||
        action.point.y !== drag.startPointer.y;
      const next = {
        ...state,
        drag: { ...drag, pointer: action.point, moved },
      };
      return moved ? withCorner(next, drag.index, corner) : next;
    }
    case "pointerUp": {
      const drag = state.drag;
      if (drag?.pointerId !== action.pointerId) return state;
      return { ...state, drag: null };
    }
    case "nudge": {
      if (!(action.scale > 0) || (action.dx === 0 && action.dy === 0))
        return state;
      const step =
        (PAPER_ADJUST_LAYOUT.keyStepScreenPx *
          (action.big ? PAPER_ADJUST_LAYOUT.keyBigStepFactor : 1)) /
        action.scale;
      const c = state.corners[action.index];
      return withCorner(
        { ...state, selected: action.index, notice: null },
        action.index,
        clampToAllowed(
          { x: c.x + action.dx * step, y: c.y + action.dy * step },
          state.image,
        ),
      );
    }
    case "edgeStart": {
      if (state.selected === null)
        return { ...state, notice: { kind: "chooseCorner" } };
      const missing = unplacedNeighbour(state, state.selected);
      if (missing !== null)
        return {
          ...state,
          edge: null,
          notice: {
            kind: "placeNeighboursFirst",
            index: state.selected,
            missing,
          },
        };
      return {
        ...state,
        drag: null,
        edge: { index: state.selected, points: [] },
        notice: null,
      };
    }
    case "edgeTap": {
      const edge = state.edge;
      if (!edge) return state;
      // A neighbour may have stopped being placed since the marks began.
      const missing = unplacedNeighbour(state, edge.index);
      if (missing !== null)
        return {
          ...state,
          edge: null,
          notice: { kind: "placeNeighboursFirst", index: edge.index, missing },
        };
      const points = [...edge.points, action.point];
      if (points.length < 2)
        return { ...state, edge: { ...edge, points }, notice: null };
      const [prev, next] = neighbourCorners(edge.index);
      const solved = solveHiddenCorner({
        edgeA: { from: state.corners[prev], points: [points[0]] },
        edgeB: { from: state.corners[next], points: [points[1]] },
        image: state.image,
      });
      if (!solved.ok)
        // The corner is left where it was; the marks start again.
        return {
          ...state,
          edge: { index: edge.index, points: [] },
          notice: { kind: "edgeProblem", problem: solved.problem },
        };
      return {
        ...withCorner(state, edge.index, solved.corner, true),
        edge: null,
        notice: { kind: "edgeSolved", index: edge.index },
      };
    }
    case "edgeCancel":
      return { ...state, edge: null, notice: null };
    case "centre": {
      if (state.entry !== "rescue") return state;
      const start: DefaultAdjustFrame = {
        corners: centredPaperFrame(state.image, state.paperSize),
        detected: [false, false, false, false],
        from: "centred",
      };
      return {
        ...state,
        start,
        corners: start.corners,
        placed: start.detected,
        solved: NONE_SOLVED,
        selected: null,
        drag: null,
        edge: null,
        notice: null,
      };
    }
    case "dragCancel": {
      const drag = state.drag;
      if (!drag) return state;
      return {
        ...state,
        corners: drag.before.corners,
        placed: drag.before.placed,
        solved: drag.before.solved,
        notice: drag.before.notice,
        drag: null,
      };
    }
    case "reset":
      return {
        ...state,
        corners: state.start.corners,
        placed: openingPlaced(state.start),
        solved: NONE_SOLVED,
        selected: null,
        drag: null,
        edge: null,
        notice: null,
      };
  }
}

/** The arrow keys, as (dx, dy) on screen. */
export const KEY_DIRECTIONS: Readonly<
  Record<string, readonly [-1 | 0 | 1, -1 | 0 | 1]>
> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The action a key press on the handle of `index` makes: an arrow key nudges
 * it (Shift: the big step) at the photo's current on-screen scale; any other
 * key makes none.
 */
export function nudgeForKey(input: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly index: CornerIndex;
  readonly fit: PhotoFit;
}): Extract<AdjustAction, { type: "nudge" }> | null {
  const direction = Object.prototype.hasOwnProperty.call(
    KEY_DIRECTIONS,
    input.key,
  )
    ? KEY_DIRECTIONS[input.key]
    : undefined;
  if (!direction) return null;
  return {
    type: "nudge",
    index: input.index,
    dx: direction[0],
    dy: direction[1],
    big: input.shiftKey,
    scale: input.fit.scale,
  };
}

/** The action a pointer move on the stage makes, at the photo's current on-screen scale. */
export function pointerMoveFor(input: {
  readonly pointerId: number;
  readonly point: Point2;
  readonly fit: PhotoFit;
}): Extract<AdjustAction, { type: "pointerMove" }> {
  return {
    type: "pointerMove",
    pointerId: input.pointerId,
    point: input.point,
    scale: input.fit.scale,
  };
}

/** The corner the marked points belong to, and which neighbour's edge the next tap is on. */
export function edgeStepOf(edge: EdgeMarkState): {
  readonly step: 1 | 2;
  readonly other: CornerIndex;
} {
  const [prev, next] = neighbourCorners(edge.index);
  return edge.points.length === 0
    ? { step: 1, other: prev }
    : { step: 2, other: next };
}

// ── Whether the frame may be used ───────────────────────────────────────

export type AdjustReadiness =
  | {
      readonly ok: true;
      readonly corners: Quad4;
      /** `adjusted`: started from the detector's four corners. `manual`: some corner was placed where the detector had none. */
      readonly source: "adjusted" | "manual";
    }
  | { readonly ok: false; readonly notPlaced: CornerIndex }
  | { readonly ok: false; readonly problem: ManualQuadProblem };

/**
 * The frame can be used once every corner is placed (a starting guess must be
 * moved, R5 E2: a guessed corner is biased) and it passes `checkManualQuad`.
 * The detector's corners count as placed: confirming them unchanged is
 * allowed ("the frame looks right", R5 §0).
 */
export function adjustReadiness(state: AdjustState): AdjustReadiness {
  const notPlaced = state.placed.indexOf(false);
  if (notPlaced >= 0) return { ok: false, notPlaced: notPlaced as CornerIndex };
  const check = checkManualQuad(state.corners, state.image);
  if (!check.ok) return { ok: false, problem: check.problem };
  return {
    ok: true,
    corners: state.corners,
    source: state.start.from === "detected" ? "adjusted" : "manual",
  };
}

// ── Zoom and pan (F10) ──────────────────────────────────────────────────
//
// Kirby's second phone test (2026-10-21/22): 「手動調整後要放大」. The screen
// opens zoomed so the frame it starts with fills the stage (with room for the
// handles), two fingers zoom and move the photo, one finger still drags a
// corner, and a double tap or a button shows the whole photo. A view is only
// how the photo is shown: it is a `PhotoFit` like the whole-photo one
// (`fitPhoto`), so `toScreen` / `toImage` convert through it unchanged, and
// the corners stay in the photo's pixels whatever the zoom.

/** The view's named limits (candidates). */
export const PAPER_ADJUST_VIEW = {
  /** The closest zoom, as a multiple of the whole-photo scale. */
  maxZoom: 6,
  /**
   * Room kept between the frame's outermost corners and the stage's edge when
   * the view opens on the frame, beyond half a handle (so every handle is
   * whole, reachable, and has some photo around it to drag into).
   */
  sheetMarginPx: 24,
  /** Two taps on the photo this close in time (ms) and place (px) are a double tap. */
  doubleTapMs: 300,
  doubleTapPx: 24,
  /** A mouse wheel's zoom: the factor per 100 px of scroll. */
  wheelFactorPer100Px: 1.25,
} as const;

/**
 * The whole photo and the band around it where a corner may lie
 * (`maxOutsideFraction`, F2), inset by half a handle: the view a double tap
 * goes back to. Fitting the band too keeps a corner dragged off the photo on
 * the stage, with its handle whole (review of F10: fitting the photo alone
 * put such a handle past the stage's clipped edge).
 */
export function wholeView(image: FrameSize, stage: FrameSize): PhotoFit {
  const out = MANUAL_QUAD_LIMITS.maxOutsideFraction;
  const fit = fitPhoto(
    {
      width: image.width * (1 + 2 * out),
      height: image.height * (1 + 2 * out),
    },
    stage,
    PAPER_ADJUST_LAYOUT.handleTargetPx / 2,
  );
  if (fit.width === 0) return fit;
  // Centred, written as `clampView` centres an axis, so that clamping the
  // whole view gives it back exactly.
  return viewAt(
    image,
    fit.scale,
    (stage.width - image.width * fit.scale) / 2,
    (stage.height - image.height * fit.scale) / 2,
  );
}

function viewAt(
  image: FrameSize,
  scale: number,
  offsetX: number,
  offsetY: number,
): PhotoFit {
  return {
    scale,
    offsetX,
    offsetY,
    width: image.width * scale,
    height: image.height * scale,
  };
}

/**
 * A view kept sensible: its scale between the whole photo's and `maxZoom`
 * times that; along each axis the photo is centred while it (with the band
 * beyond it and the handle inset) fits on the stage, and otherwise it may be
 * moved only so far that the
 * stage still shows the photo or the band beyond it where a corner may lie
 * (`maxOutsideFraction`), never empty space past that.
 */
export function clampView(
  view: PhotoFit,
  image: FrameSize,
  stage: FrameSize,
): PhotoFit {
  const base = wholeView(image, stage);
  if (!(base.scale > 0)) return base;
  const scale = Math.min(
    Math.max(view.scale, base.scale),
    base.scale * PAPER_ADJUST_VIEW.maxZoom,
  );
  const inset = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;
  const out = MANUAL_QUAD_LIMITS.maxOutsideFraction;
  const axis = (offset: number, length: number, room: number) => {
    const drawn = length * scale;
    const band = length * out * scale;
    // The photo and its band on both sides fit: centred (as the whole view).
    // (A rounding margin: the whole view fills one axis exactly.)
    if (drawn + 2 * band + 2 * inset <= room + 1e-9) return (room - drawn) / 2;
    const lo = room - inset - drawn - band;
    const hi = inset + band;
    return Math.min(Math.max(offset, lo), hi);
  };
  return viewAt(
    image,
    scale,
    axis(view.offsetX, image.width, stage.width),
    axis(view.offsetY, image.height, stage.height),
  );
}

/**
 * The view the screen opens with (F10): the frame's four corners filling the
 * stage, `sheetMarginPx` plus half a handle from its edges, centred, never
 * smaller than the whole photo nor closer than `maxZoom`.
 */
export function sheetView(
  image: FrameSize,
  stage: FrameSize,
  quad: Quad4,
): PhotoFit {
  const base = wholeView(image, stage);
  if (!(base.scale > 0)) return base;
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return base;
  const pad =
    PAPER_ADJUST_LAYOUT.handleTargetPx / 2 + PAPER_ADJUST_VIEW.sheetMarginPx;
  const roomW = stage.width - 2 * pad;
  const roomH = stage.height - 2 * pad;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const target =
    roomW > 0 && roomH > 0 ? Math.min(roomW / bw, roomH / bh) : base.scale;
  const scale = Math.min(
    Math.max(target, base.scale),
    base.scale * PAPER_ADJUST_VIEW.maxZoom,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return clampView(
    viewAt(
      image,
      scale,
      stage.width / 2 - cx * scale,
      stage.height / 2 - cy * scale,
    ),
    image,
    stage,
  );
}

/** Whether a view shows the whole photo (as a double tap leaves it). */
export function isWholeView(
  view: PhotoFit,
  image: FrameSize,
  stage: FrameSize,
): boolean {
  const base = wholeView(image, stage);
  return Math.abs(view.scale - base.scale) <= base.scale * 1e-6;
}

/** `view` zoomed by `factor` about the screen point `at` (a wheel, a button): the photo point under it stays under it. */
export function zoomViewAt(
  view: PhotoFit,
  factor: number,
  at: Point2,
  image: FrameSize,
  stage: FrameSize,
): PhotoFit {
  if (!(factor > 0) || !(view.scale > 0)) return view;
  const p = toImage(at, view);
  const base = wholeView(image, stage);
  const scale = Math.min(
    Math.max(view.scale * factor, base.scale),
    base.scale * PAPER_ADJUST_VIEW.maxZoom,
  );
  return clampView(
    viewAt(image, scale, at.x - p.x * scale, at.y - p.y * scale),
    image,
    stage,
  );
}

/**
 * Two fingers (F10): from the view when they came down (`start`, with both
 * fingers' points then) to where they are now. The distance between them
 * scales the photo, their midpoint carries it: the photo point that was under
 * the starting midpoint is under the current one.
 */
export function pinchView(input: {
  readonly start: PhotoFit;
  readonly from: readonly [Point2, Point2];
  readonly to: readonly [Point2, Point2];
  readonly image: FrameSize;
  readonly stage: FrameSize;
}): PhotoFit {
  const { start, from, to } = input;
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  const factor = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  const mid0 = {
    x: (from[0].x + from[1].x) / 2,
    y: (from[0].y + from[1].y) / 2,
  };
  const mid1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  if (!(start.scale > 0)) return start;
  const p = toImage(mid0, start);
  const base = wholeView(input.image, input.stage);
  const scale = Math.min(
    Math.max(start.scale * factor, base.scale),
    base.scale * PAPER_ADJUST_VIEW.maxZoom,
  );
  return clampView(
    viewAt(input.image, scale, mid1.x - p.x * scale, mid1.y - p.y * scale),
    input.image,
    input.stage,
  );
}

/** A tap on the photo: when and where. */
export interface StageTap {
  readonly at: number;
  readonly point: Point2;
}

/** Whether `now` is the second tap of a double tap after `previous` (F10). */
export function isDoubleTap(previous: StageTap | null, now: StageTap): boolean {
  if (!previous) return false;
  const dt = now.at - previous.at;
  return (
    dt >= 0 &&
    dt <= PAPER_ADJUST_VIEW.doubleTapMs &&
    Math.hypot(
      now.point.x - previous.point.x,
      now.point.y - previous.point.y,
    ) <= PAPER_ADJUST_VIEW.doubleTapPx
  );
}

/** The mouse wheel's zoom factor for a scroll of `deltaY` px (up zooms in). */
export function wheelZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 1;
  return Math.pow(PAPER_ADJUST_VIEW.wheelFactorPer100Px, -deltaY / 100);
}

// ── Names, the magnifier, the corner check ──────────────────────────────

/**
 * Which on-screen position (0 top-left, 1 top-right, 2 bottom-right, 3
 * bottom-left) each corner is at now, so a handle is named for where it is,
 * whatever its index.
 */
export function cornerPositions(
  corners: Quad4,
): readonly [number, number, number, number] {
  const ordered = orderQuadCorners([
    corners[0],
    corners[1],
    corners[2],
    corners[3],
  ]);
  const out = [0, 1, 2, 3].map((i) => ordered.indexOf(corners[i]));
  // Two corners on the same point: fall back to the index itself.
  return new Set(out).size === 4 && out.every((n) => n >= 0)
    ? (out as unknown as [number, number, number, number])
    : [0, 1, 2, 3];
}

export interface MagnifierLayout {
  /** Top-left of the magnifier on the stage (screen px). */
  readonly left: number;
  readonly top: number;
  readonly size: number;
  /** The photo as the magnifier's background: its drawn size and its offset. */
  readonly backgroundWidth: number;
  readonly backgroundHeight: number;
  readonly backgroundX: number;
  readonly backgroundY: number;
  /** Which side of the pointer it went to. */
  readonly side: MagnifierSide;
}

export type MagnifierSide = "above" | "left" | "right" | "below";

/** Where the magnifier is: what the next frame's placement is given back (`magnifierPlacement`). */
export interface MagnifierPlacement {
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly side: MagnifierSide;
}

/**
 * The magnifier's edge rules (F10, Kirby's second phone test 2026-10-21/22:
 * 「放大鏡會左右跳動，要溢出邊界一些些，緩衝後再切換」), candidates:
 *
 * - `overflowPx`: it may run past the stage's edge by at most this much (it is
 *   clipped there), rather than jump to the other side.
 * - `switchPx`: it keeps the side it is on until staying there would put it
 *   more than this far past the edge (hysteresis); only then does it change
 *   side. Coming back above the finger (the side preferred, the hand holding
 *   the phone is below) needs the same room to spare.
 */
export const MAGNIFIER_EDGE = {
  overflowPx: 12,
  switchPx: 24,
} as const;

/** The diameters tried, largest first. */
const MAGNIFIER_SIZES = [
  PAPER_ADJUST_LAYOUT.magnifierPx,
  112,
  96,
  80,
  64,
] as const;

/** A magnifier of `size` on `side` of the pointer, clear of the finger, before any clamping. */
function naturalBox(
  pointer: Point2,
  size: number,
  side: MagnifierSide,
): { left: number; top: number } {
  const L = PAPER_ADJUST_LAYOUT;
  const clear = L.fingerRadiusPx + L.fingerGapPx + size / 2;
  const { x, y } = pointer;
  switch (side) {
    case "above":
      return { left: x - size / 2, top: y - clear - size / 2 };
    case "below":
      return { left: x - size / 2, top: y + clear - size / 2 };
    case "left":
      return { left: x - clear - size / 2, top: y - size / 2 };
    case "right":
      return { left: x + clear - size / 2, top: y - size / 2 };
  }
}

/**
 * How far past the stage's edge the box would go on its own side's axis (the
 * axis it was moved along to clear the finger); 0 when it is inside. The
 * other axis is only clamped, which moves it away from the finger, never
 * under it.
 */
function ownOverflow(
  box: { left: number; top: number },
  size: number,
  side: MagnifierSide,
  stage: FrameSize,
): number {
  switch (side) {
    case "above":
      return Math.max(0, -box.top);
    case "below":
      return Math.max(0, box.top + size - stage.height);
    case "left":
      return Math.max(0, -box.left);
    case "right":
      return Math.max(0, box.left + size - stage.width);
  }
}

/** Free room between the box and the stage's edge on its own side (negative past the edge). */
function ownRoom(
  box: { left: number; top: number },
  size: number,
  side: MagnifierSide,
  stage: FrameSize,
): number {
  switch (side) {
    case "above":
      return box.top;
    case "below":
      return stage.height - (box.top + size);
    case "left":
      return box.left;
    case "right":
      return stage.width - (box.left + size);
  }
}

/** The box kept within `overflowPx` of the stage on both axes. */
function clampBox(
  box: { left: number; top: number },
  size: number,
  side: MagnifierSide,
  stage: FrameSize,
): MagnifierPlacement {
  const o = MAGNIFIER_EDGE.overflowPx;
  const clampTo = (v: number, lo: number, hi: number) =>
    hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
  return {
    left: clampTo(box.left, -o, stage.width + o - size),
    top: clampTo(box.top, -o, stage.height + o - size),
    size,
    side,
  };
}

/**
 * Where the magnifier goes for a pointer (F10, pure): the side it was on last
 * frame (`previous`) while that side stays within `switchPx` of the edge;
 * otherwise (or on the first frame) above the finger, else beside it on the
 * roomier side, else below, each allowed to run `overflowPx` past the edge,
 * at the largest size that fits; and from beside or below it goes back above
 * only once above has `switchPx` to spare. So a finger moving back and forth
 * near an edge, or across the middle of the screen, does not make it change
 * side on every frame. It is always clear of the finger's disc
 * (`fingerGapPx` - `overflowPx` of gap at the least).
 */
export function magnifierPlacement(input: {
  readonly pointer: Point2;
  readonly stage: FrameSize;
  readonly previous?: MagnifierPlacement | null;
}): MagnifierPlacement {
  const { pointer, stage } = input;
  const E = MAGNIFIER_EDGE;
  const prev = input.previous ?? null;
  if (prev) {
    const size = prev.size;
    if (prev.side !== "above") {
      const above = naturalBox(pointer, size, "above");
      if (ownRoom(above, size, "above", stage) >= E.switchPx)
        return clampBox(above, size, "above", stage);
    }
    const kept = naturalBox(pointer, size, prev.side);
    if (ownOverflow(kept, size, prev.side, stage) <= E.switchPx)
      return clampBox(kept, size, prev.side, stage);
  }
  for (const size of MAGNIFIER_SIZES) {
    if (size > Math.min(stage.width, stage.height) + 2 * E.overflowPx) continue;
    const fits = (side: MagnifierSide) =>
      ownOverflow(naturalBox(pointer, size, side), size, side, stage) <=
      E.overflowPx;
    if (fits("above"))
      return clampBox(naturalBox(pointer, size, "above"), size, "above", stage);
    const right = fits("right");
    const left = fits("left");
    if (right || left) {
      const side: MagnifierSide =
        right &&
        (!left ||
          ownRoom(naturalBox(pointer, size, "right"), size, "right", stage) >=
            ownRoom(naturalBox(pointer, size, "left"), size, "left", stage))
          ? "right"
          : "left";
      return clampBox(naturalBox(pointer, size, side), size, side, stage);
    }
    if (fits("below"))
      return clampBox(naturalBox(pointer, size, "below"), size, "below", stage);
  }
  const size = MAGNIFIER_SIZES[MAGNIFIER_SIZES.length - 1];
  return clampBox(naturalBox(pointer, size, "below"), size, "below", stage);
}

/**
 * Where the magnifier goes while a corner is dragged, and what it shows.
 *
 * It shows the CORNER (not the pointer: the drag is relative), at
 * `magnifierZoom` times the photo's on-screen size (as the photo is shown
 * now, zoomed or not), centred under its crosshair. Where it goes is
 * `magnifierPlacement` (above the finger, beside it, below only as a last
 * resort; F10: with hysteresis, and up to `MAGNIFIER_EDGE.overflowPx` past
 * the stage's edge).
 */
export function magnifierLayout(input: {
  readonly pointer: Point2;
  readonly corner: Point2;
  readonly fit: PhotoFit;
  readonly stage: FrameSize;
  /** Where it was on the previous frame of this drag (F10). */
  readonly previous?: MagnifierPlacement | null;
}): MagnifierLayout {
  const { left, top, size, side } = magnifierPlacement({
    pointer: input.pointer,
    stage: input.stage,
    previous: input.previous,
  });
  const z = PAPER_ADJUST_LAYOUT.magnifierZoom;
  const cornerOnPhoto = {
    x: input.corner.x * input.fit.scale,
    y: input.corner.y * input.fit.scale,
  };
  return {
    left,
    top,
    size,
    backgroundWidth: input.fit.width * z,
    backgroundHeight: input.fit.height * z,
    backgroundX: size / 2 - cornerOnPhoto.x * z,
    backgroundY: size / 2 - cornerOnPhoto.y * z,
    side,
  };
}

/**
 * The corner record (`confirmCornerCheck`): how far each corner placed is from the detector's,
 * px in the photo, both frames ordered the same way round (`orderQuadCorners`)
 * so that a frame placed starting from another corner is still compared
 * corner to corner.
 */
export function cornerCheckDistances(
  placed: Quad4,
  detected: Quad4,
): readonly [number, number, number, number] {
  const a = orderQuadCorners([placed[0], placed[1], placed[2], placed[3]]);
  const b = orderQuadCorners([
    detected[0],
    detected[1],
    detected[2],
    detected[3],
  ]);
  return cornerDistancesPx(a, b);
}
