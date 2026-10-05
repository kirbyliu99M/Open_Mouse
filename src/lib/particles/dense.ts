import { mulberry32 } from "./random";
import { type StrokeRun, type TargetPoint, resampleToCount } from "./sampling";

/**
 * More particles than the targets were sampled with (Home v3, the WebGL stage).
 * The committed targets hold a few hundred to a few thousand points: enough to
 * draw the static art, far too few for 6,000 to 20,000 particles. Shipping the
 * big lists would cost hundreds of KB, so the stage grows them in the browser
 * instead, from the same seed every time:
 *
 * - A stroke (the logo, a mouse sketch) is walked at an even step and each
 *   particle is nudged a fraction of a pixel across the stroke, so the line
 *   gets width and softness and stays on the shape.
 * - The hand is a fill, so it is simply filled further (`createHandFiller`
 *   continues the generator's own sequence: the first points are the committed
 *   ones).
 *
 * Pure: no DOM, no clock.
 */

/** Across a stroke, a particle is nudged by a bell-shaped amount this wide (stage px, one standard deviation). */
export const STROKE_SPREAD = 0.3;
/** ...and never by more than this many standard deviations. */
const MAX_SPREAD_DEVIATIONS = 2.5;
/** Along a stroke, a particle is moved by up to this share of its own cell, either way. */
const ALONG_JITTER = 0.9;

/** How many of `count` each of `weights` gets, in proportion, and exactly `count` in all (largest remainder). */
export function shareOut(weights: readonly number[], count: number): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) throw new RangeError("nothing to share out between");
  const exact = weights.map((w) => (w * count) / total);
  const shares = exact.map((x) => Math.floor(x));
  let left = count - shares.reduce((sum, n) => sum + n, 0);
  const byRemainder = exact
    .map((x, index) => ({ index, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; left > 0; i = (i + 1) % byRemainder.length) {
    shares[byRemainder[i]!.index] = shares[byRemainder[i]!.index]! + 1;
    left -= 1;
  }
  return shares;
}

/**
 * `count` points on and around the strokes of a sampled shape.
 *
 * - Not more than the shape has: an even pick through its points, as
 *   `resampleToCount` does, so a thin budget looks like the sampled drawing.
 * - More: every stroke gets a share of `count` in proportion to its points, and
 *   walks along itself at an even step. An open stroke's first and last
 *   particle are its first and last point exactly; every other particle is
 *   nudged across the stroke by at most `STROKE_SPREAD` * 2.5 and along it by
 *   under half a step. A tone is the stroke's.
 *
 * The same shape, count and seed give the same points.
 */
export function densifyStrokes(
  points: readonly TargetPoint[],
  runs: readonly StrokeRun[],
  count: number,
  seed: number,
  spread = STROKE_SPREAD,
): TargetPoint[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("count must be a non-negative integer");
  }
  if (count <= points.length || runs.length === 0) {
    return resampleToCount(points, count, seed);
  }
  const random = mulberry32(seed);
  const gaussian = () => {
    const radius = Math.sqrt(-2 * Math.log(1 - random()));
    const g = radius * Math.cos(2 * Math.PI * random());
    return Math.max(-MAX_SPREAD_DEVIATIONS, Math.min(MAX_SPREAD_DEVIATIONS, g));
  };
  const shares = shareOut(
    runs.map((run) => run.count),
    count,
  );
  const out: TargetPoint[] = [];
  runs.forEach((run, r) => {
    const share = shares[r]!;
    const { start, count: m } = run;
    const first = points[start]!;
    if (share === 0) return;
    if (m === 1) {
      out.push(first);
      for (let j = 1; j < share; j += 1) {
        const angle = random() * Math.PI * 2;
        const radius = Math.sqrt(random()) * spread * MAX_SPREAD_DEVIATIONS;
        out.push({
          x: first.x + Math.cos(angle) * radius,
          y: first.y + Math.sin(angle) * radius,
          tone: first.tone,
        });
      }
      return;
    }
    const closed = run.closed;
    const cells = closed ? m : m - 1;
    for (let j = 0; j < share; j += 1) {
      const exactEnd = !closed && (j === 0 || j === share - 1);
      let u = closed
        ? (j / share) * cells
        : share === 1
          ? 0
          : (j / (share - 1)) * cells;
      if (!exactEnd) {
        u += (random() - 0.5) * ALONG_JITTER * (cells / share);
        u = closed
          ? ((u % cells) + cells) % cells
          : Math.min(Math.max(u, 0), cells);
      }
      const cell = Math.min(Math.floor(u), cells - 1);
      const along = u - cell;
      const a = points[start + cell]!;
      const b = points[start + ((cell + 1) % m)]!;
      // The ends of an open stroke are its own points, not a sum that rounds.
      const onB = exactEnd && along === 1;
      const onA = exactEnd && along === 0;
      let x = onB ? b.x : onA ? a.x : a.x + (b.x - a.x) * along;
      let y = onB ? b.y : onA ? a.y : a.y + (b.y - a.y) * along;
      if (!exactEnd) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        const across = gaussian() * spread;
        if (length > 0) {
          x += (-dy / length) * across;
          y += (dx / length) * across;
        }
      }
      out.push({ x, y, tone: a.tone });
    }
  });
  return out;
}
