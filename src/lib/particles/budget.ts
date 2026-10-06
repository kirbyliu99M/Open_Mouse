import { clamp01 } from "./interpolate";
import { MOUSE_COUNT } from "./pairing";

/**
 * Budgets and switches of the particle stage (Home v3, PR B; spec: docs/design/
 * home-v3-2026-10-03/README.md, "Rendering and performance" and "Page
 * structure"). The numbers are Claude's targets, 未拍板 (candidate) until
 * they are measured on a real phone, so each one is a named constant.
 */

/** The seed of the stage's own random choices (resampling, swirl lengths). The same as the target generator's, so a build is reproducible. */
export const PARTICLE_SEED = 20261003;

/** The stroke colours of the drawings, shared with the static SVGs (README, "Static images"), and the key light. */
export const PALETTE = {
  primary: "#cfe0ff",
  detail: "#6e9bf5",
  glow: "#3b82f6",
} as const;

/** Which drawing path the stage uses: WebGL, or the Canvas 2D one it falls back to. */
export type Renderer = "webgl" | "2d";

/**
 * Particles in the whole story, shared by every state, per drawing path.
 *
 * - The Canvas 2D path draws every particle on the main thread, so its budget
 *   is small (about 900 on a phone, 1,300 on a desktop): it is also what a
 *   device without WebGL, or whose WebGL fails, falls back to.
 * - The WebGL path moves the maths to the GPU and draws with one call. The
 *   numbers are Claude's candidate (未拍板). The budget is the number of
 *   particles in the whole story: the hand's dust uses all of them, and the
 *   logo's and the mice's stars are a share of them (the lit shares in
 *   look.ts), so a bigger budget gives a finer dust and, in proportion, more
 *   stars (at the default shares a mouse has 300 stars on a 6,000 budget and
 *   600 on a 12,000 one). The choice between 4,000 / 8,000, 6,000 / 12,000 and
 *   10,000 / 20,000 is still open (the screenshots that were to decide it
 *   showed continuous lines and are gone), and the GPU's fill cost on a phone
 *   has not been measured.
 */
export const PARTICLE_BUDGET_2D = { mobile: 900, desktop: 1300 } as const;
export const PARTICLE_BUDGET_GL = { mobile: 6000, desktop: 12000 } as const;

/** A device with this many logical cores or fewer gets half the particles. */
export const LOW_END_CORES = 4;

/** The device pixel ratio the canvas never exceeds. */
export const MAX_DPR = 2;

/** The animated layout needs a viewport at least this tall (px). */
export const MIN_VIEWPORT_HEIGHT = 600;

/** The hero shimmer plays once, at most 3 s (WCAG 2.2.2), then everything stays still. */
export const SHIMMER_MS = 2600;
export const SHIMMER_MAX_MS = 3000;

/**
 * How many particles to use: the budget of the drawing path for a phone or a
 * desktop, halved on a device with 4 cores or fewer, and rounded down to a
 * multiple of three (the three mice each take a third).
 */
export function particleCount(
  wide: boolean,
  hardwareConcurrency: number | undefined,
  renderer: Renderer,
): number {
  const budget = renderer === "webgl" ? PARTICLE_BUDGET_GL : PARTICLE_BUDGET_2D;
  const base = wide ? budget.desktop : budget.mobile;
  const lowEnd =
    typeof hardwareConcurrency === "number" &&
    hardwareConcurrency > 0 &&
    hardwareConcurrency <= LOW_END_CORES;
  const wanted = lowEnd ? Math.floor(base / 2) : base;
  return wanted - (wanted % MOUSE_COUNT);
}

/** The 2D canvas's device pixel ratio: the screen's, at least 1 and at most 2. */
export function canvasScale(devicePixelRatio: number | undefined): number {
  const dpr =
    typeof devicePixelRatio === "number" && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(Math.max(dpr, 1), MAX_DPR);
}

