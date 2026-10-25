"use client";

/**
 * 手動調整邊框 (V3.2 F2, candidate, 未拍板): a full-screen modal over the frozen
 * photo where the person lines a frame up with the sheet's four corners.
 *
 * All of its rules are in `paperAdjustState.ts` (pure, tested); this file wires the
 * pointer and key events to `adjustReducer` and the view helpers, and draws the
 * state. The skeleton of `/scan`'s card-corner handles is kept (pointerdown +
 * setPointerCapture + arrow-key nudges, ScanClient.tsx), with new targets and
 * looks:
 *
 * - four 48 px handles (the ring inside is 18 px), named by where they are;
 * - relative drag: a press anywhere on a handle, or anywhere on the photo once
 *   a corner is chosen, moves that corner by the pointer's movement;
 * - a 4x magnifier above (or beside) the finger, showing the corner under a
 *   crosshair, never under the finger, switching side only past a margin
 *   (F10, `magnifierPlacement`);
 * - the arrow keys move the focused corner 1 screen px (Shift: 10);
 * - F10: two fingers zoom and move the photo (`pinchView`), a mouse wheel
 *   zooms. The view only changes how the photo is drawn: corners are kept in
 *   the photo's pixels.
 * - V3.2 F17 (Kirby, preview 7, 2026-10-23: "the auto magnify should happen
 *   just like Adobe PDF scanner", candidate): it opens on the WHOLE photo
 *   (`wholeView`) with the frame on the sheet the detector found, and never
 *   zooms by itself: no zoom onto the frame when it opens (F10/F16's
 *   `sheetView`, the "frame trying to magnify" Kirby saw flicker), no double
 *   tap, no whole / zoomed button and no 改用置中框. The magnifier shows
 *   only while a corner is dragged. A corner follows the finger 1:1 from the
 *   first move (the slop only decides whether it was a tap), and the moves
 *   are drawn once per animation frame.
 * - F14 (Kirby's phone test of preview 5, 2026-10-22: "No need for multiple
 *   indicators in adjustment mode, the user will know how to do it",
 *   candidate): only what is needed is on screen. The heading, the photo with
 *   its frame and four handles, the magnifier, the confirm button and cancel
 *   (or 重拍 when the screen opened by itself). No gesture hint, no
 *   instructions, no
 *   per-corner marks; a line only when the frame cannot be used as it is.
 *   The handles keep their accessible names.
 * - F15 (Kirby, 2026-10-23, candidate): it also opens by itself on every
 *   photo measured from the detector's own corners (`review`), before any
 *   length is shown, with the same heading and confirm button; Kirby's
 *   `?debug=1` corner check (its record button, magnifier switch and line)
 *   is gone, and the magnifier is always on.
 *
 * The photo is the frozen photo's own object URL, drawn by the browser; it is
 * never read, copied or sent. Only the four corner positions leave this
 * component, to the caller, which runs the pipeline in this browser.
 */
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { Locale } from "../../lib/contracts/locale";
import {
  paperAdjustCopy,
  type PaperAdjustCopy,
} from "../../lib/copy/paper-adjust";
import type { PaperSize } from "../paper/detect";
import {
  CORNER_INDICES,
  type CornerIndex,
  type FrameSize,
  type Quad4,
} from "../paper/manualQuad";
import type { Point2 } from "../geometry/homography";
import type { PhotoOverlay } from "../photo/pipeline";
import {
  PAPER_ADJUST_LAYOUT,
  adjustReadiness,
  adjustReducer,
  clampView,
  cornerPositions,
  frameMoved,
  isWholeView,
  magnifierLayout,
  magnifierPlacement,
  nudgeForKey,
  pinchView,
  pointerMoveFor,
  startAdjust,
  toScreen,
  wheelZoomFactor,
  wholeView,
  zoomViewAt,
  type AdjustEntry,
  type AdjustReadiness,
  type AdjustState,
  type MagnifierPlacement,
  type PhotoFit,
  type PlacedFrame,
  type PointerKind,
} from "./paperAdjustState";
import { closeAsIfRemoved } from "./scanMotion";
import { LeaveShield } from "./LeaveShield";

/**
 * The status line after a press of the confirm button that was refused (F14):
 * with no per-corner mark on the screen, it names the corner still to be
 * lined up (the centred sheet's corners, or the fourth corner of a
 * three-corner find, which starts as a guess inside the sheet), else says why
 * the frame cannot be used.
 */
export function refusalText(
  readiness: Exclude<AdjustReadiness, { ok: true }>,
  positions: readonly [number, number, number, number],
  copy: PaperAdjustCopy,
): string {
  return "notPlaced" in readiness
    ? copy.notPlaced(copy.cornerNames[positions[readiness.notPlaced]])
    : copy.quadProblem[readiness.problem];
}

