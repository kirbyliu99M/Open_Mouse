import targetsJson from "@/lib/particles/targets.generated.json";
import {
  PARTICLE_SEED,
  canvasScale,
  mayAnimate,
  particleCount,
  shimmerAt,
} from "@/lib/particles/budget";
import { parseTargets } from "@/lib/particles/load-targets";
import {
  type MiceLayout,
  type Pairing,
  MOUSE_COUNT,
  buildPairing,
} from "@/lib/particles/pairing";
import {
  type Frame,
  type ParticleSet,
  type Rect,
  type StageLayout,
  buildParticleSet,
  createFrame,
  handBox,
  logoBox,
  mouseBox,
  writeParticles,
} from "@/lib/particles/particle-set";
import { type Phase, phaseAt, sectionProgress } from "@/lib/particles/timeline";
import { type Sprites, createSprites, drawStage } from "./stage-render";

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
 * Anything that goes wrong (no 2D context, a bad targets file, a draw that
 * throws) takes the page back to the static layout. The maths lives in
 * src/lib/particles/ and is unit tested; this file is covered by the e2e suite.
 */

const targets = parseTargets(targetsJson);

const ANIMATED = "story--animated";
const WIDE = "(min-width: 48rem)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const MORE_CONTRAST = "(prefers-contrast: more)";
/** How far the hero text moves up while it fades, in CSS px. */
const HERO_SHIFT_PX = 40;

export interface StageHandle {
  destroy(): void;
}

interface MouseParts {
  readonly img: HTMLElement;
  readonly caption: HTMLElement | null;
  readonly sketch: string;
}

interface Parts {
  readonly section: HTMLElement;
  readonly panel: HTMLElement;
  readonly hero: HTMLElement;
  readonly logo: HTMLElement;
  readonly handImg: HTMLElement;
  readonly sheet: HTMLElement | null;
  readonly mice: readonly MouseParts[];
}

function findParts(canvas: HTMLCanvasElement): Parts | null {
  const section = canvas.closest<HTMLElement>(".story");
  const panel = canvas.closest<HTMLElement>(".story-panel");
  const hero = section?.querySelector<HTMLElement>(".story-hero");
  const logo = section?.querySelector<HTMLElement>(".story-logo img");
  const handImg = section?.querySelector<HTMLElement>(".story-hand img");
  if (!section || !panel || !hero || !logo || !handImg) return null;
  const fallback = Object.keys(targets.mice)[0];
  const mice = [...section.querySelectorAll<HTMLElement>(".story-mouse")].map(
    (figure): MouseParts | null => {
      const img = figure.querySelector<HTMLElement>("img");
      const wanted = figure.dataset.sketch ?? "";
      const sketch = wanted in targets.mice ? wanted : fallback;
      return img && sketch
        ? { img, caption: figure.querySelector("figcaption"), sketch }
        : null;
    },
  );
  if (mice.length !== MOUSE_COUNT || mice.some((m) => m === null)) return null;
  return {
    section,
    panel,
    hero,
    logo,
    handImg,
    sheet: section.querySelector<HTMLElement>(".story-hand-sheet"),
    mice: mice as MouseParts[],
  };
}

