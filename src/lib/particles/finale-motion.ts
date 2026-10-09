import type { Vec } from "./geometry";
import { clamp01 } from "./interpolate";

/**
 * The finale headline's motion (home finale, stage 1: nothing on the page uses
 * this yet): the letters' particles gather along curved paths, letter by
 * letter, then a light sweeps across and leaves the letters solid. Every
 * function is `t -> state`: no DOM, no clock. The stage maps scroll to t.
 *
 * The curves and numbers are the v8 Pencil polish (gather frames D8O0h,
 * UGg8r, vh1zM; sweep Dspja), 未拍板 (candidate).
 */

/** The gather's shape. */
export const GATHER = {
  /** How long one particle flies, as a share of the gather (0 to 1). */
  duration: 0.2,
  /** The last letter starts this much later than the first. */
  letterSpread: 0.62,
  /** Each particle's own extra delay is up to this much. */
  delayJitter: 0.04,
  /** A path's sideways bend: from `bendMin` to `bendMin + bendRange` of the distance. */
  bendMin: 0.16,
  bendRange: 0.16,
  /** A particle flashes for this long after it lands. */
  flash: 0.035,
  /** A trail is this much of the flight long, in `trailSamples` points. */
  trail: 0.07,
  trailSamples: 5,
  /** The scatter the particles start from: stretched this much across, and squeezed this much in height, about the headline's centre. */
  stretchX: 1.12,
  squashY: 0.4,
} as const;

/** The scatter's random spread (px), per layout: v8's 110 × 70 desktop, 45 × 60 phone. */
export const GATHER_SPREAD = {
  desktop: { x: 110, y: 70 },
  mobile: { x: 45, y: 60 },
} as const;

/** The ease of a flight: fast out, slow in (cubic ease-out). */
export function easeOutCubic(q: number): number {
  const x = clamp01(q);
  return 1 - (1 - x) ** 3;
}

/**
 * When a particle of letter `letter` (of `letterCount`, reading order) starts
 * to fly: later letters later, plus its own share `jitter` (0 to 1) of
 * `delayJitter`. Between 0 and `letterSpread + delayJitter`.
 */
export function gatherDelay(
  letter: number,
  letterCount: number,
  jitter: number,
): number {
  if (!Number.isInteger(letterCount) || letterCount < 1) {
    throw new RangeError("letterCount must be a positive integer");
  }
  const place = Math.min(Math.max(letter, 0), letterCount - 1);
  return (
    (GATHER.letterSpread * place) / Math.max(1, letterCount - 1) +
    GATHER.delayJitter * clamp01(jitter)
  );
}

/**
 * Where a particle waits before it flies: its target pushed out across the
 * headline and squeezed toward its middle line, plus a random spread.
 * `g` is two standard normal draws, `spread` the layout's GATHER_SPREAD.
 */
export function scatterSource(
  target: Vec,
  centre: Vec,
  g: Vec,
  spread: { readonly x: number; readonly y: number },
): Vec {
  return [
    centre[0] + (target[0] - centre[0]) * GATHER.stretchX + g[0] * spread.x,
    centre[1] + (target[1] - centre[1]) * GATHER.squashY + g[1] * spread.y,
  ];
}

/**
 * The control point of a flight's curve: the midpoint, moved sideways by
 * `bend` times the distance along (-dy, dx), the travel vector turned a
 * quarter: on the screen (y down) a positive bend swings to the right of the
 * direction of travel (going +x it swings down the screen).
 */
export function arcControl(source: Vec, target: Vec, bend: number): Vec {
  return [
    (source[0] + target[0]) / 2 - bend * (target[1] - source[1]),
    (source[1] + target[1]) / 2 + bend * (target[0] - source[0]),
  ];
}

/** The quadratic Bézier from `a` through control `c` to `b`, at `e` (0 to 1). */
export function quadraticAt(a: Vec, c: Vec, b: Vec, e: number): Vec {
  const t = clamp01(e);
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
  ];
}

export interface GatherParticle {
  readonly source: Vec;
  readonly target: Vec;
  /** From `gatherDelay`. */
  readonly delay: number;
  /** The sideways bend (`arcControl`), e.g. bendMin + bendRange × a random 0 to 1. */
  readonly bend: number;
}

export type GatherPhase = "waiting" | "flying" | "arrived";

export interface GatherState {
  readonly phase: GatherPhase;
  readonly position: Vec;
  /** The flight's own progress, 0 to 1. */
  readonly q: number;
  /** Landed within the last `GATHER.flash`: drawn as a bright flash. */
  readonly flash: boolean;
}

/** A particle `t` (0 to 1) into the gather: waiting at its source, flying its curve, or at its target. */
export function gatherAt(particle: GatherParticle, t: number): GatherState {
  const p = Number.isNaN(t) ? 0 : t;
  const q = clamp01((p - particle.delay) / GATHER.duration);
  if (q <= 0) {
    return { phase: "waiting", position: particle.source, q: 0, flash: false };
  }
  if (q >= 1) {
    return {
      phase: "arrived",
      position: particle.target,
      q: 1,
      flash: p - (particle.delay + GATHER.duration) < GATHER.flash,
    };
  }
  const control = arcControl(particle.source, particle.target, particle.bend);
  return {
    phase: "flying",
    position: quadraticAt(
      particle.source,
      control,
      particle.target,
      easeOutCubic(q),
    ),
    q,
    flash: false,
  };
}