export interface PaperAdjustConfirm {
  readonly corners: Quad4;
  readonly source: "adjusted" | "manual";
  /** Whether any corner is somewhere other than where the screen opened it (`frameMoved`). */
  readonly moved: boolean;
}

export interface PaperAdjustProps {
  readonly entry: AdjustEntry;
  readonly overlay: PhotoOverlay;
  readonly paperSize: PaperSize;
  /** The frozen photo's object URL. */
  readonly previewUrl: string;
  readonly locale: Locale;
  readonly onCancel: () => void;
  readonly onConfirm: (result: PaperAdjustConfirm) => void;
  /** The frame the run on screen was given, when the person placed one (F7: it opens again). */
  readonly previous?: PlacedFrame | null;
  /**
   * What the way out says (F14): `retake` when the screen opened by itself
   * after the photo was turned back on the paper (it goes back to the
   * camera), else `cancel` (back to the sheet it was opened from).
   */
  readonly leave?: "cancel" | "retake";
  /**
   * V3.2 motion pass #22: the screen is on its way out. The parent keeps it
   * mounted for the fade (`useLeaving`); it closes at once, as its unmount
   * did, and stays painted and inert while it fades.
   */
  readonly leaving?: boolean;
  /** For tests and the static render: a state to start from, and the stage's size. */
  readonly initialState?: AdjustState;
  readonly initialStageSize?: FrameSize;
}

/**
 * How the photo is shown: the whole photo (F17: always how it opens), or
 * wherever two fingers or the wheel left it (`free`, F10).
 */
type ViewChoice =
  | { readonly kind: "whole" }
  | { readonly kind: "free"; readonly fit: PhotoFit };

/** A pointer move waiting for the next animation frame (F17). */
interface PendingMove {
  readonly pointerId: number;
  readonly point: Point2;
}

function pointerKind(type: string): PointerKind {
  return type === "mouse" || type === "pen" ? type : "touch";
}