export function startParticleStage(canvas: HTMLCanvasElement): StageHandle {
  const parts = findParts(canvas);
  if (!parts) return { destroy() {} };
  const stage = new Stage(canvas, parts);
  stage.start();
  return { destroy: () => stage.destroy() };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

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

  private rafId = 0;
  private reflowId = 0;
  private dirty = true;
  private lastP = -1;
  private visible = true;
  private waitingForTop = false;

  private shimmerStart = 0;
  private shimmerOver = false;
  private draws = 0;

  /** What the last frame wrote to the DOM, so an unchanged value is not written again. */
  private written: {
    opacity?: string;
    transform?: string;
    inert?: boolean;
    sheet?: string;
    captions?: string;
  } = {};

  private readonly probe: HTMLElement;
  private readonly controls: HTMLElement[];
  private readonly queries: Record<
    "wide" | "reduced" | "contrast",
    MediaQueryList
  >;
  private resize: ResizeObserver | null = null;
  private intersection: IntersectionObserver | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly parts: Parts,
  ) {
    this.queries = {
      wide: window.matchMedia(WIDE),
      reduced: window.matchMedia(REDUCED_MOTION),
      contrast: window.matchMedia(MORE_CONTRAST),
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
    document.addEventListener("visibilitychange", this.onVisibility);
    for (const query of Object.values(this.queries)) {
      query.addEventListener("change", this.requestReflow);
    }
    this.resize = new ResizeObserver(this.requestReflow);
    this.resize.observe(this.parts.section);
    this.resize.observe(this.parts.hero);
    this.reflow();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.deactivate();
    window.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const query of Object.values(this.queries)) {
      query.removeEventListener("change", this.requestReflow);
    }
    this.resize?.disconnect();
    if (this.reflowId) cancelAnimationFrame(this.reflowId);
    this.probe.remove();
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
    const allowed = mayAnimate({
      reducedMotion: this.queries.reduced.matches,
      heroHeight: this.parts.hero.offsetHeight,
      panelHeight,
      viewportHeight: window.innerHeight,
    });
    if (!allowed) {
      this.waitingForTop = false;
      if (this.animated) this.deactivate();
      return;
    }
    try {
      if (!this.animated) {
        // Switching moves everything below the hero, so only do it while the
        // reader is still at the top; the scroll listener tries again.
        if (this.parts.section.getBoundingClientRect().top < 0) {
          this.waitingForTop = true;
          return;
        }
        this.waitingForTop = false;
        this.activate(panelHeight);
      } else {
        this.remeasure(panelHeight);
      }
    } catch {
      this.deactivate();
    }
  }

  /**
   * Static to animated. The first frame is drawn before `story--animated` is
   * added, and the static logo is hidden only after that, in the same task, so
   * the page never shows two logos (or none).
   */
  private activate(panelHeight: number): void {
    const { section, panel, logo } = this.parts;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    this.ctx = ctx;
    this.cssWidth = panel.clientWidth;
    this.cssHeight = panelHeight;
    this.fitCanvas();

    // The hero is in the same place in both layouts, so the logo's rect now
    // is where the canvas draws the logo. The hand and the mice have no place
    // in the static flow that matches the animated one, so the first frame
    // (only the logo is on it: p = 0) borrows the logo's box for them.
    const origin = panel.getBoundingClientRect();
    const logoRect = relative(logo.getBoundingClientRect(), origin);
    this.buildSet(logoRect, logoRect, [logoRect, logoRect, logoRect]);
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
    // the mice where the page puts them.
    this.measureAndBuild();
    this.dirty = true;
    this.lastP = -1;
    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1]?.isIntersecting ?? true;
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
    this.fitCanvas();
    this.measureAndBuild();
    this.dirty = true;
    this.schedule();
  }

  /** Animated to static: the page goes back to PR A's layout, as if nothing had loaded. */
  private deactivate(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.intersection?.disconnect();
    this.intersection = null;
    const { section, hero, logo, sheet, mice } = this.parts;
    section.classList.remove(ANIMATED);
    logo.style.visibility = "";
    hero.style.opacity = "";
    hero.style.transform = "";
    for (const control of this.controls)
      control.toggleAttribute("inert", false);
    if (sheet) sheet.style.opacity = "";
    for (const mouse of mice)
      if (mouse.caption) mouse.caption.style.opacity = "";
    delete section.dataset.progress;
    delete section.dataset.story;
    this.written = {};
    this.animated = false;
  }

  // ── Measuring ───────────────────────────────────────────────────────────

  private fitCanvas(): void {
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

  /** Read where the logo, the hand and the three mice are on the page now, and rebuild the particles for them. */
  private measureAndBuild(): void {
    const { panel, hero, logo, handImg, mice } = this.parts;
    const origin = panel.getBoundingClientRect();
    // The hero moves up as it fades; the logo's place is where it rests.
    const transform = hero.style.transform;
    hero.style.transform = "";
    const logoRect = relative(logo.getBoundingClientRect(), origin);
    hero.style.transform = transform;
    this.buildSet(
      logoRect,
      relative(handImg.getBoundingClientRect(), origin),
      mice.map((m) => relative(m.img.getBoundingClientRect(), origin)),
    );
  }

  private buildSet(logo: Rect, hand: Rect, mice: readonly Rect[]): void {
    const layoutKind: MiceLayout = this.queries.wide.matches
      ? "row"
      : "stacked";
    const count = particleCount(
      this.queries.wide.matches,
      navigator.hardwareConcurrency,
    );
    const sketches = this.parts.mice.map((m) => m.sketch);
    const key = `${count}:${layoutKind}:${sketches.join(",")}`;
    if (key !== this.pairingKey || !this.pairing) {
      this.pairing = buildPairing(targets, {
        count,
        layout: layoutKind,
        seed: PARTICLE_SEED,
        mice: sketches,
      });
      this.pairingKey = key;
      this.frame = createFrame(count);
      // For the e2e suite and for anyone checking the budget in the inspector.
      this.canvas.dataset.particles = String(count);
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

  // ── Drawing ─────────────────────────────────────────────────────────────

  private readonly onScroll = (): void => {
    if (this.animated) this.schedule();
    else if (
      this.waitingForTop &&
      this.parts.section.getBoundingClientRect().top >= 0
    ) {
      this.requestReflow();
    }
  };

  private readonly onVisibility = (): void => {
    if (!document.hidden) {
      this.dirty = true;
      this.schedule();
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
      return;
    }
    const { section, panel } = this.parts;
    const box = section.getBoundingClientRect();
    const p = sectionProgress(box.top, box.height, panel.offsetHeight);
    if (!this.dirty && p === this.lastP && this.shimmerOver) return;
    try {
      this.draw(p, now);
    } catch {
      this.deactivate();
      return;
    }
    this.lastP = p;
    this.dirty = false;
    // Only the one-time shimmer keeps frames coming; a scroll asks for its own.
    if (!this.shimmerOver) this.schedule();
  };

  private draw(p: number, now: number): void {
    const { ctx, set, frame, layout, sprites } = this;
    if (!ctx || !set || !frame || !layout || !sprites) return;
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
    writeParticles(set, phase, frame);
    drawStage(ctx, {
      width: this.cssWidth,
      height: this.cssHeight,
      set,
      frame,
      phase,
      sprites,
      hand: targets.hand,
      handBox: layout.hand,
      shimmer: band,
    });
    this.applyDom(phase);
    this.draws += 1;
    this.canvas.dataset.draws = String(this.draws);
    this.parts.section.dataset.progress = p.toFixed(3);
    this.parts.section.dataset.story = String(phase.story);
  }

  /** The DOM's share of the story: the hero's fade, the A4 outline, the captions. Opacity and transform only. */
  private applyDom(phase: Phase): void {
    const { hero, sheet, mice } = this.parts;
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
      // Hidden controls can not be tabbed to; the h1 stays in the accessibility tree.
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
    const captions = String(round3(phase.captions));
    if (captions !== w.captions) {
      for (const mouse of mice) {
        if (mouse.caption) mouse.caption.style.opacity = captions;
      }
      w.captions = captions;
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