/**
 * A flying particle's trail: `trailSamples` points along its curve, from
 * `trail` of the flight behind it up to where it is now (the last point).
 * Empty unless it is flying.
 */
export function gatherTrail(particle: GatherParticle, t: number): Vec[] {
  const state = gatherAt(particle, t);
  if (state.phase !== "flying") return [];
  const control = arcControl(particle.source, particle.target, particle.bend);
  const n = GATHER.trailSamples;
  const out: Vec[] = [];
  for (let j = 0; j < n; j += 1) {
    const q = Math.max(
      0,
      state.q - GATHER.trail + (GATHER.trail * j) / (n - 1),
    );
    out.push(
      quadraticAt(particle.source, control, particle.target, easeOutCubic(q)),
    );
  }
  return out;
}

/** The five depth layers of the formed letters, back to front: size (px), colour, opacity (v8). */
export const DEPTH_LAYERS = [
  { px: 1.15, colour: "#8FB2F8", alpha: 0.66 },
  { px: 1.45, colour: "#AFC8FA", alpha: 0.78 },
  { px: 1.8, colour: "#CFE0FF", alpha: 0.86 },
  { px: 2.15, colour: "#E6EEFF", alpha: 0.94 },
  { px: 2.55, colour: "#FFFFFF", alpha: 1 },
] as const;

/**
 * A formed letter particle's depth, 0 to 1, from where it is (a slow wave
 * across the headline and a finer ripple) and its own random share `r`
 * (0 to 1); and its layer, 0 to 4. Depth over 0.68 counts as near: those
 * particles wait brighter before they fly.
 */
export function depthOf(
  x: number,
  y: number,
  r: number,
): {
  depth: number;
  layer: number;
} {
  const depth = clamp01(
    0.52 +
      0.14 * Math.sin(x * 0.012 + 1.0) +
      0.2 * Math.sin(x * 0.09 + y * 0.13) * Math.cos(x * 0.05 - y * 0.08) +
      0.55 * (clamp01(r) - 0.5),
  );
  return {
    depth,
    layer: Math.min(
      DEPTH_LAYERS.length - 1,
      Math.floor(depth * DEPTH_LAYERS.length),
    ),
  };
}

/** The sweep's widths (px), per layout: v8's. */
export const SWEEP = {
  desktop: { core: 10, afterglow: 190, exciteDecay: 55 },
  mobile: { core: 6, afterglow: 80, exciteDecay: 22 },
} as const;

export interface SweepWidths {
  /** Half the bright core's width. */
  readonly core: number;
  /** The fading band left behind the core. */
  readonly afterglow: number;
  /** How quickly the glow ahead of the core dies away. */
  readonly exciteDecay: number;
}

/**
 * Where the sweep's centre is at `t` (0 to 1) across a headline from `left` to
 * `right`: eased in and out, from four core widths before the left edge (so
 * nothing is solid at 0) to past the right edge by the core and the whole
 * afterglow (so at 1 everything is solid and the afterglow has gone).
 */
export function sweepX(
  t: number,
  left: number,
  right: number,
  widths: SweepWidths,
): number {
  if (!(right >= left)) throw new RangeError("right must not be left of left");
  const s = clamp01(t);
  const eased = s * s * (3 - 2 * s);
  const from = left - 4 * widths.core;
  const to = right + widths.core + widths.afterglow;
  return from + (to - from) * eased;
}

export interface SweepState {
  /** Left of the core: drawn as the solid letters. */
  readonly solid: boolean;
  /** Still a live particle: right of the core. */
  readonly live: boolean;
  /**
   * The afterglow on the solid letters, 0 to 1: 1 right behind the core,
   * falling as the square of the way back through the band, so it is bright
   * only near the core (under half at the band's middle).
   */
  readonly afterglow: number;
  /** The core's white heat, 0 to 0.95: a short tail behind, a sharper front. */
  readonly core: number;
  /** How many depth layers a live particle just ahead of the core is lifted: 0, 1 or 2. */
  readonly excite: number;
}

/** What a point at `x` looks like with the sweep's centre at `at`. */
export function sweepAt(
  x: number,
  at: number,
  widths: SweepWidths,
): SweepState {
  const { core, afterglow, exciteDecay } = widths;
  const back = at - core;
  const solid = x < back;
  const live = x >= at + core;
  const glow =
    solid && afterglow > 0 && x >= back - afterglow
      ? ((x - (back - afterglow)) / afterglow) ** 2
      : 0;
  const d = x - at;
  const heat =
    core > 0 ? 0.95 * Math.exp(-((d / ((d < 0 ? 1.7 : 0.55) * core)) ** 2)) : 0;
  const excite =
    live && exciteDecay > 0 ? Math.round(2.2 * Math.exp(-d / exciteDecay)) : 0;
  return { solid, live, afterglow: glow, core: heat, excite };
}
