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

/** Particles in the whole story, shared by every state. */
export const PARTICLE_BUDGET = { mobile: 900, desktop: 1300 } as const;

/** A device with this many logical cores or fewer gets half the particles. */
export const LOW_END_CORES = 4;

/** The device pixel ratio the canvas never exceeds. */
export const MAX_DPR = 2;

/** The animated layout needs a viewport at least this tall (px). */
export const MIN_VIEWPORT_HEIGHT = 600;

/** The hero shimmer plays once, at most 3 s (WCAG 2.2.2), then everything stays still. */
export const SHIMMER_MS = 2600;
export const SHIMMER_MAX_MS = 3000;

/** The story section is this many viewport heights tall in the animated layout. */
export const SECTION_SVH = 400;

/**
 * How many particles to use: the budget for a phone or a desktop, halved on a
 * device with 4 cores or fewer, and rounded down to a multiple of three
 * (the three mice each take a third).
 */
export function particleCount(
  wide: boolean,
  hardwareConcurrency: number | undefined,
): number {
  const base = wide ? PARTICLE_BUDGET.desktop : PARTICLE_BUDGET.mobile;
  const lowEnd =
    typeof hardwareConcurrency === "number" &&
    hardwareConcurrency > 0 &&
    hardwareConcurrency <= LOW_END_CORES;
  const wanted = lowEnd ? Math.floor(base / 2) : base;
  return wanted - (wanted % MOUSE_COUNT);
}

/** The canvas's device pixel ratio: the screen's, at least 1 and at most 2. */
export function canvasScale(devicePixelRatio: number | undefined): number {
  const dpr =
    typeof devicePixelRatio === "number" && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(Math.max(dpr, 1), MAX_DPR);
}

export interface AnimationConditions {
  /** `prefers-reduced-motion: reduce` is set. */
  readonly reducedMotion: boolean;
  /** The hero's measured height (px). */
  readonly heroHeight: number;
  /** The panel's height in the animated layout: 100svh (px). */
  readonly panelHeight: number;
  /** The viewport's height (px). */
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
