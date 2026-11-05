"use client";
/**
 * The scan page's spotlight tour (v3.4; Toutour method, design in Pencil
 * section 14c, exports scan-tutorial-2026-11-04/v3/). All candidate (未拍板)
 * beyond the paper steps Kirby OK'd on 2026-11-05.
 *
 * - Mounted by EasyScanCamera while its first-run tip is open (`tipOpen`), so
 *   the live loop is paused the whole time and no photo is taken behind it.
 * - A native modal <dialog> over the whole screen: everything behind it is
 *   inert, so the spotlit control is LOCKED (Kirby 11/05) and only the card's
 *   buttons and "略過教學" act. Escape skips.
 * - Targets are found by `data-tour="<id>"`; a step whose target is not on
 *   screen is dropped before counting (`visibleTourSteps`). The paper frame
 *   has no element: the camera passes `resolvePaperFrame`.
 * - The dim is a 60 % black box-shadow cut around the target, so the target
 *   keeps its colours; the ring is 2 px accent plus a 1 px white halo (seen
 *   without colour vision too).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { scanTourCopy } from "@/lib/copy/scan-tour";
import { getBrowserStorage, markFirstRunTipSeen } from "../easyScanPreferences";
import { CheckIcon, HandIcon } from "../icons";
import { sendTourEvent } from "./tourAnalytics";
import { stepBody, stepTitle } from "./tourText";
import {
  FIXED_SPOTLIGHT_RADIUS,
  SPOTLIGHT_PAD,
  buildTourSteps,
  inflateRect,
  layoutSpotlight,
  prefersReducedMotion,
  rectsClose,
  spotlightRadius,
  tourExitMs,
  tourTransition,
  unionRect,
  visibleTourSteps,
  type Rect,
  type TourEvent,
  type TourReference,
  type TourState,
  type TourStepDef,
  type TourTargetId,
  type TourTrigger,
} from "./tourModel";
import "./scan-tour.css";

export interface ScanTourProps {
  /** "auto": first use, asks 第一次掃描嗎？ first. "help": the "?" button. */
  readonly trigger: TourTrigger;
  readonly reference: TourReference;
  /** Card mode exists (A line's flag): card joins the step-1 choice. */
  readonly cardModeAvailable: boolean;
  /** The "沒有紙？" entry is on screen (its feature flag is on). */
  readonly noPaperEntry: boolean;
  /** The step-1 choice changes the real setting at once. */
  readonly onReferenceChange: (reference: TourReference) => void;
  /** The paper guide rectangle in viewport pixels, or null. */
  readonly resolvePaperFrame: () => Rect | null;
  /** The hand chip's hand: the card-step label is mirrored for "left". */
  readonly hand?: "left" | "right";
  /** The tour is over (finished, skipped, or nothing to point at). */
  readonly onClose: () => void;
}

interface Measured {
  readonly rect: Rect;
  readonly radius: number;
}

type TargetMap = Partial<Record<TourTargetId, Measured | null>>;

const ALL_TARGETS: readonly TourTargetId[] = [
  "reference-chip",
  "paper-frame",
  "card-slot",
  "card-layout",
  "cue",
  "shutter",
];

/** How long the tour waits for the camera screen to lay out its targets. */
const SETTLE_MS = 400;
/** One label's height plus the gap under it (card placement labels). */
const LABEL_STEP = 44;
/** From this spotlight height the card-step labels sit inside it. */
const LABELS_INSIDE_MIN_HEIGHT = 200;

function measureElement(target: TourTargetId): Measured | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return null;
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
  return {
    rect: { x: box.left, y: box.top, width: box.width, height: box.height },
    radius,
  };
}

function measureAll(resolvePaperFrame: () => Rect | null): TargetMap {
  const out: TargetMap = {};
  for (const target of ALL_TARGETS) {
    if (target === "paper-frame") {
      const rect = resolvePaperFrame();
      out[target] = rect ? { rect, radius: 4 } : null;
    } else {
      out[target] = measureElement(target);
    }
  }
  return out;
}