/**
 * The WebGL canvas's device pixel ratio cap: 2 on a wide screen and 1.5 on a
 * narrow one (under 48 rem), where a phone's ratio of 3 would triple the
 * filled pixels for no visible gain. Candidate (未拍板).
 */
export const GL_MAX_DPR = { wide: 2, narrow: 1.5 } as const;

/** The WebGL canvas's device pixel ratio: the screen's, at least 1 and at most the cap. */
export function glCanvasScale(
  devicePixelRatio: number | undefined,
  wide: boolean,
): number {
  const dpr =
    typeof devicePixelRatio === "number" && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(Math.max(dpr, 1), wide ? GL_MAX_DPR.wide : GL_MAX_DPR.narrow);
}

/** The largest point the GPU must be able to draw is this much smaller than its limit: a margin for the shimmer's swell and for rounding (px). */
export const POINT_SIZE_HEADROOM_PX = 24;

/**
 * Whether the GPU can draw the biggest point the stage will ask for.
 * `range` is `gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)`: [smallest,
 * largest], in device pixels. `neededPx` is the biggest point (device px, with
 * the pixel ratio and the shimmer's swell counted in). A GPU that reports a
 * largest size under `neededPx` + the headroom, or reports nothing usable,
 * gets the Canvas 2D path.
 */
export function pointSizeFits(
  range: ArrayLike<number> | null | undefined,
  neededPx: number,
): boolean {
  if (!range || range.length < 2) return false;
  const largest = range[1]!;
  return (
    Number.isFinite(largest) &&
    Number.isFinite(neededPx) &&
    largest >= neededPx + POINT_SIZE_HEADROOM_PX
  );
}

export interface AnimationConditions {
  /** `prefers-reduced-motion: reduce` is set. */
  readonly reducedMotion: boolean;
  /** The hero's measured height (px). */
  readonly heroHeight: number;
  /** The panel's height in the animated layout: 100svh (px). */
  readonly panelHeight: number;
  /** The height the 600 px rule reads (px): the stage passes 100svh, the same as panelHeight, so a phone's toolbar showing or hiding does not flip the layout. */
  readonly viewportHeight: number;
}

/**
 * Whether the page may switch to the animated layout: motion is allowed, the
 * hero's measured height fits in 100svh (so not at 320x568, on a phone in
 * landscape, or at a large text zoom), and the viewport is about 600 px tall
 * or more. Any condition failing leaves the static layout.
 */
export function mayAnimate(c: AnimationConditions): boolean {
  if (c.reducedMotion) return false;
  if (!(c.heroHeight > 0) || !(c.panelHeight > 0)) return false;
  if (c.heroHeight > c.panelHeight) return false;
  return c.viewportHeight >= MIN_VIEWPORT_HEIGHT;
}

export interface Shimmer {
  /** True while the shimmer is still playing. */
  readonly active: boolean;
  /** Where the bright band is across the logo: -0.35 (off the left edge) to 1.35 (off the right). */
  readonly center: number;
}

const BAND_START = -0.35;
const BAND_END = 1.35;

/** The shimmer `elapsedMs` after the first frame: one pass of a bright band left to right. */
export function shimmerAt(elapsedMs: number): Shimmer {
  if (!(elapsedMs >= 0) || elapsedMs >= SHIMMER_MS) {
    return { active: false, center: BAND_END };
  }
  const t = clamp01(elapsedMs / SHIMMER_MS);
  // Ease in and out, so the band does not appear or vanish abruptly.
  const eased = t * t * (3 - 2 * t);
  return { active: true, center: BAND_START + (BAND_END - BAND_START) * eased };
}

/** How much a particle at x (0 = the logo's left edge, 1 = its right) is lit by the band: 0 to 1. */
export function shimmerBoost(x: number, center: number): number {
  const d = (x - center) / 0.14;
  return Math.exp(-d * d);
}
