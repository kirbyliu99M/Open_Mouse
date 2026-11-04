/**
 * The scan tour's pure parts (v3.4, Toutour method; design: Pencil section
 * 14c, scan-tutorial-2026-11-04/v3/): which steps there are, the state
 * machine with its side effects as data, and the geometry of the spotlight
 * and the tooltip. All candidates (未拍板) except what the paper design fixes.
 *
 * Nothing here touches the DOM; `ScanTour.tsx` measures and renders.
 */

/**
 * What the first-run tip / "?" shows now (review items 2 and 14):
 * - "tour": the live camera picture is on screen (the stream plays, no photo
 *   over it, no typed hand length): every target is there to point at.
 * - "wait": the camera is still being asked for (the permission prompt
 *   first): nothing yet; the tour opens once the picture is live.
 * - "sheet": the old tip sheet: a typed hand length (as on main, at once),
 *   and camera refused / no camera / stream ended or a photo on screen, where
 *   the tour would have nothing to point at.
 */
export type TipPresentation = "tour" | "wait" | "sheet";

export function tipPresentation(screen: {
  readonly camera:
    "requesting" | "live" | "cameraError" | "streamEnded" | "noCamera";
  readonly result: string;
  readonly typedLength: boolean;
  /** The video has started playing (a picture is on screen). */
  readonly pictureReady: boolean;
}): TipPresentation {
  if (screen.typedLength) return "sheet";
  if (screen.result !== "none") return "sheet";
  if (screen.camera === "live") return screen.pictureReady ? "tour" : "wait";
  if (screen.camera === "requesting") return "wait";
  return "sheet";
}

/** The tour's exit fade, ms (review item 17): short, none under reduced motion. 候選. */
export const TOUR_EXIT_FADE_MS = 150;

export function tourExitMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : TOUR_EXIT_FADE_MS;
}

/** The person asked for reduced motion (false where it cannot be read). */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/**
 * Where focus goes when the tour closes (review item 10): back to "?" when
 * it opened the tour, else (the first-use question) to the shutter.
 */
export function tourReturnFocus(trigger: TourTrigger): "help" | "shutter" {
  return trigger === "help" ? "help" : "shutter";
}

/** What the person measures against. "card" exists only with card mode. */
export type TourReference = "a4" | "letter" | "card";

/**
 * Where a step's spotlight goes. Every id but "paper-frame" is a
 * `data-tour="<id>"` attribute on the camera screen (shared list, V34
 * program). "paper-frame" has no element of its own: it is the guide
 * rectangle on the stage, worked out by `guideRectInViewport`.
 */
export type TourTargetId =
  | "reference-chip"
  | "paper-frame"
  | "card-slot"
  /** The hand zone plus the card slot (card line); card step 2 prefers it. */
  | "card-layout"
  | "cue"
  | "shutter";

export type TourStepId = "reference" | "placement" | "cue" | "shutter";

export interface TourStepDef {
  readonly id: TourStepId;
  readonly target: TourTargetId;
  /** Used when `target` is not on screen (card-layout → card-slot). */
  readonly fallbackTarget?: TourTargetId;
  /**
   * "dock-bottom": the target is about as tall as the screen (the paper
   * frame), so the card sits at the bottom with no arrow. "auto": above or
   * below the target, whichever has the room, with an arrow to its centre.
   */
  readonly placement: "auto" | "dock-bottom";
  /**
   * The choice drawn inside the card (step 1 only; empty elsewhere). The
   * spotlit chip is locked, so the switch lives here: A4/Letter, plus card
   * once card mode exists. Choosing changes the real setting at once.
   */
  readonly choices: readonly TourReference[];
}

export interface TourOptions {
  readonly reference: TourReference;
  /** Card mode is built and switched on (A line's feature flag). */
  readonly cardModeAvailable: boolean;
}

