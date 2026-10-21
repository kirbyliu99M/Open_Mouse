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
 * - `review`: 檢查邊框 on a measured photo (F7): the detector's own corners,
 *   which may be confirmed as they are (nothing changes) or moved (measured
 *   again from the moved frame).
 * - `check`: Kirby's corner check (`?debug=1`), which changes no measurement.
 */
export type AdjustEntry = "rescue" | "review" | "check";

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
 *   (`cornersSource` auto): 檢查邊框, starting from those corners.
 * - `check`: with `?debug=1`, in place of `review` (the corner check starts
 *   from the centred sheet, so a corner left where it was cannot read as a
 *   perfect drag): Kirby's corner check, which changes no measurement.
 */
export function adjustEntryFor(
  result: AdjustableResult,
  debugOn: boolean,
): AdjustEntry | null {
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
    return debugOn ? "check" : "review";
  }
  return null;
}

/**
 * A line the adjustment screen shows before the frame is confirmed (F7,
 * candidate): `curled` when the detector measured the sheet as not lying flat
 * (`PAPER_CURLED`). A frame placed by hand cannot fix that measurement error,
 * so the person is told, and may still go on. `null` otherwise.
 */
export function adjustWarningFor(result: AdjustableResult): "curled" | null {
  return result.kind === "gateFailure" &&
    result.errors.some((e) => e.code === "PAPER_CURLED")
    ? "curled"
    : null;
}

/**
 * The first error's code the adjustment screen is opened with (F7): a
 * failure's first code (so `PAPER_NOT_FOUND` opens the centred A4 sheet at
 * 72 %, all four corners not placed, even when a partial detection left
 * corners in the overlay), nothing for a measured photo.
 */