export function PaperAdjust({
  entry,
  overlay,
  paperSize,
  previewUrl,
  locale,
  onCancel,
  onConfirm,
  previous = null,
  leave = "cancel",
  leaving = false,
  initialState,
  initialStageSize,
}: PaperAdjustProps) {
  const copy = paperAdjustCopy(locale);
  const [state, dispatch] = useReducer(
    adjustReducer,
    initialState ?? null,
    (given) => given ?? startAdjust({ entry, overlay, paperSize, previous }),
  );
  const [stageSize, setStageSize] = useState<FrameSize | null>(
    initialStageSize ?? null,
  );
  const [view, setView] = useState<ViewChoice>({ kind: "whole" });
  // Where the magnifier was on the last frame of this drag (F10: hysteresis).
  const [magnifierAt, setMagnifierAt] = useState<MagnifierPlacement | null>(
    null,
  );
  // Said once after a press of the primary button that cannot be used yet.
  const [refusal, setRefusal] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The fingers on the stage now, and a pinch in progress (F10).
  const pointersRef = useRef(new Map<number, Point2>());
  const pinchRef = useRef<{
    readonly ids: readonly [number, number];
    readonly from: readonly [Point2, Point2];
    readonly start: PhotoFit;
  } | null>(null);
  // F17: the newest corner move, drawn on the next animation frame (at most
  // one state update per frame, however often the pointer reports).
  const pendingMoveRef = useRef<PendingMove | null>(null);
  const frameRef = useRef<number | null>(null);

  // A modal of its own (focus stays inside), opened when it mounts, and
  // again should it be wanted back while it was leaving (fix round, review
  // item 1: the camera gives each opening a new key, so this is a guard).
  useEffect(() => {
    if (leaving) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    titleRef.current?.focus();
  }, [leaving]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Leaving (V3.2 motion pass #22): closed in the commit that started the
  // fade, with the focus outcome its unmount had (the sheet coming back
  // focuses its own control after this effect).
  useLayoutEffect(() => {
    if (leaving) closeAsIfRemoved(dialogRef.current);
  }, [leaving]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const box = stage.getBoundingClientRect();
      setStageSize((prev) =>
        prev && prev.width === box.width && prev.height === box.height
          ? prev
          : { width: box.width, height: box.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const stage = stageSize ?? { width: 0, height: 0 };
  const fit: PhotoFit =
    view.kind === "whole"
      ? wholeView(state.image, stage)
      : clampView(view.fit, state.image, stage);
  const showingWhole = isWholeView(fit, state.image, stage);
  const positions = cornerPositions(state.corners);
  const nameOf = (index: CornerIndex) => copy.cornerNames[positions[index]];
  const readiness = adjustReadiness(state);

  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const box = stageRef.current?.getBoundingClientRect();
    return box
      ? { x: e.clientX - box.left, y: e.clientY - box.top }
      : { x: e.clientX, y: e.clientY };
  };

  const capture = (pointerId: number) => {
    try {
      stageRef.current?.setPointerCapture(pointerId);
    } catch {
      // A pointer that is already gone: the drag simply ends with it.
    }
  };

  /**
   * A finger came down while another is on the stage: a pinch begins, and a
   * corner drag in progress is undone (F10). Returns whether it did.
   */
  const startPinch = (pointerId: number, point: Point2): boolean => {
    const others = [...pointersRef.current.entries()].filter(
      ([id]) => id !== pointerId,
    );
    pointersRef.current.set(pointerId, point);
    if (others.length !== 1) return false;
    const [otherId, otherPoint] = others[0];
    dropPendingMove();
    if (state.drag) dispatch({ type: "dragCancel" });
    setMagnifierAt(null);
    pinchRef.current = {
      ids: [otherId, pointerId],
      from: [otherPoint, point],
      start: fit,
    };
    return true;
  };

  const beginDrag = (
    index: CornerIndex | null,
    e: ReactPointerEvent<HTMLElement>,
    point: Point2,
  ) => {
    capture(e.pointerId);
    setRefusal(null);
    setMagnifierAt(
      stageSize
        ? magnifierPlacement({ pointer: point, stage: stageSize })
        : null,
    );
    dispatch({
      type: "pointerDown",
      index,
      pointerId: e.pointerId,
      pointerType: pointerKind(e.pointerType),
      point,
    });
  };

  const applyMove = (move: PendingMove) => {
    if (stageSize)
      setMagnifierAt((prev) =>
        magnifierPlacement({
          pointer: move.point,
          stage: stageSize,
          previous: prev,
        }),
      );
    dispatch(pointerMoveFor({ ...move, fit }));
  };

  const dropPendingMove = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingMoveRef.current = null;
  };

  /** The corner move waiting for a frame, applied now (before a release). */
  const flushPendingMove = () => {
    const pending = pendingMoveRef.current;
    dropPendingMove();
    if (pending) applyMove(pending);
  };

  const onHandleDown =
    (index: CornerIndex) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const point = stagePoint(e);
      if (startPinch(e.pointerId, point)) {
        capture(e.pointerId);
        return;
      }
      beginDrag(index, e, point);
    };

  const onStageDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (fit.width === 0) return;
    const point = stagePoint(e);
    if (startPinch(e.pointerId, point)) {
      capture(e.pointerId);
      return;
    }
    // F17: no double tap any more (it zoomed the photo, Kirby's flicker).
    beginDrag(null, e, point);
  };

  const onStageMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const point = stagePoint(e);
    if (pointersRef.current.has(e.pointerId))
      pointersRef.current.set(e.pointerId, point);
    const pinch = pinchRef.current;
    if (pinch) {
      const a = pointersRef.current.get(pinch.ids[0]);
      const b = pointersRef.current.get(pinch.ids[1]);
      if (a && b && stageSize)
        setView({
          kind: "free",
          fit: pinchView({
            start: pinch.start,
            from: pinch.from,
            to: [a, b],
            image: state.image,
            stage: stageSize,
          }),
        });
      return;
    }
    if (!state.drag || state.drag.pointerId !== e.pointerId) return;
    // F17: drawn on the next animation frame, with the newest point only.
    pendingMoveRef.current = { pointerId: e.pointerId, point };
    if (frameRef.current === null)
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (pending) applyMove(pending);
      });
  };

  const onStageUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pendingMoveRef.current?.pointerId === e.pointerId) flushPendingMove();
    pointersRef.current.delete(e.pointerId);
    const pinch = pinchRef.current;
    if (pinch && pinch.ids.includes(e.pointerId)) pinchRef.current = null;
    if (state.drag?.pointerId === e.pointerId) setMagnifierAt(null);
    dispatch({ type: "pointerUp", pointerId: e.pointerId });
  };

  const onStageWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!stageSize || fit.width === 0) return;
    const factor = wheelZoomFactor(e.deltaY);
    if (factor === 1) return;
    setView({
      kind: "free",
      fit: zoomViewAt(fit, factor, stagePoint(e), state.image, stageSize),
    });
  };

  const onHandleKey =
    (index: CornerIndex) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      const nudge = nudgeForKey({
        key: e.key,
        shiftKey: e.shiftKey,
        index,
        fit,
      });
      if (!nudge) return;
      e.preventDefault();
      setRefusal(null);
      dispatch(nudge);
    };

  const confirm = () => {
    if (!readiness.ok) {
      setRefusal(refusalText(readiness, positions, copy));
      return;
    }
    onConfirm({
      corners: readiness.corners,
      source: readiness.source,
      moved: frameMoved(state),
    });
  };

  // The one line under the photo (F14): only when the frame cannot be used
  // as it is (a press of the confirm button that was refused, or a frame that
  // crosses itself or leaves the photo); empty otherwise.
  const status =
    refusal ??
    (!readiness.ok && "problem" in readiness
      ? copy.quadProblem[readiness.problem]
      : "");

  const screenCorners = state.corners.map((c) => toScreen(c, fit));
  const drag = state.drag;
  const magnifier =
    drag && stageSize
      ? magnifierLayout({
          pointer: drag.pointer,
          corner: state.corners[drag.index],
          fit,
          stage: stageSize,
          previous: magnifierAt,
        })
      : null;
  const half = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;

  return (
    <>
      <dialog
        ref={dialogRef}
        className="paperAdjust"
        aria-labelledby="paper-adjust-title"
        data-testid="paper-adjust"
        data-entry={entry}
        data-leaving={leaving ? "true" : undefined}
        inert={leaving}
        aria-hidden={leaving || undefined}
        onCancel={(e) => {
          e.preventDefault();
          if (leaving) return;
          onCancel();
        }}
      >
        <header className="paperAdjustHeader">
          <h2 id="paper-adjust-title" ref={titleRef} tabIndex={-1}>
            {copy.title}
          </h2>
        </header>
        <div
          className="paperAdjustStage"
          ref={stageRef}
          data-testid="paper-adjust-stage"
          data-view={showingWhole ? "whole" : "zoomed"}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          onPointerCancel={onStageUp}
          onWheel={onStageWheel}
        >
          {fit.width > 0 && (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL, drawn as it is
            <img
              className="paperAdjustPhoto"
              src={previewUrl}
              alt=""
              draggable={false}
              style={{
                left: fit.offsetX,
                top: fit.offsetY,
                width: fit.width,
                height: fit.height,
              }}
            />
          )}
          {fit.width > 0 && (
            <svg
              className="paperAdjustFrame"
              aria-hidden="true"
              focusable="false"
              width={stageSize?.width}
              height={stageSize?.height}
            >
              <polygon
                points={screenCorners.map((p) => `${p.x},${p.y}`).join(" ")}
              />
            </svg>
          )}
          {fit.width > 0 &&
            CORNER_INDICES.map((index) => {
              const p = screenCorners[index];
              const placed = state.placed[index];
              return (
                <button
                  key={index}
                  type="button"
                  className="paperAdjustHandle"
                  data-testid={`paper-adjust-handle-${index}`}
                  data-placed={placed ? "true" : "false"}
                  data-selected={state.selected === index ? "true" : undefined}
                  aria-pressed={state.selected === index}
                  aria-label={`${copy.handleLabel(nameOf(index))}${placed ? "" : copy.handleNotPlaced}`}
                  aria-describedby="paper-adjust-keys"
                  style={{
                    transform: `translate(${p.x - half}px, ${p.y - half}px)`,
                  }}
                  onPointerDown={onHandleDown(index)}
                  onKeyDown={onHandleKey(index)}
                  onClick={() => dispatch({ type: "select", index })}
                >
                  <span className="paperAdjustDot" aria-hidden="true" />
                </button>
              );
            })}
          {magnifier && (
            <div
              className="paperAdjustMagnifier"
              data-testid="paper-adjust-magnifier"
              data-side={magnifier.side}
              aria-hidden="true"
              style={{
                left: magnifier.left,
                top: magnifier.top,
                width: magnifier.size,
                height: magnifier.size,
                backgroundImage: `url("${previewUrl}")`,
                backgroundSize: `${magnifier.backgroundWidth}px ${magnifier.backgroundHeight}px`,
                backgroundPosition: `${magnifier.backgroundX}px ${magnifier.backgroundY}px`,
              }}
            >
              <span className="paperAdjustCross" />
            </div>
          )}
        </div>
        <p
          className="paperAdjustStatus"
          role="status"
          aria-live="polite"
          data-testid="paper-adjust-status"
        >
          {status}
        </p>
        <p id="paper-adjust-keys" className="visuallyHidden">
          {copy.keyboardHint}
        </p>
        <div className="paperAdjustActions">
          <button
            type="button"
            className="primaryButton paperAdjustConfirm"
            data-testid="paper-adjust-confirm"
            aria-disabled={readiness.ok ? undefined : "true"}
            onClick={confirm}
          >
            {copy.confirm}
          </button>
          <button
            type="button"
            className="paperAdjustCancel"
            data-testid="paper-adjust-cancel"
            onClick={onCancel}
          >
            {leave === "retake" ? copy.retake : copy.cancel}
          </button>
        </div>
      </dialog>
      {/* Leaving: a transparent layer takes the taps over it (LeaveShield). */}
      {leaving && <LeaveShield target={dialogRef} />}
    </>
  );
}