/**
 * The four steps for this reference, before the "is the target on screen"
 * filter. Paper and card differ in step 1 (card joins the choice once card
 * mode exists)
 * and step 2 (the paper frame, or the card slot).
 */
export function buildTourSteps(options: TourOptions): TourStepDef[] {
  const card = options.cardModeAvailable && options.reference === "card";
  return [
    {
      id: "reference",
      target: "reference-chip",
      placement: "auto",
      choices: options.cardModeAvailable
        ? ["a4", "letter", "card"]
        : ["a4", "letter"],
    },
    card
      ? {
          id: "placement",
          target: "card-layout",
          fallbackTarget: "card-slot",
          placement: "auto",
          choices: [],
        }
      : {
          id: "placement",
          target: "paper-frame",
          placement: "dock-bottom",
          choices: [],
        },
    { id: "cue", target: "cue", placement: "auto", choices: [] },
    { id: "shutter", target: "shutter", placement: "auto", choices: [] },
  ];
}

/**
 * Toutour's `when` rule: a step whose target is not on screen is dropped
 * before the steps are counted, so "n／total" never counts a step that is not
 * shown.
 */
export function visibleTourSteps(
  steps: readonly TourStepDef[],
  isPresent: (target: TourTargetId) => boolean,
): TourStepDef[] {
  const out: TourStepDef[] = [];
  for (const step of steps) {
    if (isPresent(step.target)) out.push(step);
    else if (step.fallbackTarget && isPresent(step.fallbackTarget))
      out.push({ ...step, target: step.fallbackTarget });
  }
  return out;
}

// ---------------------------------------------------------------------------
// State machine

export type TourTrigger = "auto" | "help";

export type TourState =
  | { readonly phase: "closed" }
  /** "第一次掃描嗎？" — not counted as a step. */
  | { readonly phase: "welcome" }
  | {
      readonly phase: "step";
      readonly index: number;
      readonly trigger: TourTrigger;
    };

export type TourEvent =
  /** First use: the welcome question. */
  | { readonly type: "openAuto" }
  /** "?": straight to step 1, no question. */
  | { readonly type: "openHelp" }
  | { readonly type: "answerFirst" }
  | { readonly type: "answerReturning" }
  | { readonly type: "next" }
  | { readonly type: "back" }
  /** "略過教學", or Escape. */
  | { readonly type: "skip" }
  /** The visible step list changed (a target came or went). */
  | { readonly type: "stepsChanged" };

export type TourAnalyticsEvent =
  | { readonly name: "scan_tour_started"; readonly trigger: TourTrigger }
  | {
      readonly name: "scan_tour_step_viewed";
      readonly step: number;
      readonly stepId: TourStepId;
    }
  | { readonly name: "scan_tour_completed" }
  | { readonly name: "scan_tour_skipped"; readonly step: number }
  | {
      readonly name: "scan_tour_first_use_answer";
      readonly answer: "first" | "returning";
    };

export type TourEffect =
  /** Write `openMouse.easyScan.firstRunTipSeen`. */
  | { readonly kind: "markSeen" }
  /** The tour is over: resume the live loop. */
  | { readonly kind: "close" }
  | { readonly kind: "track"; readonly event: TourAnalyticsEvent };

export interface TourTransition {
  readonly state: TourState;
  readonly effects: readonly TourEffect[];
}

const CLOSED: TourState = { phase: "closed" };

function enterStep(
  index: number,
  trigger: TourTrigger,
  steps: readonly TourStepDef[],
  extra: readonly TourEffect[] = [],
): TourTransition {
  const step = steps[index];
  if (!step) return { state: CLOSED, effects: [...extra, { kind: "close" }] };
  return {
    state: { phase: "step", index, trigger },
    effects: [
      ...extra,
      {
        kind: "track",
        event: {
          name: "scan_tour_step_viewed",
          step: index + 1,
          stepId: step.id,
        },
      },
    ],
  };
}