export function adjustFirstCodeFor(
  result: AdjustableResult,
): string | undefined {
  return result.kind === "gateFailure" ? result.errors[0]?.code : undefined;
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
 * - `recordCheck`: the corner check on a measured photo with the detector's
 *   corners: record how far each placed corner is from them, nothing else.
 * - `rerun`: a rescue on a photo still turned back, with the file at hand:
 *   the same pipeline again, on the same file, with the frame.
 * - `none`: anything else (the result changed meanwhile, no file, no entry):
 *   nothing runs, and no measurement changes.
 */
export type AdjustConfirmAction =
  | { readonly kind: "recordCheck"; readonly detected: Quad4 }
  | { readonly kind: "rerun" }
  | { readonly kind: "none" };

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
  if (entry === "check") {
    const detected =
      result.kind === "measured" ? result.overlay.paperCorners : null;
    return detected ? { kind: "recordCheck", detected } : { kind: "none" };
  }
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
 * photo may keep (R6 F1, candidate 未拍板): EXIF, or the homography estimate
 * the run judged reliable, with a finite positive value. `null` for none
 * (`source` none: the placed frame then measures exactly as before).
 */
export function reusableFocal(
  focal:
    { readonly source: string; readonly px: number | null } | null | undefined,
): ReusedFocal | null {
  if (!focal || (focal.source !== "exif" && focal.source !== "homography"))
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
  /** The frame the screen opened with (`reset` goes back to it). */
  readonly start: DefaultAdjustFrame;
  readonly corners: Quad4;
  /** A corner is placed once it is the detector's own, or the person moved, nudged or worked it out. */
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

/**
 * The opening state:
 *
 * - `check` always starts from the centred sheet with nothing placed, so that
 *   a corner left where it started cannot read as a perfect drag.
 * - `rescue` after a run with a frame the person placed (`previous`): that
 *   frame again, every corner placed (F7: the corners are kept). Its source
 *   stays what it was: a frame first placed from the detector's corners is
 *   `adjusted`, one placed where it had none `manual`.
 * - `rescue` after `PAPER_NOT_FOUND` (`firstCode`): the centred sheet (72 %
 *   of the photo's width), every corner not placed, to be dragged (F7).
 * - otherwise (`rescue`, `review`) what the detector found
 *   (`defaultAdjustFrame`): for `review`, the four corners it measured with.
 */
export function startAdjust(input: {
  readonly entry: AdjustEntry;
  readonly overlay: PhotoOverlay;
  readonly paperSize: PaperSize;
  /** The frame the run on screen was given, when the person placed one. */
  readonly previous?: PlacedFrame | null;
  /** The first reason the photo was turned back. */
  readonly firstCode?: string;
}): AdjustState {
  const image = {
    width: input.overlay.imageWidth,
    height: input.overlay.imageHeight,
  };
  const centred: DefaultAdjustFrame = {
    corners: centredPaperFrame(image, input.paperSize),
    detected: [false, false, false, false],
    from: "centred",
  };
  const previous =
    input.entry === "rescue" &&
    input.previous &&
    checkManualQuad(input.previous.corners, image).ok
      ? input.previous
      : null;
  const start: DefaultAdjustFrame =
    input.entry === "check"
      ? centred
      : previous
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
        : input.entry === "rescue" && input.firstCode === "PAPER_NOT_FOUND"
          ? centred
          : defaultAdjustFrame({
              corners: input.overlay.paperCorners ?? null,
              partialCorners: input.overlay.paperPartialCorners ?? null,
              image,
              paperSize: input.paperSize,
            });
  return {
    entry: input.entry,
    image,
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
  | { readonly type: "reset" };

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
 * out from its edges (else the person put it there). A guessed corner
 * (`isGuessedCorner`) moved by hand is placed only once it is at least
 * `guessMinMoveFraction` of the photo's diagonal from its start, so a nudge
 * does not accept the guess. A worked-out neighbour of it was found from
 * where `index` was, so it goes back to not placed, and the notice says so.
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
  const from = state.start.corners[index];
  placed[index] =
    solvedNow ||
    !isGuessedCorner(state, index) ||
    Math.hypot(corner.x - from.x, corner.y - from.y) >=
      Math.hypot(state.image.width, state.image.height) *
        MANUAL_QUAD_LIMITS.guessMinMoveFraction;
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
    case "pointerUp":
      return state.drag?.pointerId === action.pointerId
        ? { ...state, drag: null }
        : state;
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
    case "reset":
      return {
        ...state,
        corners: state.start.corners,
        placed: state.start.detected,
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
  readonly side: "above" | "left" | "right" | "below";
}

interface Placement {
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly side: MagnifierLayout["side"];
}

/** The diameters tried, largest first. */
const MAGNIFIER_SIZES = [
  PAPER_ADJUST_LAYOUT.magnifierPx,
  112,
  96,
  80,
  64,
] as const;

/**
 * A place for a magnifier of `size` clear of the finger: above, else beside
 * (the roomier side), else below. `strict`: `null` when none of them fits
 * inside the stage; otherwise the last resort is clamped into it.
 */
function placeMagnifier(
  pointer: Point2,
  stage: FrameSize,
  size: number,
  strict: boolean,
): Placement | null {
  const L = PAPER_ADJUST_LAYOUT;
  const clear = L.fingerRadiusPx + L.fingerGapPx + size / 2;
  const { x, y } = pointer;
  const minX = L.edgeMarginPx;
  const maxX = stage.width - L.edgeMarginPx - size;
  const minY = L.edgeMarginPx;
  const maxY = stage.height - L.edgeMarginPx - size;
  if (maxX < minX || maxY < minY) {
    return strict
      ? null
      : {
          left: Math.max(0, minX),
          top: Math.max(0, minY),
          size,
          side: "below",
        };
  }
  const clampX = (v: number) => Math.min(Math.max(v, minX), maxX);
  const clampY = (v: number) => Math.min(Math.max(v, minY), maxY);
  const aboveTop = y - clear - size / 2;
  if (aboveTop >= minY && aboveTop <= maxY)
    return { left: clampX(x - size / 2), top: aboveTop, size, side: "above" };
  const rightLeft = x + clear - size / 2;
  const leftLeft = x - clear - size / 2;
  const fitsRight = rightLeft >= minX && rightLeft <= maxX;
  const fitsLeft = leftLeft >= minX && leftLeft <= maxX;
  if (fitsRight || fitsLeft) {
    const roomRight = maxX - rightLeft;
    const roomLeft = leftLeft - minX;
    const right = fitsRight && (!fitsLeft || roomRight >= roomLeft);
    return {
      left: right ? rightLeft : leftLeft,
      top: clampY(y - size / 2),
      size,
      side: right ? "right" : "left",
    };
  }
  const belowTop = y + clear - size / 2;
  if (belowTop >= minY && belowTop <= maxY)
    return { left: clampX(x - size / 2), top: belowTop, size, side: "below" };
  return strict
    ? null
    : {
        left: clampX(x - size / 2),
        top: clampY(belowTop),
        size,
        side: "below",
      };
}

/**
 * Where the magnifier goes while a corner is dragged, and what it shows.
 *
 * It shows the CORNER (not the pointer: the drag is relative), at
 * `magnifierZoom` times the photo's on-screen size, centred under its
 * crosshair. It goes above the pointer, clear of the finger's disc (the hand
 * holding the phone is below the finger); if there is no room above, beside
 * it, on whichever side has more room; below only as a last resort. It always
 * stays inside the stage.
 */
export function magnifierLayout(input: {
  readonly pointer: Point2;
  readonly corner: Point2;
  readonly fit: PhotoFit;
  readonly stage: FrameSize;
}): MagnifierLayout {
  const L = PAPER_ADJUST_LAYOUT;
  // The full size where it fits clear of the finger; smaller on a stage too
  // short for it (a 320 px phone with its bars), never under the finger.
  let placed: Placement | null = null;
  for (const size of MAGNIFIER_SIZES) {
    placed = placeMagnifier(input.pointer, input.stage, size, true);
    if (placed) break;
  }
  const { left, top, size, side } =
    placed ??
    placeMagnifier(
      input.pointer,
      input.stage,
      MAGNIFIER_SIZES[MAGNIFIER_SIZES.length - 1],
      false,
    )!;
  const z = L.magnifierZoom;
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
 * Kirby's corner check: how far each corner he placed is from the detector's,
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
