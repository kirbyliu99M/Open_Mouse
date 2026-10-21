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
import type { PhotoOverlay, PipelineIssue } from "../photo/pipeline";
import type { ScanSubmission } from "../../lib/contracts/measurement";

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

/** The two failures the adjustment can rescue: a hidden edge, a hidden corner. */
export const ADJUSTABLE_CODES = [
  "PAPER_EDGE_HIDDEN",
  "PAPER_CORNER_HIDDEN",
] as const;

export type AdjustEntry = "rescue" | "check";

/** What `adjustEntryFor` needs to know about the result on screen. */
export type AdjustableResult =
  | { readonly kind: "none" | "processing" }
  | {
      readonly kind: "gateFailure";
      readonly errors: readonly PipelineIssue[];
      readonly overlay: PhotoOverlay | null;
    }
  | {
      readonly kind: "measured";
      readonly overlay: PhotoOverlay;
      readonly submission: ScanSubmission;
    };

/**
 * Which adjustment, if any, the sheet offers:
 *
 * - `rescue`: the automatic detection turned the photo back, the FIRST
 *   reason is a hidden edge or corner (on a photo that decoded), and no other
 *   paper gate failed: a sheet the detector measured as curled
 *   (`PAPER_CURLED`, a number over its limit) is not rescued just because a
 *   hidden edge was listed before it. Never after a measurement.
 * - `check`: only with `?debug=1`, on a photo the detector measured from its
 *   own corners: Kirby's corner check, which changes no measurement.
 */
export function adjustEntryFor(
  result: AdjustableResult,
  debugOn: boolean,
): AdjustEntry | null {
  if (result.kind === "gateFailure") {
    const adjustable = ADJUSTABLE_CODES as readonly string[];
    const code = result.errors[0]?.code;
    const otherPaperFailure = result.errors.some(
      (e) => e.code.startsWith("PAPER_") && !adjustable.includes(e.code),
    );
    const overlay = result.overlay;
    if (
      overlay &&
      overlay.imageWidth > 0 &&
      overlay.imageHeight > 0 &&
      adjustable.includes(code ?? "") &&
      !otherPaperFailure
    )
      return "rescue";
    return null;
  }
  if (result.kind === "measured" && debugOn) {
    const calibration = result.submission.calibration;
    const autoCorners =
      "method" in calibration &&
      calibration.method === "paper-edge" &&
      (calibration.cornersSource ?? "auto") === "auto";
    return autoCorners && result.overlay.paperCorners ? "check" : null;
  }
  return null;
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
}): AdjustConfirmAction {
  const { entry, result } = input;
  if (entry === "check") {
    const detected =
      result.kind === "measured" ? result.overlay.paperCorners : null;
    return detected ? { kind: "recordCheck", detected } : { kind: "none" };
  }
  if (entry === "rescue" && result.kind === "gateFailure" && input.hasFile)
    return { kind: "rerun" };
  return { kind: "none" };
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
 * The opening state. `rescue` starts from what the detector found
 * (`defaultAdjustFrame`); `check` always starts from the centred sheet with
 * nothing placed, so that a corner left where it started cannot read as a
 * perfect drag.
 */
export function startAdjust(input: {
  readonly entry: AdjustEntry;
  readonly overlay: PhotoOverlay;
  readonly paperSize: PaperSize;
}): AdjustState {
  const image = {
    width: input.overlay.imageWidth,
    height: input.overlay.imageHeight,
  };
  const start: DefaultAdjustFrame =
    input.entry === "check"
      ? {
          corners: centredPaperFrame(image, input.paperSize),
          detected: [false, false, false, false],
          from: "centred",
        }
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

function clampToImage(p: Point2, image: FrameSize): Point2 {
  return {
    x: Math.min(image.width, Math.max(0, p.x)),
    y: Math.min(image.height, Math.max(0, p.y)),
  };
}

/**
 * `index` moved to `corner` and is placed. `solved` says whether it was worked
 * out from its edges (else the person put it there). A worked-out neighbour of
 * it was found from where `index` was, so it goes back to not placed, and the
 * notice says so.
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
        },
      };
    }
    case "pointerMove": {
      const drag = state.drag;
      if (!drag || drag.pointerId !== action.pointerId || !(action.scale > 0))
        return state;
      const corner = clampToImage(
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
      const moved =
        action.point.x !== drag.startPointer.x ||
        action.point.y !== drag.startPointer.y;
      const next = { ...state, drag: { ...drag, pointer: action.point } };
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
        clampToImage(
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