/**
 * One transition. `steps` is the visible list (after `visibleTourSteps`).
 * Skipping and finishing both mark the tip as seen (design §3); a tour with
 * no step to show closes without marking it, so it can show once the camera
 * screen is there.
 */
export function tourTransition(
  state: TourState,
  event: TourEvent,
  steps: readonly TourStepDef[],
): TourTransition {
  switch (event.type) {
    case "openAuto":
      // The question needs no target, so it shows even before the camera
      // screen has laid out; "教我" with nothing to point at closes.
      if (state.phase !== "closed") return { state, effects: [] };
      return { state: { phase: "welcome" }, effects: [] };
    case "openHelp":
      if (state.phase !== "closed") return { state, effects: [] };
      if (steps.length === 0)
        return { state: CLOSED, effects: [{ kind: "close" }] };
      return enterStep(0, "help", steps, [
        {
          kind: "track",
          event: { name: "scan_tour_started", trigger: "help" },
        },
      ]);
    case "answerFirst":
      if (state.phase !== "welcome") return { state, effects: [] };
      // Nothing to point at (review item 2): the answer is kept, but no tour
      // started, and the tip is not marked seen, so it can show once the
      // camera screen is there.
      if (steps.length === 0)
        return {
          state: CLOSED,
          effects: [
            {
              kind: "track",
              event: { name: "scan_tour_first_use_answer", answer: "first" },
            },
            { kind: "close" },
          ],
        };
      return enterStep(0, "auto", steps, [
        {
          kind: "track",
          event: { name: "scan_tour_first_use_answer", answer: "first" },
        },
        {
          kind: "track",
          event: { name: "scan_tour_started", trigger: "auto" },
        },
      ]);
    case "answerReturning":
      if (state.phase !== "welcome") return { state, effects: [] };
      return {
        state: CLOSED,
        effects: [
          {
            kind: "track",
            event: { name: "scan_tour_first_use_answer", answer: "returning" },
          },
          { kind: "markSeen" },
          { kind: "close" },
        ],
      };
    case "next":
      if (state.phase !== "step") return { state, effects: [] };
      if (state.index >= steps.length - 1)
        return {
          state: CLOSED,
          effects: [
            { kind: "track", event: { name: "scan_tour_completed" } },
            { kind: "markSeen" },
            { kind: "close" },
          ],
        };
      return enterStep(state.index + 1, state.trigger, steps);
    case "back":
      if (state.phase !== "step" || state.index === 0)
        return { state, effects: [] };
      return enterStep(state.index - 1, state.trigger, steps);
    case "skip":
      if (state.phase === "closed") return { state, effects: [] };
      return {
        state: CLOSED,
        effects: [
          {
            kind: "track",
            event: {
              name: "scan_tour_skipped",
              step: state.phase === "step" ? state.index + 1 : 0,
            },
          },
          { kind: "markSeen" },
          { kind: "close" },
        ],
      };
    case "stepsChanged":
      if (state.phase !== "step") return { state, effects: [] };
      if (steps.length === 0)
        return { state: CLOSED, effects: [{ kind: "close" }] };
      if (state.phase === "step" && state.index > steps.length - 1)
        return enterStep(steps.length - 1, state.trigger, steps);
      return { state, effects: [] };
  }
}

// ---------------------------------------------------------------------------
// Geometry

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Design §5: the ring is 6 px outside the target, its corners follow it. */
export const SPOTLIGHT_PAD = 6;
/** Space between the ring and the card, which carries the arrow. */
export const TOOLTIP_GAP = 14;
/** Distance from the screen's edges. */
export const SCREEN_MARGIN = 16;
/** The card's widest (a column like the sheets' 28rem). */
export const TOOLTIP_MAX_WIDTH = 448;

export function inflateRect(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  };
}

/** Spotlight radius fixed by the design (Pencil card-2: r18), not derived. */
export const FIXED_SPOTLIGHT_RADIUS: Partial<Record<TourTargetId, number>> = {
  "card-layout": 18,
};

