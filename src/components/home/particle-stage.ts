import finaleJson from "@/lib/particles/finale.generated.json";
import targetsJson from "@/lib/particles/targets.generated.json";
import {
  PARTICLE_SEED,
  type Renderer,
  canvasScale,
  glCanvasScale,
  mayAnimate,
  particleCount,
  shimmerAt,
} from "@/lib/particles/budget";
import {
  type GuardState,
  armOnScroll,
  SCROLL_TAIL_MS,
  breakChain,
  guardForBudget,
  newGuard,
  observeFrame,
} from "@/lib/particles/degrade";
import {
  GL_FLOATS_PER_PARTICLE,
  packParticles,
} from "@/lib/particles/gl-buffers";
import {
  LATE_FADE_ATTEMPTS,
  LATE_FADE_IN_MS,
  LATE_FADE_MARGIN_MS,
  LATE_FADE_OUT_MS,
  LATE_SWITCH_IDLE_MS,
  type StaticBlock,
  fadeCheck,
  lateSwitchAllowed,
  planLateSwitch,
  scrollForTarget,
  storyAnchors,
} from "@/lib/particles/late-start";
import { parseFinaleTargets } from "@/lib/particles/load-finale";
import { finaleShape, finaleSlotName } from "@/lib/particles/finale-shape";
import { parseTargets } from "@/lib/particles/load-targets";
import { smoothSpeed, trailScale } from "@/lib/particles/starfield";
import { retryDelay, retryStep } from "@/lib/particles/retry";
import { legLook } from "@/lib/particles/look";
import {
  type NoteShape,
  type NoteText,
  noteMode,
  noteTextWidths,
  placeNotes,
  sideRoom,
} from "@/lib/particles/note-layout";
import {
  type MiceLayout,
  type Pairing,
  MOUSE_COUNT,
  buildPairing,
  buildPairingInSlices,
} from "@/lib/particles/pairing";
import {
  type Frame,
  type ParticleSet,
  type Rect,
  type StageLayout,
  buildParticleSet,
  createFrame,
  handBox,
  legOf,
  logoBox,
  markClipped,
  mouseBox,
  pairingTablesInSlices,
  writeParticles,
} from "@/lib/particles/particle-set";
import {
  STAR_ORDER_SEED,
  starOrder,
  starOrderInSlices,
} from "@/lib/particles/star-order";
import {
  NOTE_COUNT,
  type Phase,
  phaseAt,
  sectionProgress,
} from "@/lib/particles/timeline";
import {
  type FinaleFrame,
  type FinaleScene,
  buildFinaleScene,
  drawFinale,
  isBlocked,
} from "./stage-finale";
import { type GlRenderer, createGlRendererSteps } from "./stage-gl";
import {
  type OutlineLayer,
  type Sprites,
  createOutlineLayer,
  createSprites,
  drawStage,
} from "./stage-render";

/**
 * The home page's particle stage (Home v3, PR B; spec: docs/design/
 * home-v3-2026-10-03/README.md). This module is loaded with a dynamic import
 * after the first paint, so it never delays LCP. It owns everything that
 * touches the DOM: it measures the static layout PR A built, draws the first
 * frame on a canvas, and only then adds `story--animated`, which turns the
 * story section into a tall section with a pinned 100svh panel. Scrolling is
 * native; progress p comes from the section's position, and a requestAnimation-
 * Frame draw runs only while something changes (a scroll, a resize, the
 * one-time shimmer), is paused off screen and in a hidden tab, and never loops
 * on its own.
 *
 * Two drawing paths share one stage. The particles are drawn with WebGL
 * (stage-gl.ts: one program, static buffers, one draw call, the interpolation
 * in the vertex shader) on a canvas under the 2D one, which then only carries
 * the overlay. Without WebGL, or when it fails (the shaders do not compile, the
 * GPU's largest point is too small, the context is lost), the stage draws the
 * particles on the 2D canvas as before, with the old, smaller budget, and says
 * which path it is on in `data-renderer` on the section. The WebGL path also
 * draws fewer particles when its frames come slowly (degrade.ts).
 *
 * Anything that goes wrong (no 2D context, a bad targets file, a draw that
 * throws) takes the page back to the static layout. The maths lives in
 * src/lib/particles/ and is unit tested; this file is covered by the e2e suite.
 */

const baseTargets = parseTargets(targetsJson);
const finale = parseFinaleTargets(finaleJson);
/**
 * The story's targets with the finale's drawing filed among the last state's
 * drawings, once per density tier (a desktop and a phone sample the drawing
 * at their own spacing): the pairing reads them by name like a mouse sketch.
 */
const targets = {
  ...baseTargets,
  mice: {
    ...baseTargets.mice,
    [finaleSlotName("desktop")]: finaleShape(finale, "desktop"),
    [finaleSlotName("mobile")]: finaleShape(finale, "mobile"),
  },
};

const ANIMATED = "story--animated";
const WIDE = "(min-width: 48rem)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const MORE_CONTRAST = "(prefers-contrast: more)";
/** Forced colours (Windows contrast themes): the finale's headline is DOM text in the system's colours, and the canvas leaves it out. */
const FORCED_COLORS = "(forced-colors: active)";
/** What tells a scroll the reader made from one the browser made on its own (late start: the fade attempts are forgotten only for the reader's). */
const READER_INPUT = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
/** How far the hero text moves up while it fades, in CSS px. */
const HERO_SHIFT_PX = 40;
/** How far an annotation's text sits below its place while it is fading in or out, in CSS px. */
const NOTE_SHIFT_PX = 8;

export interface StageHandle {
  destroy(): void;
}

/** The finale (story 6): its static drawing (where the particles land), its headline, and the light behind it. */
interface FinaleParts {
  readonly root: HTMLElement;
  readonly img: HTMLElement;
  readonly title: HTMLElement;
  readonly glow: HTMLElement | null;
  /** The final section's buttons, which come up over the finale at the end: no star goes there. */
  readonly actions: HTMLElement | null;
}

interface Parts {
  readonly section: HTMLElement;
  readonly panel: HTMLElement;
  readonly hero: HTMLElement;
  readonly logo: HTMLElement;
  readonly handImg: HTMLElement;
  readonly sheet: HTMLElement | null;
  /** The five annotations' text blocks, in order: each its own element, with a small line inside. Empty when the page has not got exactly five. */
  readonly notes: readonly NoteParts[];
  readonly finale: FinaleParts;
}

interface NoteParts {
  readonly block: HTMLElement;
  readonly why: HTMLElement;
}

function findNotes(section: HTMLElement): NoteParts[] {
  const notes = [...section.querySelectorAll<HTMLElement>(".story-note")].map(
    (block): NoteParts | null => {
      const why = block.querySelector<HTMLElement>(".story-note-why");
      return why ? { block, why } : null;
    },
  );
  return notes.length === NOTE_COUNT && notes.every((n) => n !== null)
    ? (notes as NoteParts[])
    : [];
}

function findParts(canvas: HTMLCanvasElement): Parts | null {
  const section = canvas.closest<HTMLElement>(".story");
  const panel = canvas.closest<HTMLElement>(".story-panel");
  const hero = section?.querySelector<HTMLElement>(".story-hero");
  const logo = section?.querySelector<HTMLElement>(".story-logo img");
  const handImg = section?.querySelector<HTMLElement>(".story-hand img");
  if (!section || !panel || !hero || !logo || !handImg) return null;
  // Exactly one finale, with its drawing and its headline: without them the
  // story has no last state and the page stays static.
  const finales = section.querySelectorAll<HTMLElement>(".story-finale");
  const root = finales[0];
  if (finales.length !== MOUSE_COUNT || !root) return null;
  const img = root.querySelector<HTMLElement>(".story-finale-art img");
  const title = root.querySelector<HTMLElement>(".story-finale-title");
  if (!img || !title) return null;
  return {
    section,
    panel,
    hero,
    logo,
    handImg,
    sheet: section.querySelector<HTMLElement>(".story-hand-sheet"),
    notes: findNotes(section),
    finale: {
      root,
      img,
      title,
      glow: root.querySelector<HTMLElement>(".story-finale-glow"),
      actions: document.querySelector<HTMLElement>(".home-final .home-actions"),
    },
  };
}

