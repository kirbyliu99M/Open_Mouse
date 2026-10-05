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
  DEGRADE,
  estimateRefreshMs,
  isFrameGap,
  nextDrawCount,
} from "@/lib/particles/degrade";
import {
  GL_FLOATS_PER_PARTICLE,
  SHUFFLE_SEED,
  packParticles,
  shuffleOrder,
} from "@/lib/particles/gl-buffers";
import { parseTargets } from "@/lib/particles/load-targets";
import { glLook, legGain } from "@/lib/particles/look";
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
  mouseBox,
  writeParticles,
} from "@/lib/particles/particle-set";
import { type Phase, phaseAt, sectionProgress } from "@/lib/particles/timeline";
import { type GlRenderer, createGlRenderer } from "./stage-gl";
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

/**
 * `canvas` is the 2D layer (the top one). `glCanvas`, the WebGL layer under
 * it, is optional: without it the stage is Canvas 2D only.
 */
export function startParticleStage(
  canvas: HTMLCanvasElement,
  glCanvas?: HTMLCanvasElement | null,
): StageHandle {
  const parts = findParts(canvas);
  if (!parts) return { destroy() {} };
  const stage = new Stage(canvas, glCanvas ?? null, parts);
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
  /** The particle budget of the drawing path in use, and how many of them the WebGL path draws now (the guard only lowers it). */
  private budget = 0;
  private drawCount = 0;
  /** The order the particles are uploaded in (shuffled, so the first N are a fair sample), and the buffer they are packed into. */
  private order: Uint32Array | null = null;
  private glData: Float32Array | null = null;
  /** The guard's state: when the last frame was drawn, the latest gaps between frames, the first ones, and the screen's refresh interval from them. */
  private lastFrameAt = 0;
  private gaps: number[] = [];
  private firstGaps: number[] = [];
  private refreshMs: number | null = null;

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

  /** True while the h1 carries the tabindex this stage gave it. */
  private headingTabindexSet = false;

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
    private readonly glCanvas: HTMLCanvasElement | null,
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
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const query of Object.values(this.queries)) {
      query.removeEventListener("change", this.requestReflow);
    }
    this.resize?.disconnect();
    if (this.reflowId) cancelAnimationFrame(this.reflowId);
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
    const allowed = mayAnimate({
      reducedMotion: this.queries.reduced.matches,
      heroHeight: this.parts.hero.offsetHeight,
      panelHeight,
      // The small viewport, like the panel: window.innerHeight would change
      // while a phone's toolbars slide, and the page would flap between the
      // two layouts around the 600 px line.
      viewportHeight: panelHeight,
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
        if (!this.ready) {
          // The heavy part (the drawing path, the pairing) is built in slices,
          // off this task; it asks for another reflow when it is done.
          this.prepare();
          return;
        }
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
    if (this.headingTabindexSet) {
      hero.querySelector("h1")?.removeAttribute("tabindex");
      this.headingTabindexSet = false;
    }
    if (sheet) sheet.style.opacity = "";
    for (const mouse of mice)
      if (mouse.caption) mouse.caption.style.opacity = "";
    delete section.dataset.progress;
    delete section.dataset.story;
    delete section.dataset.renderer;
    this.written = {};
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
    this.buildSet(logoRect, logoRect, [logoRect, logoRect, logoRect]);
    // (`fitCanvas` may have fallen back to the 2D path: the key says which.)
    this.warmKey = this.warmKeyFor(width, panelHeight, logoRect);
    return true;
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
    const sketches = this.parts.mice.map((m) => m.sketch);
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
    }
    if (count !== this.budget) {
      this.budget = count;
      this.drawCount = count;
      this.gaps = [];
      this.lastFrameAt = 0;
      this.frame = this.renderer === "2d" ? createFrame(count) : null;
      this.order =
        this.renderer === "webgl" ? shuffleOrder(count, SHUFFLE_SEED) : null;
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
    if (this.renderer === "webgl" && this.gl && this.order) {
      // Once per layout, and never while scrolling.
      this.glData = packParticles(
        this.set,
        this.order,
        this.glData ?? undefined,
      );
      this.gl.upload(this.glData.subarray(0, count * GL_FLOATS_PER_PARTICLE));
    }
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
   * a reflow, which switches the layout on. A failure leaves the page static.
   */
  private prepare(): void {
    if (this.preparing || this.ready || this.destroyed) return;
    this.preparing = true;
    void (async () => {
      let done = false;
      try {
        await pause();
        this.chooseRenderer();
        await pause();
        const layoutKind: MiceLayout = this.queries.wide.matches
          ? "row"
          : "stacked";
        const sketches = this.parts.mice.map((m) => m.sketch);
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
          pause,
        );
        // The context may have been lost meanwhile: the pairing is then not
        // for the path in use, and `buildSet` makes its own.
        if (renderer === this.renderer) {
          this.pairing = pairing;
          this.pairingKey = key;
        }
        // The first frame's set-up, in slices of its own (the WebGL canvas's
        // first resize alone can take a long while on a slow phone), while the
        // page is still the static one: nothing here is visible.
        await this.warmInSlices();
        done = true;
      } catch {
        // The page stays as it is: the static layout.
      } finally {
        this.preparing = false;
      }
      if (done) {
        this.ready = true;
        if (!this.destroyed) this.requestReflow();
      }
    })();
  }

  /** WebGL if the browser has it and the GPU can draw the points; otherwise the 2D path, for good. */
  private chooseRenderer(): void {
    if (!this.gl && !this.glFailed) {
      let gl: GlRenderer | null = null;
      try {
        gl = this.glCanvas
          ? createGlRenderer(this.glCanvas, this.onContextLost)
          : null;
      } catch {
        // Anything the GL calls throw is the same as having no WebGL.
        gl = null;
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
    this.fitGl();
    await pause();
    if (this.destroyed) return;
    const origin = panel.getBoundingClientRect();
    const logoRect = relative(logo.getBoundingClientRect(), origin);
    this.buildSet(logoRect, logoRect, [logoRect, logoRect, logoRect]);
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
    if (this.needsMeasure) {
      this.needsMeasure = false;
      try {
        this.measureAndBuild();
      } catch {
        this.deactivate();
        return;
      }
      this.dirty = true;
    }
    const p = this.currentProgress();
    if (!this.dirty && p === this.lastP && this.shimmerOver) return;
    try {
      this.draw(p, now);
    } catch {
      if (this.renderer === "webgl") this.useTwoD();
      else this.deactivate();
      return;
    }
    this.lastP = p;
    this.dirty = false;
    this.noteFrame(now);
    // Only the one-time shimmer keeps frames coming; a scroll asks for its own.
    if (!this.shimmerOver) this.schedule();
  };

  /**
   * The guard (degrade.ts): on the WebGL path, watch the gaps between frames
   * and draw fewer particles when they run long. Pauses (a gap over 50 ms) are
   * not counted. It never draws more again.
   */
  private noteFrame(now: number): void {
    if (this.renderer !== "webgl") return;
    const gap = now - this.lastFrameAt;
    const counts = this.lastFrameAt > 0 && isFrameGap(gap);
    this.lastFrameAt = now;
    if (!counts) return;
    this.gaps.push(gap);
    if (this.gaps.length > DEGRADE.WINDOW) this.gaps.shift();
    if (this.firstGaps.length < DEGRADE.REFRESH_SAMPLES) {
      this.firstGaps.push(gap);
    }
    if (this.refreshMs === null) {
      this.refreshMs = estimateRefreshMs(this.firstGaps);
      if (this.refreshMs !== null) {
        // For the e2e suite and for anyone checking the guard in the inspector.
        this.canvas.dataset.refreshMs = this.refreshMs.toFixed(1);
      }
    }
    const next = nextDrawCount({
      current: this.drawCount,
      budget: this.budget,
      gaps: this.gaps,
      refreshMs: this.refreshMs,
    });
    if (next === this.drawCount) return;
    this.drawCount = next;
    // A new window for the new count; the picture follows in the next frame.
    this.gaps = [];
    this.canvas.dataset.drawn = String(next);
    this.dirty = true;
    this.schedule();
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
        count: this.drawCount,
        glow: !this.queries.contrast.matches,
        look: glLook(this.drawCount, layout.hand.scale),
        gain: legGain(leg.split),
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
      shimmer: band,
    });
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