/**
 * The spotlight's corner radius: the target's own radius plus the pad,
 * capped at half the smaller side (a pill stays a pill, a circle a circle).
 */
export function spotlightRadius(targetRadius: number, hole: Rect): number {
  const r = Math.max(0, targetRadius) + SPOTLIGHT_PAD;
  return Math.min(r, Math.min(hole.width, hole.height) / 2);
}

/** The bounding box of the stage-pixel guide corners, in the viewport. */
export function guideRectInViewport(
  stage: { readonly left: number; readonly top: number } | null | undefined,
  guide: readonly { readonly x: number; readonly y: number }[] | null,
): Rect | null {
  if (!stage || !guide || guide.length === 0) return null;
  const xs = guide.map((p) => p.x);
  const ys = guide.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  if (!(width > 0 && height > 0)) return null;
  return { x: stage.left + minX, y: stage.top + minY, width, height };
}

export interface TooltipPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  /** Where the arrow is, or null (docked card). */
  readonly arrow: {
    readonly side: "top" | "bottom";
    /** From the card's left edge to the arrow's centre. */
    readonly offset: number;
  } | null;
  /** True only when neither side had room: the card then covers the ring. */
  readonly overlaps: boolean;
}

function tooltipWidth(viewport: Size): number {
  return Math.min(viewport.width - 2 * SCREEN_MARGIN, TOOLTIP_MAX_WIDTH);
}

function centredX(viewport: Size, width: number): number {
  return Math.round((viewport.width - width) / 2);
}

/**
 * Where the card goes. `avoid` is everything that must stay uncovered: the
 * ring, plus any labels drawn beside it. The card never covers it when either
 * side has room (design §5, "說明卡一律不蓋亮框").
 */
export function placeTooltip(
  avoid: Rect,
  tooltip: Size,
  viewport: Size,
  placement: TourStepDef["placement"],
): TooltipPlacement {
  const width = tooltipWidth(viewport);
  const minY = SCREEN_MARGIN;
  const maxBottom = viewport.height - SCREEN_MARGIN;
  const roomBelow = maxBottom - (avoid.y + avoid.height);
  const roomAbove = avoid.y - minY;

  if (placement === "dock-bottom") {
    const x = centredX(viewport, width);
    const docked = maxBottom - tooltip.height;
    if (docked >= avoid.y + avoid.height + TOOLTIP_GAP / 2)
      return { x, y: docked, width, arrow: null, overlaps: false };
    if (roomAbove >= tooltip.height + TOOLTIP_GAP / 2)
      return { x, y: minY, width, arrow: null, overlaps: false };
    return {
      x,
      y: Math.max(minY, docked),
      width,
      arrow: null,
      overlaps: true,
    };
  }

  const centreX = avoid.x + avoid.width / 2;
  const x = Math.round(
    Math.min(
      Math.max(centreX - width / 2, SCREEN_MARGIN),
      viewport.width - SCREEN_MARGIN - width,
    ),
  );
  const offset = Math.min(Math.max(centreX - x, 24), width - 24);
  const need = tooltip.height + TOOLTIP_GAP;
  const below = roomBelow >= need;
  const above = roomAbove >= need;
  if (below && (!above || roomBelow >= roomAbove))
    return {
      x,
      y: Math.round(avoid.y + avoid.height + TOOLTIP_GAP),
      width,
      arrow: { side: "top", offset },
      overlaps: false,
    };
  if (above)
    return {
      x,
      y: Math.round(avoid.y - TOOLTIP_GAP - tooltip.height),
      width,
      arrow: { side: "bottom", offset },
      overlaps: false,
    };
  return {
    x: centredX(viewport, width),
    y: Math.max(minY, maxBottom - tooltip.height),
    width,
    arrow: null,
    overlaps: true,
  };
}

export function unionRect(a: Rect, b: Rect | null): Rect {
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function rectsClose(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}
