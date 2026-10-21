"use client";

/**
 * 手動調整邊框 (V3.2 F2, candidate, 未拍板): a full-screen modal over the frozen
 * photo where the person lines a frame up with the sheet's four corners.
 *
 * All of its rules are in `paperAdjustState.ts` (pure, tested); this file wires the
 * pointer and key events to `adjustReducer` and draws the state. The skeleton
 * of `/scan`'s card-corner handles is kept (pointerdown + setPointerCapture +
 * arrow-key nudges, ScanClient.tsx), with new targets and looks:
 *
 * - four 48 px handles (the ring inside is 18 px), named by where they are;
 * - relative drag: a press anywhere on a handle, or anywhere on the photo once
 *   a corner is chosen, moves that corner by the pointer's movement;
 * - a 4x magnifier above (or beside) the finger, showing the corner under a
 *   crosshair, never under the finger;
 * - the arrow keys move the focused corner 1 screen px (Shift: 10);
 * - "這個角被手遮住": two taps on the corner's two edges work it out
 *   (`solveHiddenCorner`), or say why they cannot.
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
} from "react";
import type { Locale } from "../../lib/contracts/locale";
import { paperAdjustCopy } from "../../lib/copy/paper-adjust";
import type { PaperSize } from "../paper/detect";
import {
  CORNER_INDICES,
  neighbourCorners,
  type CornerIndex,
  type FrameSize,
  type Quad4,
} from "../paper/manualQuad";
import type { PhotoOverlay } from "../photo/pipeline";
import {
  PAPER_ADJUST_LAYOUT,
  adjustReadiness,
  adjustReducer,
  cornerPositions,
  edgeStepOf,
  fitPhoto,
  frameMoved,
  magnifierLayout,
  nudgeForKey,
  pointerMoveFor,
  startAdjust,
  toImage,
  toScreen,
  type AdjustEntry,
  type AdjustState,
  type PlacedFrame,
  type PointerKind,
} from "./paperAdjustState";

export interface PaperAdjustConfirm {
  readonly corners: Quad4;
  readonly source: "adjusted" | "manual";
  /** Whether the magnifier was on (always true outside the corner check). */
  readonly magnifier: boolean;
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
  /** The first reason the photo was turned back (F7: `PAPER_NOT_FOUND` opens the centred sheet). */
  readonly firstCode?: string;
  /** A line shown before confirming (`adjustWarningFor`, F7): the sheet was measured as curled. */
  readonly warning?: "curled" | null;
  /** For tests and the static render: a state to start from, and the stage's size. */
  readonly initialState?: AdjustState;
  readonly initialStageSize?: FrameSize;
  readonly initialMagnifier?: boolean;
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
  firstCode,
  warning = null,
  initialState,
  initialStageSize,
  initialMagnifier = true,
}: PaperAdjustProps) {
  const copy = paperAdjustCopy(locale);
  const [state, dispatch] = useReducer(
    adjustReducer,
    initialState ?? null,
    (given) =>
      given ?? startAdjust({ entry, overlay, paperSize, previous, firstCode }),
  );
  const [stageSize, setStageSize] = useState<FrameSize | null>(
    initialStageSize ?? null,
  );
  const [magnifierOn, setMagnifierOn] = useState(initialMagnifier);
  // Said once after a press of the primary button that cannot be used yet.
  const [refusal, setRefusal] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // A modal of its own (focus stays inside), opened when it mounts.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    titleRef.current?.focus();
  }, []);

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

  const fit = fitPhoto(
    state.image,
    stageSize ?? { width: 0, height: 0 },
    PAPER_ADJUST_LAYOUT.handleTargetPx / 2,
  );
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

  const onHandleDown =
    (index: CornerIndex) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (state.edge) return; // taps go to the edges while marking
      e.preventDefault();
      e.stopPropagation();
      capture(e.pointerId);
      setRefusal(null);
      dispatch({
        type: "pointerDown",
        index,
        pointerId: e.pointerId,
        pointerType: pointerKind(e.pointerType),
        point: stagePoint(e),
      });
    };

  const onStageDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (fit.width === 0) return;
    const point = stagePoint(e);
    if (state.edge) {
      dispatch({ type: "edgeTap", point: toImage(point, fit) });
      return;
    }
    capture(e.pointerId);
    setRefusal(null);
    dispatch({
      type: "pointerDown",
      index: null,
      pointerId: e.pointerId,
      pointerType: pointerKind(e.pointerType),
      point,
    });
  };

  const onStageMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!state.drag) return;
    dispatch(
      pointerMoveFor({ pointerId: e.pointerId, point: stagePoint(e), fit }),
    );
  };

  const onStageUp = (e: ReactPointerEvent<HTMLDivElement>) =>
    dispatch({ type: "pointerUp", pointerId: e.pointerId });

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
      setRefusal(
        "notPlaced" in readiness
          ? copy.notPlaced(copy.cornerNames[positions[readiness.notPlaced]])
          : copy.quadProblem[readiness.problem],
      );
      return;
    }
    onConfirm({
      corners: readiness.corners,
      source: readiness.source,
      magnifier: entry === "check" ? magnifierOn : true,
      moved: frameMoved(state),
    });
  };

  // What the status line says: the newest thing first.
  const notice = state.notice;
  const edgeStep = state.edge ? edgeStepOf(state.edge) : null;
  const status =
    refusal ??
    (notice?.kind === "edgeProblem"
      ? copy.edgeProblem[notice.problem]
      : notice?.kind === "edgeSolved"
        ? copy.edgeSolved(nameOf(notice.index))
        : notice?.kind === "chooseCorner"
          ? copy.chooseCornerFirst
          : notice?.kind === "placeNeighboursFirst"
            ? copy.placeNeighboursFirst(
                nameOf(notice.index),
                nameOf(notice.missing),
              )
            : notice?.kind === "edgeUndone"
              ? copy.edgeUndone(nameOf(notice.index))
              : state.edge && edgeStep
                ? copy.edgeStep(
                    edgeStep.step,
                    nameOf(state.edge.index),
                    nameOf(edgeStep.other),
                  )
                : !readiness.ok && "problem" in readiness
                  ? copy.quadProblem[readiness.problem]
                  : "");

  const instruction =
    entry === "check"
      ? copy.check.instruction
      : entry === "review"
        ? copy.review.instruction
        : state.start.detected.every(Boolean)
          ? copy.instructionDetected
          : copy.instructionGuess;
  const title =
    entry === "check"
      ? copy.check.entry
      : entry === "review"
        ? copy.review.title
        : copy.title;
  const confirmLabel =
    entry === "check"
      ? copy.check.confirm
      : entry === "review"
        ? copy.review.confirm
        : copy.confirm;

  const screenCorners = state.corners.map((c) => toScreen(c, fit));
  const drag = state.drag;
  const magnifier =
    drag && magnifierOn && stageSize
      ? magnifierLayout({
          pointer: drag.pointer,
          corner: state.corners[drag.index],
          fit,
          stage: stageSize,
        })
      : null;
  const half = PAPER_ADJUST_LAYOUT.handleTargetPx / 2;

  // While marking edges: the hidden corner's two edges, from each neighbour
  // through the point marked on it (dashed), so the person sees what is used.
  const edgeLines = state.edge
    ? state.edge.points.map((p, i) => {
        const from =
          screenCorners[neighbourCorners(state.edge!.index)[i as 0 | 1]];
        return { from, to: toScreen(p, fit) };
      })
    : [];

  return (
    <dialog
      ref={dialogRef}
      className="paperAdjust"
      aria-labelledby="paper-adjust-title"
      data-testid="paper-adjust"
      data-entry={entry}
      onCancel={(e) => {
        e.preventDefault();
        if (state.edge) dispatch({ type: "edgeCancel" });
        else onCancel();
      }}
    >
      <header className="paperAdjustHeader">
        <h2 id="paper-adjust-title" ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        <p className="paperAdjustHint">{instruction}</p>
        {warning === "curled" && (
          <p className="paperAdjustWarning" data-testid="paper-adjust-warning">
            {copy.curledWarning}
          </p>
        )}
      </header>
      <div
        className="paperAdjustStage"
        ref={stageRef}
        data-marking={state.edge ? "true" : undefined}
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
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
            {edgeLines.map((line, i) => (
              <line
                key={i}
                className="paperAdjustEdgeLine"
                x1={line.from.x}
                y1={line.from.y}
                x2={line.from.x + (line.to.x - line.from.x) * 3}
                y2={line.from.y + (line.to.y - line.from.y) * 3}
              />
            ))}
            {state.edge?.points.map((p, i) => {
              const s = toScreen(p, fit);
              return (
                <circle
                  key={i}
                  className="paperAdjustEdgePoint"
                  cx={s.x}
                  cy={s.y}
                  r={5}
                />
              );
            })}
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
                data-hidden-corner={
                  state.edge?.index === index ? "true" : undefined
                }
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
      <div className="paperAdjustTools">
        {state.edge ? (
          <button
            type="button"
            className="paperAdjustTool"
            onClick={() => dispatch({ type: "edgeCancel" })}
          >
            {copy.edgeModeCancel}
          </button>
        ) : (
          <button
            type="button"
            className="paperAdjustTool"
            data-testid="paper-adjust-edge-mode"
            onClick={() => dispatch({ type: "edgeStart" })}
          >
            {copy.edgeModeStart}
          </button>
        )}
        <button
          type="button"
          className="paperAdjustTool"
          onClick={() => {
            setRefusal(null);
            dispatch({ type: "reset" });
          }}
        >
          {copy.reset}
        </button>
        {entry === "check" && (
          <button
            type="button"
            className="paperAdjustTool"
            aria-pressed={magnifierOn}
            data-testid="paper-adjust-magnifier-toggle"
            onClick={() => setMagnifierOn((on) => !on)}
          >
            {magnifierOn ? copy.check.magnifierOn : copy.check.magnifierOff}
          </button>
        )}
      </div>
      <div className="paperAdjustActions">
        <button
          type="button"
          className="primaryButton paperAdjustConfirm"
          data-testid="paper-adjust-confirm"
          aria-disabled={readiness.ok ? undefined : "true"}
          onClick={confirm}
        >
          {confirmLabel}
        </button>
        <button type="button" className="paperAdjustCancel" onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </dialog>
  );
}