/**
 * `canvas` is the 2D layer (the top one). `glCanvas`, the WebGL layer under
 * it, is optional: without it the stage is Canvas 2D only.
 */
export function startParticleStage(
  canvas: HTMLCanvasElement,
  glCanvas?: HTMLCanvasElement | null,
  skyCanvas?: HTMLCanvasElement | null,
): StageHandle {
  const parts = findParts(canvas);
  if (!parts) return { destroy() {} };
  const stage = new Stage(canvas, glCanvas ?? null, parts, skyCanvas ?? null);
  stage.start();
  return { destroy: () => stage.destroy() };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Let the browser run what is waiting (input, a frame) before the next slice of work. */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

class Stage {
  private animated = false;
  private destroyed = false;
  private everActivated = false;

  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private sprites: Sprites | null = null;
  private spritesKey = "";
  private pairing: Pairing | null = null;
  private pairingKey = "";
  private layout: StageLayout | null = null;
  private set: ParticleSet | null = null;
  private frame: Frame | null = null;
  /** The hand's outline layer and the size it was drawn for; the annotations' shapes for the current layout. */
  private outline: OutlineLayer | null = null;
  private outlineKey = "";
  private noteShapes: readonly NoteShape[] = [];
  /** False when the notes have no place that keeps clear of the sheet's bottom edge: none of them is shown. */
  private notesShown = false;
  /** The finale's headline and sky for the current layout (null until built, or when it could not be). */
  private finaleScene: FinaleScene | null = null;
  /** The finale's place on the canvas, for its scene (built after the particles). */
  private finaleRect: Rect | null = null;
  /** The sky canvas's 2D context, once made. */
  private skyCtx: CanvasRenderingContext2D | null = null;
  /** The finale's frame, filled in for each draw (no allocation per frame). */
  private readonly finaleFrame: FinaleFrame = {
    phase: phaseAt(0).finale,
    progress: 0,
    trail: 1,
    glow: true,
    share: 1,
    headline: true,
  };
  /** One timer per scroll: once the reader has stopped, the meteors' tails go back to their rest length in one more frame. */
  private settleTimer = 0;
  /** The scroll speed the meteors' tails follow (px/s, smoothed), and the scroll position and time it was last taken at. */
  private scrollSpeed = 0;
  private speedY = 0;
  private speedAt = 0;

  /** The drawing path in use now. "2d" until WebGL has been made, and for good once it has failed. */
  private renderer: Renderer = "2d";
  private gl: GlRenderer | null = null;
  /** WebGL has failed (or is missing) this visit: it is not tried again. */
  private glFailed = false;
  /** The pairing is built (in slices, off the activation task) and the drawing path is chosen. */
  private ready = false;
  private preparing = false;
  /** What the pre-activation slices set up (canvas sizes, the first set of particles), and for which layout; `activate` reuses it when nothing moved. */
  private warmKey = "";
  /** The layout was measured for the first frame only: measure it for real in the first frame of the animated layout. */
  private needsMeasure = false;
  /** The first frame of the animated layout has gone by since `needsMeasure` was set (see `tick`). */
  private measureWaited = false;
  /** How many of the measure's three parts (the rects and the particles; the upload; the outline and the notes) the frames since have done: while the reader has not scrolled they are one frame each. */
  private measureStep = 0;
  /** What the first part measured, for the third. */
  private measured: { origin: DOMRect; handRect: Rect } | null = null;
  /** The particle budget of the drawing path in use, and how many of them the WebGL path draws now (the guard only lowers it). */
  private budget = 0;
  private guard: GuardState = newGuard(0);
  /** The order the particles are uploaded in (the pairing's, evenly spread: the first N are an even scatter on every drawing, and the stars come first), and the buffer they are packed into. */
  private order: Uint32Array | null = null;
  private glData: Float32Array | null = null;

  private rafId = 0;
  /** When the last scroll event came (ms): the WebGL path keeps its frame loop running for a short tail after it. */
  private lastScrollAt = 0;
  private reflowId = 0;
  private dirty = true;
  private lastP = -1;
  private visible = true;

  /**
   * Starting away from the top (late-start.ts): "waiting" for the reader to
   * hold still (`lateTimer` is the wait), "fading" while the panel fades out
   * before the switch (`lateTimer` is the fade). `fadeTimer` ends a fade in.
   */
  /** "parked": the whole static story fits in the viewport, so the stage waits for the top (lateSwitchAllowed). */
  private lateState: "none" | "waiting" | "fading" | "parked" = "none";
  private lateTimer = 0;
  /** The frame `confirmFaded` looks again in, and how many fades gave up since the reader last scrolled. */
  private lateFrame = 0;
  private lateFadeFailures = 0;
  /** The reader used a wheel, a touch, a key or a pointer since the last scroll: the next scroll is theirs. */
  private readerInput = false;
  private fadeTimer = 0;
  /** The next scroll event is the one the late switch caused, not the reader's. */
  private selfScroll = false;

  /** `prepare` failed this many times; a retry is waiting on its timer, or on the tab being shown; or no try is left. */
  private prepareFailures = 0;
  private retryTimer = 0;
  private retryWhenShown = false;
  private prepareGaveUp = false;

  private shimmerStart = 0;
  private shimmerOver = false;
  private draws = 0;

  /** What the last frame wrote to the DOM, so an unchanged value is not written again. */
  private written: {
    opacity?: string;
    transform?: string;
    inert?: boolean;
    sheet?: string;
    glow?: string;
    title?: string;
    notes?: string;
  } = {};

  /** True while the h1 carries the tabindex this stage gave it. */
  private headingTabindexSet = false;

  private readonly probe: HTMLElement;
  private readonly controls: HTMLElement[];
  private readonly queries: Record<
    "wide" | "reduced" | "contrast" | "forced",
    MediaQueryList
  >;
  private resize: ResizeObserver | null = null;
  private intersection: IntersectionObserver | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly glCanvas: HTMLCanvasElement | null,
    private readonly parts: Parts,
    /** The finale's sky, the whole viewport wide, under the particles (optional: without it the sky is drawn in the panel). */
    private readonly skyCanvas: HTMLCanvasElement | null = null,
  ) {
    this.queries = {
      wide: window.matchMedia(WIDE),
      reduced: window.matchMedia(REDUCED_MOTION),
      contrast: window.matchMedia(MORE_CONTRAST),
      forced: window.matchMedia(FORCED_COLORS),
    };
    // 100svh, measured by the browser itself (100vh where svh is unknown), so
    // it is the same number the panel's CSS height resolves to.
    this.probe = document.createElement("div");
    this.probe.setAttribute("aria-hidden", "true");
    Object.assign(this.probe.style, {
      position: "absolute",
      visibility: "hidden",
      pointerEvents: "none",
      width: "0",
      top: "0",
      left: "0",
    });
    this.probe.style.height = "100vh";
    this.probe.style.height = "100svh";
    this.controls = [
      ...parts.hero.querySelectorAll<HTMLElement>("a[href], button"),
    ];
  }

  start(): void {
    this.parts.section.append(this.probe);
    window.addEventListener("scroll", this.onScroll, { passive: true });
    for (const type of READER_INPUT) {
      window.addEventListener(type, this.onReaderInput, {
        passive: true,
        capture: true,
      });
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    for (const query of Object.values(this.queries)) {
      query.addEventListener("change", this.requestReflow);
    }
    this.resize = new ResizeObserver(this.requestReflow);
    this.resize.observe(this.parts.section);
    this.resize.observe(this.parts.hero);
    // The probe is 100svh tall: it is what notices a change of the viewport's
    // height alone (a window dragged taller or shorter), which changes neither
    // the section's width nor the hero's.
    this.resize.observe(this.probe);
    this.reflow();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.deactivate();
    window.removeEventListener("scroll", this.onScroll);
    for (const type of READER_INPUT) {
      window.removeEventListener(type, this.onReaderInput, { capture: true });
    }
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const query of Object.values(this.queries)) {
      query.removeEventListener("change", this.requestReflow);
    }
    this.resize?.disconnect();
    if (this.reflowId) cancelAnimationFrame(this.reflowId);
    this.stopLateTimers();
    window.clearTimeout(this.fadeTimer);
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.settleTimer);
    this.parts.panel.style.transition = "";
    this.parts.panel.style.opacity = "";
    this.probe.remove();
    this.gl?.dispose();
    this.gl = null;
  }

  // ── Switching the layout ────────────────────────────────────────────────

  private readonly requestReflow = (): void => {
    if (this.destroyed || this.reflowId) return;
    this.reflowId = requestAnimationFrame(() => {
      this.reflowId = 0;
      this.reflow();
    });
  };

  /** Decide whether the animated layout may be on, and bring the page in line. */
  private reflow(): void {
    if (this.destroyed) return;
    const panelHeight = this.probe.offsetHeight;
    if (!this.allowed(panelHeight)) {
      this.cancelLateSwitch();
      if (this.animated) this.deactivate();
      return;
    }
    try {
      if (!this.animated) {
        if (!this.ready) {
          // The heavy part (the drawing path, the pairing) is built in slices,
          // off this task, wherever the reader is; it asks for another reflow
          // when it is done.
          this.prepare();
          return;
        }
        if (this.parts.section.getBoundingClientRect().top < 0) {
          // Away from the top the switch would move what the reader is
          // looking at: it waits until they hold still, and then keeps the
          // page in place or fades the story through (see `lateSwitch`).
          this.armLateSwitch();
          return;
        }
        // At the top the switch moves nothing: now.
        this.cancelLateSwitch();
        this.lateFadeFailures = 0;
        this.activate(panelHeight);
      } else {
        this.remeasure(panelHeight);
      }
    } catch {
      this.deactivate();
    }
  }

  /** Whether the animated layout may be on (motion allowed, the hero fits, the viewport is tall enough). */
  private allowed(panelHeight: number): boolean {
    return mayAnimate({
      reducedMotion: this.queries.reduced.matches,
      heroHeight: this.parts.hero.offsetHeight,
      panelHeight,
      // The small viewport, like the panel: window.innerHeight would change
      // while a phone's toolbars slide, and the page would flap between the
      // two layouts around the 600 px line.
      viewportHeight: panelHeight,
    });
  }

  // ── Switching away from the top (late-start.ts) ─────────────────────────

  /**
   * Wait for the reader to hold still: each scroll starts the wait again. One
   * timer, no loop. Once `LATE_FADE_ATTEMPTS` fades have given up, nothing is
   * scheduled (whatever asks: a resize, the tab shown again, a media query)
   * until the reader scrolls, which forgets the failures (`onScroll`).
   */
  private armLateSwitch(): void {
    if (this.destroyed || this.animated || this.lateState === "fading") return;
    if (
      !lateSwitchAllowed(
        this.parts.section.getBoundingClientRect().height,
        window.innerHeight,
      )
    ) {
      // A window taller than the static story: wait for the top.
      window.clearTimeout(this.lateTimer);
      this.lateTimer = 0;
      this.lateState = "parked";
      return;
    }
    this.lateState = "waiting";
    window.clearTimeout(this.lateTimer);
    this.lateTimer = 0;
    if (this.lateFadeFailures >= LATE_FADE_ATTEMPTS) return;
    this.lateTimer = window.setTimeout(this.lateSwitch, LATE_SWITCH_IDLE_MS);
  }

  /** Stop a late switch that has not happened yet; a fade out that had begun fades back in. */
  private cancelLateSwitch(): void {
    this.stopLateTimers();
    if (this.lateState === "fading") this.fadePanelIn();
    this.lateState = "none";
  }

  private stopLateTimers(): void {
    window.clearTimeout(this.lateTimer);
    this.lateTimer = 0;
    if (this.lateFrame) cancelAnimationFrame(this.lateFrame);
    this.lateFrame = 0;
  }

  /**
   * The fade out's time is up: switch only if the tab is shown and the panel
   * really is transparent (fadeCheck). Otherwise look again next frame, a
   * bounded number of times; a hidden tab, or a panel still visible after
   * that, gives the fade up: the panel fades back in and nothing moved.
   */
  private readonly confirmFaded = (frames: number, since: number): void => {
    this.lateFrame = 0;
    if (this.destroyed || this.animated || this.lateState !== "fading") return;
    const check = fadeCheck({
      hidden: document.hidden,
      opacity: Number(getComputedStyle(this.parts.panel).opacity),
      frames,
      elapsedMs: performance.now() - since,
    });
    if (check === "switch") {
      this.lateState = "none";
      this.switchLate(true);
    } else if (check === "next-frame") {
      this.lateFrame = requestAnimationFrame(() =>
        this.confirmFaded(frames + 1, since),
      );
    } else {
      this.giveUpFade(check === "hidden");
    }
  };

  /**
   * The fade out did not get to a switch: fade back in and keep waiting. A
   * hidden tab waits until it is shown (`onVisibility` asks for a reflow,
   * which waits for stillness again); a panel that would not turn transparent
   * is tried again after the idle wait, `LATE_FADE_ATTEMPTS` times in all
   * until the reader scrolls (one timer each: nothing loops on its own).
   */
  private giveUpFade(hidden: boolean): void {
    this.stopLateTimers();
    this.fadePanelIn();
    this.lateState = "waiting";
    if (hidden) return;
    this.lateFadeFailures += 1;
    this.armLateSwitch();
  }

  /** The reader has held still: switch, after fading the panel out if part of the story is in view. */
  private readonly lateSwitch = (): void => {
    this.lateTimer = 0;
    if (this.destroyed || this.animated || this.lateState !== "waiting") return;
    // A hidden tab switches when it is shown (`onVisibility` asks for a reflow).
    if (document.hidden) return;
    const { section, panel } = this.parts;
    const panelHeight = this.probe.offsetHeight;
    const box = section.getBoundingClientRect();
    if (!this.allowed(panelHeight) || box.top >= 0) {
      this.lateState = "none";
      this.requestReflow();
      return;
    }
    // Only whether to fade is decided here; where the reader goes is worked
    // out after the switch, from the animated layout's real height.
    const { fade } = planLateSwitch({
      staticTop: box.top,
      staticHeight: box.height,
      animatedHeight: box.height,
      panelHeight,
      viewportHeight: window.innerHeight,
      anchors: [],
    });
    if (!fade) {
      this.lateState = "none";
      this.switchLate(false);
      return;
    }
    this.lateState = "fading";
    // A fade in still running (a fade out that a scroll cut short) would take
    // the transition off this fade out when its timer is up: stop it first.
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = 0;
    panel.style.transition = `opacity ${LATE_FADE_OUT_MS}ms ease-out`;
    panel.style.opacity = "0";
    this.lateTimer = window.setTimeout(() => {
      this.lateTimer = 0;
      this.confirmFaded(0, performance.now());
    }, LATE_FADE_OUT_MS + LATE_FADE_MARGIN_MS);
  };

  /**
   * Switch to the animated layout away from the top, in one task: measure the
   * static story, switch, and scroll to where `planLateSwitch` puts the reader
   * (the bottom edge kept in place below the story; the matching progress
   * inside it, under the fade). The browser's scroll anchoring is off for
   * that task, so the one scroll made here is the only one.
   */
  private switchLate(faded: boolean): void {
    if (this.destroyed || this.animated) {
      if (faded) this.fadePanelIn();
      return;
    }
    const { section, handImg, notes, finale: finaleParts } = this.parts;
    const panelHeight = this.probe.offsetHeight;
    const box = section.getBoundingClientRect();
    // The final section's gap under the static story (its top edge less the
    // section's bottom edge), to set against the animated one's after the switch.
    const final = section.nextElementSibling;
    const staticGap = final
      ? final.getBoundingClientRect().top - box.bottom
      : 0;
    if (!this.allowed(panelHeight)) {
      if (faded) this.fadePanelIn();
      return;
    }
    const block = (element: Element | null | undefined): StaticBlock | null => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top - box.top, height: rect.height };
    };
    const anchors = storyAnchors({
      staticHeight: box.height,
      hand: block(handImg.closest(".story-hand")),
      notes: block(notes[0]?.block.parentElement),
      mice: block(finaleParts.root),
    });
    const root = document.documentElement;
    const anchoring = root.style.overflowAnchor;
    root.style.overflowAnchor = "none";
    try {
      this.activate(panelHeight);
      if (this.animated) {
        // Switched: a later late start (after going static again) begins afresh.
        this.lateFadeFailures = 0;
        const after = section.getBoundingClientRect();
        const animatedGap = final
          ? final.getBoundingClientRect().top - after.bottom
          : 0;
        const plan = planLateSwitch({
          staticTop: box.top,
          staticHeight: box.height,
          animatedHeight: after.height,
          panelHeight,
          viewportHeight: window.innerHeight,
          anchors,
          finalShift: staticGap - animatedGap,
        });
        const before = window.scrollY;
        window.scrollTo({
          top: scrollForTarget(before, after.top, plan.targetTop),
          behavior: "instant",
        });
        if (window.scrollY !== before) this.selfScroll = true;
      }
    } catch {
      this.deactivate();
    } finally {
      // Back on after this frame's layout, which the switch and the scroll are in.
      requestAnimationFrame(() => {
        root.style.overflowAnchor = anchoring;
      });
    }
    if (faded) this.fadePanelIn();
  }

  /** The panel back to full opacity, with a fade; the transition is removed once it is over. */
  private fadePanelIn(): void {
    const { panel } = this.parts;
    panel.style.transition = `opacity ${LATE_FADE_IN_MS}ms ease-out`;
    panel.style.opacity = "";
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.fadeTimer = 0;
      panel.style.transition = "";
    }, LATE_FADE_IN_MS + 50);
  }

  /**
   * Static to animated. The first frame is drawn before `story--animated` is
   * added, and the static logo is hidden only after that, in the same task, so
   * the page never shows two logos (or none).
   */
  private activate(panelHeight: number): void {
    const { section, logo } = this.parts;
    // Everything the first frame needs was normally made in the slices of
    // `prepare` (the canvases' sizes, the particles): this task only has to
    // draw it and switch the layout. If the page moved since, make it again.
    if (!this.warm(panelHeight)) return;
    section.dataset.renderer = this.renderer;
    this.shimmerOver = this.everActivated;
    this.shimmerStart = performance.now();
    this.draw(0, this.shimmerStart);

    // The first frame is on the canvas: switch the layout and hand the logo over.
    section.classList.add(ANIMATED);
    logo.style.visibility = "hidden";
    this.animated = true;
    this.everActivated = true;
    this.visible = true;

    // Now the animated layout exists: measure it, and redraw with the hand and
    // the mice where the page puts them. That is the first frame's job (the
    // layout pass it forces and the particles it rebuilds would make this task
    // long on a slow phone); the first frame only shows the logo, which is
    // already where it belongs.
    this.needsMeasure = true;
    this.dirty = true;
    this.lastP = -1;
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1]?.isIntersecting ?? true;
      this.guard = breakChain(this.guard);
      if (this.visible) {
        this.dirty = true;
        this.schedule();
      }
    });
    this.intersection.observe(this.canvas);
    this.schedule();
  }

  private remeasure(panelHeight: number): void {
    this.cssWidth = this.parts.panel.clientWidth;
    this.cssHeight = panelHeight;
    // Setting a canvas's size clears it, so the frame is drawn again here, in
    // the same task: waiting for the next frame would show it empty, and
    // while a window is being dragged that is nearly every frame.
    this.fitCanvas();
    this.measureAndBuild();
    this.needsMeasure = false;
    this.measureWaited = false;
    this.measureStep = 0;
    this.dirty = true;
    this.redrawNow();
  }

  /** Draw the current frame now, if the stage is on screen; otherwise remember to. */
  private redrawNow(): void {
    if (!this.visible || document.hidden) return;
    const p = this.currentProgress();
    try {
      this.draw(p, performance.now());
    } catch {
      if (this.renderer === "webgl") this.useTwoD();
      else this.deactivate();
      return;
    }
    this.lastP = p;
    this.dirty = false;
    if (!this.shimmerOver) this.schedule();
  }

  private currentProgress(): number {
    const { section, panel } = this.parts;
    const box = section.getBoundingClientRect();
    return sectionProgress(box.top, box.height, panel.offsetHeight);
  }

  /** Animated to static: the page goes back to PR A's layout, as if nothing had loaded. */
  private deactivate(): void {
    this.cancelLateSwitch();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.intersection?.disconnect();
    this.intersection = null;
    const {
      section,
      hero,
      logo,
      sheet,
      finale: finaleParts,
      notes,
    } = this.parts;
    section.classList.remove(ANIMATED);
    logo.style.visibility = "";
    hero.style.opacity = "";
    hero.style.transform = "";
    // The annotations go back to the static list: nothing of the stage's is left on them.
    for (const { block } of notes) {
      for (const property of [
        "left",
        "top",
        "width",
        "text-align",
        "opacity",
        "transform",
      ]) {
        block.style.removeProperty(property);
      }
    }
    this.closeOutline();
    this.noteShapes = [];
    this.notesShown = false;
    for (const control of this.controls)
      control.toggleAttribute("inert", false);
    if (this.headingTabindexSet) {
      hero.querySelector("h1")?.removeAttribute("tabindex");
      this.headingTabindexSet = false;
    }
    if (sheet) sheet.style.opacity = "";
    if (finaleParts.glow) finaleParts.glow.style.opacity = "";
    if (finaleParts.glow) {
      finaleParts.glow.style.left = "";
      finaleParts.glow.style.right = "";
      finaleParts.glow.style.width = "";
    }
    if (this.skyCanvas) {
      this.skyCtx?.clearRect(0, 0, this.skyCanvas.width, this.skyCanvas.height);
      this.skyCanvas.style.left = "";
      this.skyCanvas.style.width = "";
    }
    finaleParts.title.style.opacity = "";
    this.finaleScene = null;
    delete section.dataset.progress;
    delete section.dataset.story;
    delete section.dataset.renderer;
    delete section.dataset.notes;
    delete section.dataset.finale;
    this.written = {};
    this.needsMeasure = false;
    this.measureWaited = false;
    this.measureStep = 0;
    this.animated = false;
  }

  // ── Measuring ───────────────────────────────────────────────────────────

  private fitCanvas(): void {
    this.fitTwoD();
    this.fitGl();
  }

  /** The 2D canvas: its size and the sprites (the overlay's halos, and the particles on the 2D path). */
  private fitTwoD(): void {
    const ctx = this.ctx!;
    this.dpr = canvasScale(window.devicePixelRatio);
    const width = Math.max(1, Math.round(this.cssWidth * this.dpr));
    const height = Math.max(1, Math.round(this.cssHeight * this.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const glow = !this.queries.contrast.matches;
    const key = `${this.dpr}:${glow}`;
    if (key !== this.spritesKey) {
      this.sprites = createSprites(this.dpr, glow);
      this.spritesKey = key;
    }
  }

  /** The WebGL canvas: its size, if the GPU can still draw the points at this pixel ratio (else the stage moves to the 2D path). */
  private fitGl(): void {
    if (this.renderer !== "webgl" || !this.gl) return;
    // The pixel ratio can change under a running page (a window dragged to
    // another screen, the browser's zoom): the biggest point the GPU must
    // draw changes with it.
    const pixelRatio = glCanvasScale(
      window.devicePixelRatio,
      this.queries.wide.matches,
    );
    if (this.gl.isLost() || !this.gl.fits(pixelRatio)) {
      this.useTwoD();
      return;
    }
    this.gl.resize(this.cssWidth, this.cssHeight, pixelRatio);
  }

  /** What a set-up of the first frame depends on: the drawing path, the sizes, the pixel ratio, the breakpoint, the contrast setting, and where the logo is. */
  private warmKeyFor(width: number, height: number, logo: Rect): string {
    return [
      this.renderer,
      width,
      height,
      window.devicePixelRatio,
      this.queries.wide.matches,
      this.queries.contrast.matches,
      logo.x,
      logo.y,
      logo.width,
      logo.height,
    ].join("|");
  }

  /**
   * Set up the first frame: the canvases' sizes and the particles for it, whose
   * logo is where the static image is (the hero is in the same place in both
   * layouts). The hand and the mice have no place in the static flow that
   * matches the animated one, so the first frame (only the logo is on it:
   * p = 0) borrows the logo's box for them. Returns false when there is no 2D
   * context. When `prepare`'s slices (`warmInSlices`) have done it for this
   * very layout it does nothing, so the activating task stays short.
   */
  private warm(panelHeight: number): boolean {
    const { panel, logo } = this.parts;
    const ctx = this.ctx ?? this.canvas.getContext("2d");
    if (!ctx) return false;
    this.ctx = ctx;
    const width = panel.clientWidth;
    const origin = panel.getBoundingClientRect();
    const logoRect = relative(logo.getBoundingClientRect(), origin);
    if (this.warmKeyFor(width, panelHeight, logoRect) === this.warmKey) {
      return true;
    }
    this.cssWidth = width;
    this.cssHeight = panelHeight;
    this.fitCanvas();
    this.buildSet(logoRect, logoRect, [logoRect]);
    // (`fitCanvas` may have fallen back to the 2D path: the key says which.)
    this.warmKey = this.warmKeyFor(width, panelHeight, logoRect);
    return true;
  }

  /** Read where the logo, the hand and the finale are on the page now, and rebuild the particles for them. */
  private measureAndBuild(): void {
    this.measureRects();
    this.measureFinale();
    this.uploadSet();
    this.measureLayout();
  }

  /** The first part of the measure: where the logo, the hand and the finale are, the particles for them, and the finale's headline and sky. */
  private measureRects(): void {
    const { panel, hero, logo, handImg, finale: finaleParts } = this.parts;
    const origin = panel.getBoundingClientRect();
    // The hero moves up as it fades; the logo's place is where it rests.
    const transform = hero.style.transform;
    hero.style.transform = "";
    const logoRect = relative(logo.getBoundingClientRect(), origin);
    hero.style.transform = transform;
    const handRect = relative(handImg.getBoundingClientRect(), origin);
    const finaleRect = relative(
      finaleParts.img.getBoundingClientRect(),
      origin,
    );
    this.buildSetData(logoRect, handRect, [finaleRect]);
    this.finaleRect = finaleRect;
    this.measured = { origin, handRect };
  }

  /** The second part of the measure: the finale's headline and sky, for the rects the first part found. */
  private measureFinale(): void {
    const measured = this.measured;
    if (measured) this.buildFinale(measured.origin);
  }

  /** The last part of the measure: the hand's outline and the notes' places, for the rects the first part found. */
  private measureLayout(): void {
    const measured = this.measured;
    if (!measured) return;
    this.buildOutline(measured.handRect);
    this.layoutNotes(measured.handRect, measured.origin);
  }

  /** The hand's outline, drawn once for this size of hand and device pixel ratio. */
  private buildOutline(handRect: Rect): void {
    const box = this.layout?.hand;
    if (!box) return;
    const key = [
      box.scale.toFixed(4),
      box.x.toFixed(1),
      box.y.toFixed(1),
      handRect.width.toFixed(1),
      handRect.height.toFixed(1),
      this.dpr,
    ].join(":");
    if (key === this.outlineKey && this.outline) return;
    this.closeOutline();
    this.outline = createOutlineLayer(box, handRect, this.dpr);
    this.outlineKey = key;
  }

  private closeOutline(): void {
    const image = this.outline?.image;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      image.close();
    }
    this.outline = null;
    this.outlineKey = "";
  }

  /**
   * Where the five annotations go for this layout: beside the hand when the
   * page has room at both its sides, below it otherwise. The text blocks get
   * their width first and are then measured (the height depends on the width);
   * the shapes (rings, leaders, positions) come from the pure layout in
   * src/lib/particles/note-layout.ts. Only left, top and width are written
   * here: opacity and transform are the frame's.
   */
  private layoutNotes(handRect: Rect, origin: DOMRect): void {
    const { notes, section } = this.parts;
    const box = this.layout?.hand;
    if (notes.length !== NOTE_COUNT || !box) {
      this.noteShapes = [];
      this.notesShown = false;
      return;
    }
    const room = sideRoom(
      origin.left + handRect.x,
      origin.left + handRect.x + handRect.width,
      document.documentElement.clientWidth,
    );
    const mode = noteMode(room);
    const widths = noteTextWidths(mode, handRect.width, room);
    const texts: NoteText[] = notes.map(({ block, why }, i) => {
      block.style.width = `${widths[i]}px`;
      return { height: block.offsetHeight, smallTop: why.offsetTop };
    });
    const shapes = placeNotes({
      box,
      rect: handRect,
      panel: { width: this.cssWidth, height: this.cssHeight },
      mode,
      widths,
      texts,
    });
    if (!shapes) {
      // No place for the text that clears the A4 sheet's bottom edge and fits
      // the panel (no room beside the hand and not enough under the sheet: in
      // Chromium at device pixel ratio 1, about 800 to 1000 px wide at 650 to
      // 850 px tall, to 1050 wide at 900 tall, and 600 to 850 wide at 600 tall;
      // the exact windows are in placeNotes' comment in note-layout.ts): show
      // no note, ring or leader. The text is still in the DOM, at opacity 0,
      // for a screen reader.
      for (const { block } of notes) {
        block.style.removeProperty("left");
        block.style.removeProperty("top");
      }
      this.noteShapes = [];
      this.notesShown = false;
      section.dataset.notes = "off";
      return;
    }
    notes.forEach(({ block }, i) => {
      const { text } = shapes[i]!;
      block.style.left = `${round3(text.left)}px`;
      block.style.top = `${round3(text.top)}px`;
      block.style.textAlign = text.align;
    });
    this.noteShapes = shapes;
    this.notesShown = true;
    section.dataset.notes = mode;
  }

  private buildSet(logo: Rect, hand: Rect, mice: readonly Rect[]): void {
    this.buildSetData(logo, hand, mice);
    this.uploadSet();
  }

  /** The particles for this layout, in canvas CSS px (and the pairing, if it is not built yet). */
  private buildSetData(logo: Rect, hand: Rect, mice: readonly Rect[]): void {
    const layoutKind: MiceLayout = this.queries.wide.matches
      ? "row"
      : "stacked";
    const sketches = this.finaleSketches();
    const count = this.countFor(this.renderer);
    const key = this.pairingKeyFor(this.renderer, count, layoutKind, sketches);
    if (key !== this.pairingKey || !this.pairing) {
      // Normally the slices in `prepare` have built this already; this is the
      // rare case where the layout moved on while they ran, or the stage fell
      // back to the 2D path.
      this.pairing = buildPairing(targets, {
        count,
        layout: layoutKind,
        seed: PARTICLE_SEED,
        mice: sketches,
        density: this.renderer === "webgl" ? "dense" : "sparse",
      });
      this.pairingKey = key;
      this.order =
        this.renderer === "webgl"
          ? starOrder(this.pairing, STAR_ORDER_SEED)
          : null;
    }
    if (count !== this.budget) {
      this.budget = count;
      this.guard = guardForBudget(this.guard, count);
      this.frame = this.renderer === "2d" ? createFrame(count) : null;
      // For the e2e suite and for anyone checking the budget in the inspector.
      this.canvas.dataset.particles = String(count);
      this.canvas.dataset.drawn = String(count);
    }
    this.layout = {
      width: this.cssWidth,
      height: this.cssHeight,
      logo: logoBox(logo),
      hand: handBox(hand, targets.hand.viewBox),
      mice: mice.map((rect, slot) =>
        mouseBox(rect, targets.mice[sketches[slot]!]!.width),
      ),
    };
    this.set = buildParticleSet(this.pairing, this.layout, PARTICLE_SEED);
  }

  /** WebGL: pack the particles and send them to the GPU. Once per layout, and never while scrolling. */
  private uploadSet(): void {
    if (this.renderer !== "webgl" || !this.gl || !this.order || !this.set) {
      return;
    }
    this.glData = packParticles(this.set, this.order, this.glData ?? undefined);
    this.gl.upload(
      this.glData.subarray(0, this.set.count * GL_FLOATS_PER_PARTICLE),
    );
  }

  /** The last state's drawing: the finale, sampled for a desktop or a phone. */
  private finaleSketches(): string[] {
    return [finaleSlotName(this.queries.wide.matches ? "desktop" : "mobile")];
  }

  /**
   * The finale's headline and sky for this layout, and which of the finale's
   * particles sit under the headline's grown letters (their lines are cut
   * there). Once per layout; the particles' clip marks go up with the next
   * upload. A finale that can not be built leaves the figure whole and no
   * headline drawn: the text is still in the DOM.
   */
  private buildFinale(origin: DOMRect): void {
    const { finale: parts } = this.parts;
    this.finaleScene = null;
    if (this.set) this.set.clip.fill(0);
    const avoid: Rect[] = [];
    if (this.finaleRect) avoid.push(this.finaleRect);
    const actions = parts.actions;
    if (actions) {
      // Where the buttons are once the panel lets go (p = 1): as far above the
      // panel's bottom as they are above the section's bottom now.
      const section = this.parts.section.getBoundingClientRect();
      const box = actions.getBoundingClientRect();
      avoid.push({
        x: box.left - origin.left,
        y: this.cssHeight + (box.top - section.bottom),
        width: box.width,
        height: box.height,
      });
    }
    const started = performance.now();
    const sky = this.fitSky(origin);
    try {
      this.finaleScene = buildFinaleScene({
        sky: sky ?? undefined,
        title: parts.title,
        origin,
        width: this.cssWidth,
        height: this.cssHeight,
        dpr: this.dpr,
        wide: this.queries.wide.matches,
        avoid,
        // The 2D path draws every particle on the main thread: the headline
        // takes no more than the 2D budget there.
        liveMax: this.renderer === "webgl" ? Infinity : this.budget,
      });
    } catch {
      this.finaleScene = null;
    }
    // Without its layer the headline is shown as DOM text (home.css); the
    // figure and the rest of the story go on as they are.
    this.parts.section.dataset.finale = this.finaleScene ? "on" : "off";
    const scene = this.finaleScene;
    if (scene && this.set) {
      markClipped(this.set, (x, y) => isBlocked(scene, x, y));
    }
    // For the e2e suite and for anyone checking the cost in the inspector:
    // how long this layout's finale took to build (ms, once per layout).
    this.canvas.dataset.finaleMs = (performance.now() - started).toFixed(1);
  }

  /**
   * The sky's canvas spans the viewport's width (less a scrollbar), from its
   * left edge: placed by its left and width in px (once per layout), so it
   * never sticks out sideways. Its pixel size follows. Null without one.
   */
  private fitSky(origin: DOMRect): { width: number; offsetX: number } | null {
    const sky = this.skyCanvas;
    if (!sky) return null;
    const ctx = this.skyCtx ?? sky.getContext("2d");
    if (!ctx) return null;
    this.skyCtx = ctx;
    const width = Math.max(1, document.documentElement.clientWidth);
    sky.style.left = `${round3(-origin.left)}px`;
    sky.style.width = `${width}px`;
    const w = Math.max(1, Math.round(width * this.dpr));
    const h = Math.max(1, Math.round(this.cssHeight * this.dpr));
    if (sky.width !== w || sky.height !== h) {
      sky.width = w;
      sky.height = h;
    }
    // For the e2e suite: how wide the sky is drawn (CSS px).
    sky.dataset.width = String(width);
    // The finale's light spans the same width, so a phone's narrow column
    // does not cut its circle off at the column's edges.
    const glow = this.parts.finale.glow;
    if (glow) {
      glow.style.left = `${round3(-origin.left)}px`;
      glow.style.right = "auto";
      glow.style.width = `${width}px`;
    }
    return { width, offsetX: origin.left };
  }

  private countFor(renderer: Renderer): number {
    return particleCount(
      this.queries.wide.matches,
      navigator.hardwareConcurrency,
      renderer,
    );
  }

  private pairingKeyFor(
    renderer: Renderer,
    count: number,
    layout: MiceLayout,
    sketches: readonly string[],
  ): string {
    return `${renderer}:${count}:${layout}:${sketches.join(",")}`;
  }

  // ── The drawing path ────────────────────────────────────────────────────

  /**
   * Build what the first frame needs, a slice at a time: pick the drawing path
   * (making the WebGL context if it is allowed), then the pairing for its
   * budget. Nothing here touches the page. When it is done the stage asks for
   * a reflow, which switches the layout on. A failure leaves the page static
   * and is tried again a bounded number of times (retry.ts).
   */
  private prepare(): void {
    if (
      this.preparing ||
      this.ready ||
      this.destroyed ||
      this.prepareGaveUp ||
      this.retryTimer ||
      this.retryWhenShown
    ) {
      return;
    }
    this.preparing = true;
    void (async () => {
      let done = false;
      try {
        // The stage can be destroyed (the page navigated away) at any of the
        // awaits below: each one is followed by a check, so no WebGL context is
        // made, or kept, after `destroy`.
        await pause();
        if (this.destroyed) return;
        await this.chooseRenderer(async () => {
          await pause();
          if (this.destroyed) throw new Error("the stage was destroyed");
        });
        await pause();
        if (this.destroyed) return;
        const layoutKind: MiceLayout = this.queries.wide.matches
          ? "row"
          : "stacked";
        const sketches = this.finaleSketches();
        const renderer = this.renderer;
        const count = this.countFor(renderer);
        const key = this.pairingKeyFor(renderer, count, layoutKind, sketches);
        const pairing = await buildPairingInSlices(
          targets,
          {
            count,
            layout: layoutKind,
            seed: PARTICLE_SEED,
            mice: sketches,
            density: renderer === "webgl" ? "dense" : "sparse",
          },
          async () => {
            await pause();
            if (this.destroyed) throw new Error("the stage was destroyed");
          },
        );
        // The context may have been lost meanwhile: the pairing is then not
        // for the path in use, and `buildSet` makes its own.
        if (renderer === this.renderer) {
          this.pairing = pairing;
          this.pairingKey = key;
          this.order = null;
        }
        // Each particle's swing and direction, which no layout changes: its
        // own slice, so building the first layout's particles is not long.
        if (this.pairing) {
          await pairingTablesInSlices(this.pairing, PARTICLE_SEED, async () => {
            await pause();
            if (this.destroyed) throw new Error("the stage was destroyed");
          });
        }
        await pause();
        if (this.destroyed) return;
        // The order the WebGL path keeps its particles in (the stars come
        // first, evenly spread): a few slices of its own.
        if (renderer === "webgl" && this.pairing === pairing) {
          const order = await starOrderInSlices(
            pairing,
            STAR_ORDER_SEED,
            async () => {
              await pause();
              if (this.destroyed) throw new Error("the stage was destroyed");
            },
          );
          // The context may have been lost meanwhile: this order is then for
          // a pairing the stage no longer uses.
          if (this.pairing === pairing && this.renderer === "webgl") {
            this.order = order;
          }
        }
        if (this.destroyed) return;
        // The first frame's set-up, in slices of its own (the WebGL canvas's
        // first resize alone can take a long while on a slow phone), while the
        // page is still the static one: nothing here is visible.
        await this.warmInSlices();
        done = true;
      } catch {
        // The page stays as it is, the static layout, for now.
      } finally {
        this.preparing = false;
      }
      if (done) {
        this.ready = true;
        if (!this.destroyed) this.requestReflow();
      } else if (!this.destroyed) {
        this.schedulePrepareRetry();
      }
    })();
  }

  /** After a failed `prepare`: one timer for the next try, if one is left; it runs only while the tab is shown. */
  private schedulePrepareRetry(): void {
    this.prepareFailures += 1;
    const delay = retryDelay(this.prepareFailures);
    if (delay === null) {
      this.prepareGaveUp = true;
      return;
    }
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      if (this.destroyed) return;
      if (retryStep(document.hidden) === "wait-until-shown") {
        this.retryWhenShown = true;
        return;
      }
      this.requestReflow();
    }, delay);
  }

  /**
   * WebGL if the browser has it and the GPU can draw the points; otherwise the
   * 2D path, for good. The context, the shaders and the program are made a
   * slice at a time (`pause` is awaited between them, and throws when the
   * stage was destroyed: the context made so far goes back at once).
   */
  private async chooseRenderer(pause: () => Promise<void>): Promise<void> {
    if (this.destroyed) return;
    if (!this.gl && !this.glFailed) {
      let gl: GlRenderer | null = null;
      if (this.glCanvas) {
        const steps = createGlRendererSteps(this.glCanvas, this.onContextLost);
        try {
          for (;;) {
            let next: IteratorResult<void, GlRenderer | null>;
            try {
              next = steps.next();
            } catch {
              // Anything the GL calls throw is the same as having no WebGL.
              break;
            }
            if (next.done) {
              gl = next.value;
              break;
            }
            await pause();
          }
        } finally {
          // Closed before it was done (destroyed between two slices): the
          // context made so far is handed back. A no-op once it is done.
          steps.return(null);
        }
      }
      if (this.destroyed) {
        gl?.dispose();
        return;
      }
      const pixelRatio = glCanvasScale(
        window.devicePixelRatio,
        this.queries.wide.matches,
      );
      if (gl && gl.fits(pixelRatio)) {
        this.gl = gl;
      } else {
        gl?.dispose();
        this.glFailed = true;
      }
    }
    this.renderer = this.gl ? "webgl" : "2d";
  }

  /** The browser took the WebGL context away: the 2D path for the rest of the visit. */
  private readonly onContextLost = (): void => {
    this.glFailed = true;
    this.useTwoD();
  };

  /** `warm`, one step a task. Whatever it did not finish, `activate` finishes. */
  private async warmInSlices(): Promise<void> {
    const { panel, logo } = this.parts;
    const panelHeight = this.probe.offsetHeight;
    const ctx = this.canvas.getContext("2d");
    if (!ctx || this.destroyed) return;
    this.ctx = ctx;
    this.cssWidth = panel.clientWidth;
    this.cssHeight = panelHeight;
    this.fitTwoD();
    await pause();
    if (this.destroyed) return;
    this.fitGl();
    await pause();
    if (this.destroyed) return;
    const origin = panel.getBoundingClientRect();
    const logoRect = relative(logo.getBoundingClientRect(), origin);
    this.buildSetData(logoRect, logoRect, [logoRect]);
    await pause();
    if (this.destroyed) return;
    this.uploadSet();
    // `activate` reuses this when the layout has not moved since: the same key.
    this.warmKey = this.warmKeyFor(this.cssWidth, this.cssHeight, logoRect);
    await pause();
  }

  /**
   * Leave WebGL for good and carry on on the 2D path with the 2D budget: the
   * particles are rebuilt for it and redrawn, in this task, so no frame is
   * shown empty.
   */
  private useTwoD(): void {
    if (this.destroyed) return;
    const gl = this.gl;
    this.glFailed = true;
    this.gl = null;
    this.renderer = "2d";
    this.glData = null;
    this.order = null;
    this.budget = 0;
    gl?.dispose();
    if (!this.animated || !this.ctx) return;
    this.parts.section.dataset.renderer = "2d";
    this.fitCanvas();
    this.measureAndBuild();
    this.dirty = true;
    this.redrawNow();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  private readonly onScroll = (): void => {
    // Whether the reader's own input came before this scroll (each scroll
    // uses the flag up, so an old key press does not make a later scroll theirs).
    const byReader = this.readerInput;
    this.readerInput = false;
    if (this.animated && this.selfScroll) {
      // The scroll the late switch made: not the reader's, so it neither
      // arms the guard nor starts the scroll tail. Draw the frame for it.
      this.selfScroll = false;
      this.dirty = true;
      this.schedule();
      return;
    }
    if (this.animated) {
      this.lastScrollAt = performance.now();
      this.settleTailsLater();
      // The first scroll starts the guard's counting (degrade.ts): until then
      // only the page's own frames, with the shimmer, have run. A scroll event
      // with the page still at the top has moved nothing, and does not start it.
      this.guard = armOnScroll(this.guard, window.scrollY);
      this.schedule();
    } else if (this.lateState !== "none") {
      // Waiting to switch away from the top: back at the top it switches at
      // once; anywhere else the reader is moving, so the wait starts again
      // (and a fade out that had begun fades back in). If the reader moved
      // the page themselves (input came before this scroll), the fades that
      // gave up are forgotten; a scroll the browser made on its own (a resize,
      // scroll anchoring) does not count.
      if (byReader) this.lateFadeFailures = 0;
      if (this.parts.section.getBoundingClientRect().top >= 0) {
        this.requestReflow();
      } else {
        if (this.lateState === "fading") this.cancelLateSwitch();
        this.armLateSwitch();
      }
    }
  };

  private readonly onReaderInput = (): void => {
    this.readerInput = true;
  };

  private readonly onVisibility = (): void => {
    // The frames stop while a tab is hidden and start again when it is shown:
    // the time in between is nobody's slow frame.
    this.guard = breakChain(this.guard);
    if (!document.hidden) {
      this.dirty = true;
      this.schedule();
      // A retry, or a late switch, that came due while the tab was hidden.
      if (this.retryWhenShown) {
        this.retryWhenShown = false;
        this.requestReflow();
      } else if (!this.animated && this.lateState === "waiting") {
        this.requestReflow();
      }
    }
  };

  /** Ask for one frame. Nothing is scheduled while nothing changes: there is no idle loop. */
  private schedule(): void {
    if (this.rafId || !this.animated || this.destroyed) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.rafId = 0;
    if (!this.animated || this.destroyed) return;
    // Off screen or in a hidden tab: draw nothing, and remember to catch up.
    if (!this.visible || document.hidden) {
      this.dirty = true;
      this.endRun();
      return;
    }
    // The guard sees every frame of a run of frames, drawn or not.
    this.watchFrame(now);
    if (this.needsMeasure) {
      // The first frame of the animated layout is rendered (style, layout,
      // paint of the 400 svh section) in the task this callback is in. The
      // measure and the particles it rebuilds are a task of their own, one
      // frame later, so neither is long on a slow phone, unless the reader has
      // already scrolled: then the hand and the mice are wanted now.
      const idle = this.currentProgress() === 0;
      if (!this.measureWaited && idle) {
        this.measureWaited = true;
        this.schedule();
        return;
      }
      // Still at the top: the measure is spread over four frames, one part
      // each (rects and particles; the finale's headline and sky; the upload;
      // the outline and the notes), so no task of them is long on a slow
      // phone (they were 85 to 110 ms in one go at 4 times the CPU, before
      // the finale). Nothing is drawn meanwhile: the canvas shows the logo,
      // which is where it was. If the reader scrolls, what is left is done at
      // once and drawn.
      if (idle && this.measureStep < 4) {
        try {
          if (this.measureStep === 0) this.measureRects();
          else if (this.measureStep === 1) this.measureFinale();
          else if (this.measureStep === 2) this.uploadSet();
          else this.measureLayout();
        } catch {
          this.deactivate();
          return;
        }
        this.measureStep += 1;
        this.schedule();
        return;
      }
      const done = this.measureStep;
      this.needsMeasure = false;
      this.measureWaited = false;
      this.measureStep = 0;
      try {
        if (done < 1) this.measureRects();
        if (done < 2) this.measureFinale();
        if (done < 3) this.uploadSet();
        if (done < 4) this.measureLayout();
      } catch {
        this.deactivate();
        return;
      }
      this.dirty = true;
    }
    const p = this.currentProgress();
    if (this.followScrollSpeed(now)) this.dirty = true;
    if (!this.dirty && p === this.lastP && this.shimmerOver) {
      this.keepGoing();
      return;
    }
    try {
      this.draw(p, now);
    } catch {
      if (this.renderer === "webgl") this.useTwoD();
      else this.deactivate();
      return;
    }
    this.lastP = p;
    this.dirty = false;
    this.keepGoing();
  };

  /**
   * After a frame: ask for the next one only while there is a reason. The
   * one-time shimmer is one; a scroll is another (it asks for its own frames),
   * and on the WebGL path the loop also runs for `SCROLL_TAIL_MS` after the
   * last scroll event, so that every frame of a scroll has a callback for the
   * guard to time, however sparse the input. Then it stops: there is no idle
   * loop.
   */
  private keepGoing(): void {
    const inTail =
      this.renderer === "webgl" &&
      performance.now() - this.lastScrollAt < SCROLL_TAIL_MS;
    if (!this.shimmerOver || inTail) this.schedule();
    else this.endRun();
  }

  /**
   * The scroll speed the finale's meteor tails follow, from this frame's
   * scroll (smoothed: starfield.ts). True when the tails would change enough
   * to redraw (only while the sky is showing). Scroll-driven only: the frames
   * this runs in are the scroll's own and its short tail.
   */
  private followScrollSpeed(now: number): boolean {
    const y = window.scrollY;
    const before = this.scrollSpeed;
    if (this.speedAt > 0 && now > this.speedAt) {
      this.scrollSpeed = smoothSpeed(
        this.scrollSpeed,
        y - this.speedY,
        now - this.speedAt,
        90,
      );
    }
    this.speedY = y;
    this.speedAt = now;
    if (!this.finaleScene || this.lastP < 0.7) return false;
    return Math.abs(trailScale(this.scrollSpeed) - trailScale(before)) > 0.01;
  }

  /**
   * A scroll has come: once the reader has stood still for the scroll tail,
   * draw one more frame with the meteors' tails back at rest. One timer, set
   * again by each scroll: nothing loops (the tails otherwise kept the length
   * of the last scroll's speed).
   */
  private settleTailsLater(): void {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = 0;
    if (!this.finaleScene || this.lastP < 0.8) return;
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = 0;
      if (this.destroyed || !this.animated) return;
      if (trailScale(this.scrollSpeed) <= 1) return;
      this.scrollSpeed = 0;
      this.dirty = true;
      this.schedule();
    }, SCROLL_TAIL_MS + 20);
  }

  /** The frame loop has stopped: the guard's next frame has no gap to this one. */
  private endRun(): void {
    if (this.renderer === "webgl") this.guard = breakChain(this.guard);
  }

  /**
   * The guard (degrade.ts): on the WebGL path, time the gaps between the
   * frames of a run and draw fewer particles when too many of them run long.
   */
  private watchFrame(now: number): void {
    if (this.renderer !== "webgl") return;
    const before = this.guard;
    this.guard = observeFrame(before, now, this.budget);
    if (before.refreshMs === null && this.guard.refreshMs !== null) {
      // For the e2e suite and for anyone checking the guard in the inspector.
      this.canvas.dataset.refreshMs = this.guard.refreshMs.toFixed(1);
    }
    if (this.guard.drawCount === before.drawCount) return;
    // The picture follows in this very frame.
    this.canvas.dataset.drawn = String(this.guard.drawCount);
    this.dirty = true;
  }

  private draw(p: number, now: number): void {
    const { ctx, set, layout, sprites } = this;
    if (!ctx || !set || !layout || !sprites) return;
    const phase = phaseAt(p);
    let band: number | null = null;
    if (!this.shimmerOver) {
      // The shimmer plays once, at p = 0: scrolling ends it for good.
      // (A frame's timestamp can be a little earlier than the moment the
      // shimmer was started in the same task.)
      const shimmer =
        p === 0 ? shimmerAt(Math.max(0, now - this.shimmerStart)) : null;
      if (shimmer?.active) band = shimmer.center;
      else this.shimmerOver = true;
    }
    let particles: { set: ParticleSet; frame: Frame } | null = null;
    if (this.renderer === "webgl" && this.gl) {
      // One draw call: the maths is in the vertex shader. The leg and its
      // weights are the same ones the 2D path's frame writer uses.
      const leg = legOf(phase);
      this.gl.draw({
        split: leg.split,
        e: leg.weights.e,
        swing: leg.weights.swing,
        band,
        count: this.guard.drawCount,
        glow: !this.queries.contrast.matches,
        clip: phase.finale.clip,
        lift: phase.finale.lift,
        ...legLook(
          leg.split,
          set.count,
          this.guard.drawCount,
          layout.hand.scale,
        ),
      });
    } else if (this.frame) {
      writeParticles(set, phase, this.frame);
      particles = { set, frame: this.frame };
    } else {
      return;
    }
    drawStage(ctx, {
      width: this.cssWidth,
      height: this.cssHeight,
      particles,
      phase,
      sprites,
      hand: targets.hand,
      handBox: layout.hand,
      outline: this.outline,
      notes: this.noteShapes,
      shimmer: band,
    });
    if (this.finaleScene) {
      const f = this.finaleFrame;
      f.phase = phase.finale;
      f.progress = phase.progress;
      f.trail = trailScale(this.scrollSpeed);
      f.glow = !this.queries.contrast.matches;
      f.headline = !this.queries.forced.matches;
      // The guard's share of the budget (degrade.ts): the headline's live
      // particles are thinned by it too. The 2D path has no guard: its
      // headline is capped at the 2D budget when it is built.
      f.share =
        this.renderer === "webgl" && this.budget > 0
          ? this.guard.drawCount / this.budget
          : 1;
      drawFinale(ctx, this.skyCtx, this.finaleScene, f);
    }
    this.applyDom(phase);
    this.draws += 1;
    this.canvas.dataset.draws = String(this.draws);
    this.parts.section.dataset.progress = p.toFixed(3);
    this.parts.section.dataset.story = String(phase.story);
  }

  /**
   * If a hero control has the focus, move it to the h1 (made focusable with
   * tabindex -1, so it is not a tab stop) without scrolling. Scrolling back
   * does not move it again.
   */
  private moveFocusToHeading(): void {
    const active = document.activeElement;
    if (
      !active ||
      !this.controls.some((c) => c === active || c.contains(active))
    ) {
      return;
    }
    const heading = this.parts.hero.querySelector<HTMLElement>("h1");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) {
      heading.setAttribute("tabindex", "-1");
      this.headingTabindexSet = true;
    }
    heading.focus({ preventScroll: true });
  }

  /** The DOM's share of the story: the hero's fade, the A4 outline, the finale's light. Opacity and transform only. */
  private applyDom(phase: Phase): void {
    const { hero, sheet, finale: finaleParts } = this.parts;
    const w = this.written;
    const opacity =
      phase.hero.opacity >= 1 ? "" : String(round3(phase.hero.opacity));
    if (opacity !== w.opacity) {
      hero.style.opacity = opacity;
      w.opacity = opacity;
    }
    const shift = round3(-phase.hero.shift * HERO_SHIFT_PX);
    const transform = shift === 0 ? "" : `translate3d(0, ${shift}px, 0)`;
    if (transform !== w.transform) {
      hero.style.transform = transform;
      w.transform = transform;
    }
    if (phase.hero.inert !== w.inert) {
      // A control that holds the focus when it turns inert would drop it on
      // the body: hand it to the h1 first (it stays in the accessibility tree).
      if (phase.hero.inert) this.moveFocusToHeading();
      // Hidden controls can not be tabbed to.
      for (const control of this.controls) {
        control.toggleAttribute("inert", phase.hero.inert);
      }
      w.inert = phase.hero.inert;
    }
    const sheetOpacity = String(round3(phase.sheet));
    if (sheet && sheetOpacity !== w.sheet) {
      sheet.style.opacity = sheetOpacity;
      w.sheet = sheetOpacity;
    }
    // The headline as DOM text when the canvas does not draw it (its layer
    // could not be built, or forced colours): it fades in with its window.
    const domTitle =
      this.parts.section.dataset.finale === "off" ||
      this.queries.forced.matches;
    const title = domTitle ? String(round3(phase.finale.gather)) : "";
    if (title !== w.title) {
      finaleParts.title.style.opacity = title;
      w.title = title;
    }
    const glow = String(round3(phase.finale.glow));
    if (finaleParts.glow && glow !== w.glow) {
      finaleParts.glow.style.opacity = glow;
      w.glow = glow;
    }
    // The annotations' text: opacity, and a small rise while one fades. A note
    // at 0 is left to its stylesheet (hidden), and is still in the DOM, in
    // order, for a screen reader.
    const noteOpacities = phase.notes.map((n) =>
      this.notesShown ? round3(n) : 0,
    );
    const noteKey = noteOpacities.join(",");
    if (noteKey !== w.notes) {
      this.parts.notes.forEach(({ block }, i) => {
        const opacity = noteOpacities[i] ?? 0;
        block.style.opacity = opacity <= 0 ? "" : String(opacity);
        block.style.transform =
          opacity <= 0 || opacity >= 1
            ? ""
            : `translate3d(0, ${round3((1 - opacity) * NOTE_SHIFT_PX)}px, 0)`;
      });
      w.notes = noteKey;
    }
  }
}

/** A client rect relative to another's top-left corner. */
function relative(rect: DOMRect, origin: DOMRect): Rect {
  return {
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}
