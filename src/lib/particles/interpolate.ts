import type { Vec } from "./geometry";

/**
 * Interpolation between two paired points of the particle story (Home v3,
 * PR B; docs/design/home-v3-2026-10-03/README.md, "Targets", "Interpolation"):
 *
 *   pos = a + (b - a) * e(t) + sin(pi * e(t)) * A
 *
 * `e` is easeInOutQuad, and `A` is a swirl vector: a golden-angle direction
 * per particle times an amplitude. The swirl is zero at both ends, so a point
 * leaves `a` and lands on `b` exactly, and swings out sideways on the way.
 * Pure: no DOM, no clock.
 */

/** The golden angle, in radians (about 137.5 degrees). */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Clamp to [0, 1]. A NaN is treated as 0. */
export function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

export function easeInOutQuad(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

/**
 * The swirl's unit direction for particle `index`: successive particles are
 * a golden angle apart, so any run of neighbours spreads evenly around the
 * circle. `offset` turns every direction by the same angle, so a second leg
 * of the story does not retrace the first one's swings.
 */
export function swirlDirection(index: number, offset = 0): Vec {
  const angle = index * GOLDEN_ANGLE + offset;
  return [Math.cos(angle), Math.sin(angle)];
}

/** What the formula needs of `t`, once per frame: the eased `e(t)` and the swing `sin(pi * e(t))`. */
export interface LegWeights {
  readonly e: number;
  readonly swing: number;
}

/**
 * `e(t)` and `sin(pi * e(t))`. Every particle of a frame shares them, so the
 * frame writer computes them once. At t <= 0 they are (0, 0) and at t >= 1 they
 * are (1, 0): the ends of the leg.
 */
export function legWeights(t: number): LegWeights {
  if (!(t > 0)) return { e: 0, swing: 0 };
  if (t >= 1) return { e: 1, swing: 0 };
  const e = easeInOutQuad(t);
  return { e, swing: Math.sin(Math.PI * e) };
}

/**
 * One axis of `pos = a + (b - a) * e(t) + sin(pi * e(t)) * A`, where `swirl` is
 * this axis's share of A. At the ends of the leg it returns `a` or `b` itself,
 * exactly (no rounding from the sine's last digits), so the story rests
 * precisely on its targets. This is the one implementation: both
 * `interpolatePosition` and the frame writer call it.
 */
export function interpolateAxis(
  a: number,
  b: number,
  weights: LegWeights,
  swirl: number,
): number {
  if (weights.e <= 0) return a;
  if (weights.e >= 1) return b;
  return a + (b - a) * weights.e + swirl * weights.swing;
}

/**
 * Where a particle is at `t` (0 to 1) on its way from `a` to `b`, with its swirl
 * `amplitude` (in the same units as the points) along `direction`
 * (see `swirlDirection`).
 */
export function interpolatePosition(
  a: Vec,
  b: Vec,
  t: number,
  direction: Vec,
  amplitude: number,
): Vec {
  const weights = legWeights(t);
  return [
    interpolateAxis(a[0], b[0], weights, direction[0] * amplitude),
    interpolateAxis(a[1], b[1], weights, direction[1] * amplitude),
  ];
}