function sameTargets(a: TargetMap, b: TargetMap): boolean {
  return ALL_TARGETS.every((t) => {
    const x = a[t] ?? null;
    const y = b[t] ?? null;
    if (x === null || y === null) return x === y;
    return rectsClose(x.rect, y.rect) && x.radius === y.radius;
  });
}

function stepKey(steps: readonly TourStepDef[]): string {
  return steps.map((s) => `${s.id}:${s.target}`).join("|");
}

export default function ScanTour({
  trigger,
  reference,
  cardModeAvailable,
  noPaperEntry,
  onReferenceChange,
  resolvePaperFrame,
  hand = "right",
  onClose,
}: ScanTourProps) {
  const copy = scanTourCopy(useLocale());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [targets, setTargets] = useState<TargetMap>({});
  const [settled, setSettled] = useState(false);
  const [state, setState] = useState<TourState>({ phase: "closed" });
  const [tooltipSize, setTooltipSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const allSteps = buildTourSteps({ reference, cardModeAvailable });
  const steps = visibleTourSteps(allSteps, (t) => Boolean(targets[t]));
  const isCard = cardModeAvailable && reference === "card";

  // Everything the effects need, read at the moment they run.
  const live = useRef({ state, steps, reference, onClose });
  live.current = { state, steps, reference, onClose };

  // The exit fade (review item 17): the last screen stays drawn while the
  // dialog fades out (TOUR_EXIT_MS, none under reduced motion), then the
  // dialog closes and the parent unmounts it.
  const [leaving, setLeaving] = useState(false);
  const leaveTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (leaveTimerRef.current !== null)
        window.clearTimeout(leaveTimerRef.current);
    },
    [],
  );

  const dispatch = useCallback((event: TourEvent) => {
    const now = live.current;
    const { state: next, effects } = tourTransition(
      now.state,
      event,
      now.steps,
    );
    live.current = { ...now, state: next };
    const closing = effects.some((e) => e.kind === "close");
    // Closing: the screen it was on stays drawn through the fade.
    if (!closing) setState(next);
    for (const effect of effects) {
      if (effect.kind === "markSeen") markFirstRunTipSeen(getBrowserStorage());
      else if (effect.kind === "track")
        sendTourEvent(effect.event, now.reference);
    }
    if (!closing) return;
    const finish = () => {
      leaveTimerRef.current = null;
      // Closed before the parent unmounts it (review item 10): removing an
      // open modal runs no close steps, and focus fell to <body>. The
      // parent then puts focus on "?" or the shutter (`onClose`).
      if (dialogRef.current?.open) dialogRef.current.close();
      setState(next);
      now.onClose();
    };
    const ms = tourExitMs(prefersReducedMotion());
    if (ms === 0 || !dialogRef.current?.open) {
      finish();
      return;
    }
    setLeaving(true);
    leaveTimerRef.current = window.setTimeout(finish, ms);
  }, []);

  // Follow the targets every frame while open: the dock slides in, the cue
  // changes width, the card slot appears after the choice. Only a change
  // re-renders.
  const resolveRef = useRef(resolvePaperFrame);
  resolveRef.current = resolvePaperFrame;
  useEffect(() => {
    let raf = 0;
    const startedAt = performance.now();
    let last: TargetMap = {};
    const tick = () => {
      const now = measureAll(resolveRef.current);
      if (!sameTargets(now, last)) {
        last = now;
        setTargets(now);
      }
      setViewport((v) =>
        v.width === window.innerWidth && v.height === window.innerHeight
          ? v
          : { width: window.innerWidth, height: window.innerHeight },
      );
      if (performance.now() - startedAt >= SETTLE_MS) setSettled(true);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Open once the screen has settled.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!settled || openedRef.current) return;
    openedRef.current = true;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Already open elsewhere in the top layer: render it anyway.
      }
    }
    dispatch({ type: trigger === "auto" ? "openAuto" : "openHelp" });
  }, [settled, trigger, dispatch]);

  // Toutour `when`: a target that went away (or came) reshapes the list.
  const key = stepKey(steps);
  const prevKey = useRef(key);
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    dispatch({ type: "stepsChanged" });
  }, [key, dispatch]);

  // Close the native dialog when the tour ends (it unmounts right after).
  useEffect(() => {
    if (state.phase === "closed" && openedRef.current)
      dialogRef.current?.close();
  }, [state.phase]);

  const stepIndex = state.phase === "step" ? state.index : -1;
  const step = stepIndex >= 0 ? steps[stepIndex] : undefined;

  // The card's own size, for placing it.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const update = () => {
      const box = el.getBoundingClientRect();
      // The card's natural height (scrollHeight), so a maxHeight set from it
      // does not feed back into the next placement.
      const height = Math.max(box.height, el.scrollHeight);
      setTooltipSize((s) =>
        s && s.width === box.width && s.height === height
          ? s
          : { width: box.width, height },
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [state.phase, stepIndex]);

  const measured = step ? (targets[step.target] ?? null) : null;
  const ring = measured ? inflateRect(measured.rect, SPOTLIGHT_PAD) : null;

  // Labels drawn beside the spotlight on the placement step.
  const cardLabels =
    step?.target === "card-slot" || step?.target === "card-layout"
      ? [
          copy.placeCardCentreLabel,
          hand === "left"
            ? copy.placeCardHandLabelLeft
            : copy.placeCardHandLabel,
        ]
      : [];
  // A tall spotlight (hand and slot, as drawn) holds the labels inside its
  // lower edge; a small one (the slot alone) gets them just below it, and the
  // card then keeps clear of them too.
  const labelsInside = ring !== null && ring.height >= LABELS_INSIDE_MIN_HEIGHT;
  const labelsHeight = cardLabels.length * LABEL_STEP;
  // Labels drawn just below a small ring: the card keeps clear of them too.
  const labelsBelow: Rect | null =
    ring && cardLabels.length > 0 && !labelsInside
      ? {
          x: ring.x,
          y: ring.y + ring.height + 8,
          width: ring.width,
          height: labelsHeight,
        }
      : null;

  // Review G6/G7: the card never covers the ring; a tall ring is cropped to
  // end above a card pinned at the bottom (labels and the paper's wrist line
  // then sit at the cropped edge), a small one gets a card that scrolls.
  const layout =
    step && ring && tooltipSize && viewport.width > 0
      ? layoutSpotlight(
          ring,
          unionRect(ring, labelsBelow),
          tooltipSize,
          viewport,
          step.placement,
        )
      : null;
  const placement = layout?.placement ?? null;
  const hole = layout?.hole ?? ring;
  const fixedRadius = step ? FIXED_SPOTLIGHT_RADIUS[step.target] : undefined;
  const radius =
    measured && hole
      ? (fixedRadius ?? spotlightRadius(measured.radius, hole))
      : 0;
  // Labels inside a tall ring: at its (cropped) lower edge.
  const labelsBox: Rect | null =
    hole && cardLabels.length > 0
      ? labelsInside
        ? {
            x: hole.x,
            y: hole.y + hole.height - SPOTLIGHT_PAD - 8 - labelsHeight,
            width: hole.width,
            height: labelsHeight,
          }
        : labelsBelow
      : null;

  // Focus the main button of each new screen (design §6), once it can be
  // seen (review item 15: the card is visibility:hidden on its first paint,
  // until it is placed, and focus() on it then did nothing). Each step's
  // 下一步 is a new element (keyed by the step) described by the step's
  // title and body, so a screen reader reads the new step (review item 9).
  const screenKey =
    state.phase === "closed" ? null : `${state.phase}:${stepIndex}`;
  const focusedScreenRef = useRef<string | null>(null);
  const placedForFocus = state.phase === "welcome" || placement !== null;
  // Review G10 (card steps showed no ring): also when focus is not in the
  // tour's dialog at all once the card has moved (the card steps re-render
  // as their targets appear), it goes back to the main button.
  const placedAt = placement ? `${placement.x}:${placement.y}` : null;
  useEffect(() => {
    if (screenKey === null || !placedForFocus) return;
    const inDialog =
      dialogRef.current?.contains(document.activeElement) === true &&
      document.activeElement !== dialogRef.current;
    if (focusedScreenRef.current === screenKey && inDialog) return;
    focusedScreenRef.current = screenKey;
    primaryRef.current?.focus();
  }, [screenKey, placedForFocus, placedAt]);

  const total = steps.length;
  const counter =
    state.phase === "step"
      ? `${isCard ? copy.counterCardPrefix : ""}${copy.counter(
          String(stepIndex + 1),
          String(total),
        )}`
      : "";
  const isLast = state.phase === "step" && stepIndex === total - 1;

  const onCancel = (e: SyntheticEvent) => {
    e.preventDefault();
    dispatch({ type: "skip" });
  };

  const holeStyle: CSSProperties | undefined = hole
    ? {
        transform: `translate(${hole.x}px, ${hole.y}px)`,
        width: hole.width,
        height: hole.height,
        borderRadius: radius,
      }
    : undefined;

  const tooltipStyle: CSSProperties = placement
    ? {
        left: placement.x,
        top: placement.y,
        width: placement.width,
        // Short screens: the card scrolls inside rather than cover the ring
        // (the G8 note: the chip at 360 × 640).
        ...(placement.maxHeight !== undefined
          ? { maxHeight: placement.maxHeight, overflowY: "auto" as const }
          : {}),
      }
    : // First paint: measured off-screen, not seen.
      { left: 16, top: 0, visibility: "hidden" };

  return (
    <dialog
      ref={dialogRef}
      data-leaving={leaving ? "true" : undefined}
      className="scanTour"
      data-phase={state.phase}
      aria-labelledby="scan-tour-title"
      onCancel={onCancel}
      data-testid="scan-tour"
    >
      {/* Swallows every tap outside the card: the targets are locked. */}
      <div className="scanTourBlocker" aria-hidden="true" />
      {state.phase === "welcome" && (
        <>
          <div className="scanTourDim" aria-hidden="true" />
          <section className="scanTourWelcome">
            <h2 id="scan-tour-title" className="scanTourWelcomeTitle">
              {copy.welcomeTitle}
            </h2>
            <p className="scanTourLead">
              {copy.welcomeLead(String(Math.max(total, 1)))}
            </p>
            <ul className="scanTourRows">
              <li>
                <span className="scanTourRowIcon" aria-hidden="true">
                  <HandIcon width={20} height={20} />
                </span>
                {cardModeAvailable
                  ? copy.welcomeRowPlaceWithCard
                  : copy.welcomeRowPlacePaperOnly}
              </li>
              <li>
                <span className="scanTourRowIcon" aria-hidden="true">
                  <MessageIcon />
                </span>
                {copy.welcomeRowCue}
              </li>
              <li>
                <span className="scanTourRowIcon" aria-hidden="true">
                  <CameraIcon />
                </span>
                {copy.welcomeRowAuto}
              </li>
            </ul>
            <button
              type="button"
              ref={primaryRef}
              className="primaryButton scanTourWide"
              onClick={() => dispatch({ type: "answerFirst" })}
            >
              {copy.welcomeFirst}
            </button>
            <button
              type="button"
              className="scanTourSecondary scanTourWide"
              onClick={() => dispatch({ type: "answerReturning" })}
            >
              {copy.welcomeReturning}
            </button>
            <p className="scanTourFinePrint">{copy.welcomeFinePrint}</p>
          </section>
        </>
      )}
      {state.phase === "step" && step && (
        <>
          {hole ? (
            <>
              <div
                className="scanTourHole"
                style={holeStyle}
                aria-hidden="true"
                data-testid="scan-tour-spotlight"
              />
              {step.target === "paper-frame" && (
                <>
                  <span
                    className="scanTourEdge"
                    aria-hidden="true"
                    style={{
                      transform: `translate(${hole.x + 24}px, ${hole.y + hole.height - SPOTLIGHT_PAD - 2}px)`,
                      width: Math.max(0, hole.width - 48),
                    }}
                  />
                  <span
                    className="scanTourLabel scanTourLabelLight"
                    style={{
                      left: hole.x + hole.width / 2,
                      top: hole.y + hole.height - SPOTLIGHT_PAD - 62,
                      transform: "translateX(-50%)",
                    }}
                  >
                    {copy.placePaperWristLabel}
                  </span>
                </>
              )}
              {labelsBox &&
                cardLabels.map((label, i) => (
                  <span
                    key={label}
                    className="scanTourLabel"
                    style={{
                      right: Math.max(
                        16,
                        viewport.width - (hole.x + hole.width),
                      ),
                      top: labelsBox.y + i * LABEL_STEP,
                    }}
                  >
                    {label}
                  </span>
                ))}
            </>
          ) : (
            <div className="scanTourDim" aria-hidden="true" />
          )}
          <div
            ref={tooltipRef}
            className="scanTourCard"
            style={tooltipStyle}
            data-testid="scan-tour-card"
            data-step={step.id}
          >
            {placement?.arrow && (
              <span
                className={`scanTourArrow scanTourArrow-${placement.arrow.side}`}
                style={{ left: placement.arrow.offset }}
                aria-hidden="true"
              />
            )}
            <div className="scanTourHead">
              <div className="scanTourProgress">
                <div className="scanTourBars" aria-hidden="true">
                  {steps.map((s, i) => (
                    <span
                      key={s.id}
                      className={`scanTourBar${i <= stepIndex ? " on" : ""}`}
                    />
                  ))}
                </div>
                <p className="scanTourCounter" aria-live="polite">
                  {counter}
                </p>
              </div>
              <button
                type="button"
                className="scanTourSkip"
                onClick={() => dispatch({ type: "skip" })}
              >
                {copy.skip}
              </button>
            </div>
            <h2 id="scan-tour-title" className="scanTourTitle">
              {stepTitle(step, copy, isCard)}
            </h2>
            {step.choices.length > 0 && (
              <fieldset className="scanTourChoice">
                <legend className="visuallyHidden">
                  {copy.referenceGroupLabel}
                </legend>
                {step.choices.map((r) => (
                  <label
                    key={r}
                    className={`scanTourChoiceOption${reference === r ? " on" : ""}`}
                  >
                    <input
                      type="radio"
                      name="scan-tour-reference"
                      value={r}
                      checked={reference === r}
                      onChange={() => onReferenceChange(r)}
                    />
                    {reference === r && (
                      <CheckIcon
                        width={14}
                        height={14}
                        className="scanTourChoiceCheck"
                      />
                    )}
                    {r === "a4"
                      ? copy.referenceA4
                      : r === "letter"
                        ? copy.referenceLetter
                        : copy.referenceCard}
                  </label>
                ))}
              </fieldset>
            )}
            <div id="scan-tour-body">
              {stepBody(step, copy, { reference, isCard, noPaperEntry }).map(
                (line) => (
                  <p key={line} className="scanTourBody">
                    {line}
                  </p>
                ),
              )}
            </div>
            <div className={`scanTourActions${stepIndex > 0 ? " two" : ""}`}>
              {stepIndex > 0 && (
                <button
                  type="button"
                  className="scanTourSecondary"
                  onClick={() => dispatch({ type: "back" })}
                >
                  {copy.back}
                </button>
              )}
              <button
                type="button"
                key={step.id}
                ref={primaryRef}
                className="primaryButton"
                aria-describedby="scan-tour-title scan-tour-body"
                onClick={() => dispatch({ type: "next" })}
              >
                {isLast ? copy.start : copy.next}
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}

function MessageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}
