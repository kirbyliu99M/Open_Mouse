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

/** One axis of the formula: `a + (b - a) * e + swirl`, with `e` already eased and `swirl` already scaled by sin(pi * e). */
export function interpolateAxis(
  a: number,
  b: number,
  e: number,
  swirl: number,
): number {
  return a + (b - a) * e + swirl;
}

/**
 * Where a particle is at `t` (0 to 1) on its way from `a` to `b`, with its swirl
 * `amplitude` (in the same units as the points) along `swirlDirection`.
 * t <= 0 returns `a` and t >= 1 returns `b`, exactly (no rounding from the
 * sine's last digits), so the story rests precisely on its targets.
 */
export function interpolatePosition(
  a: Vec,
  b: Vec,
  t: number,
  direction: Vec,
  amplitude: number,
): Vec {
  if (!(t > 0)) return [a[0], a[1]];
  if (t >= 1) return [b[0], b[1]];
  const e = easeInOutQuad(t);
  const swing = Math.sin(Math.PI * e) * amplitude;
  return [
    interpolateAxis(a[0], b[0], e, direction[0] * swing),
    interpolateAxis(a[1], b[1], e, direction[1] * swing),
  ];
}
