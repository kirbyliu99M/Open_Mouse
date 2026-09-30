/**
 * Corner labels are not stable. `detectPaperQuad` relabels its four corners
 * with a cyclic shift when the paper is held sideways (about 134 and 314
 * degrees of paper rotation, see `rotateBy1` in paper/detect.ts), so between
 * two samples the corner that was "top-left" can arrive labelled
 * "bottom-right". Anything that follows a corner from one sample to the next
 * (the smoother behind the dots, the steadiness check) has to match corners
 * by where they are, not by their labels, or it sees every corner jump to the
 * opposite one.
 *
 * The match is the cyclic shift (0 to 3) that puts the new corners closest to
 * the old ones in total. Pure.
 */
import type { Point } from "./quad";

export type Four<T> = readonly [T, T, T, T];

/** The shift `s` that minimises the total distance from `reference[i]` to `candidate[(i + s) % 4]`; the smallest such shift on a tie. */
export function bestCyclicShift(
  reference: Four<Point>,
  candidate: Four<Point>,
): number {
  let best = 0;
  let bestCost = Infinity;
  for (let shift = 0; shift < 4; shift++) {
    let cost = 0;
    for (let i = 0; i < 4; i++) {
      const a = reference[i];
      const b = candidate[(i + shift) % 4];
      cost += Math.hypot(a.x - b.x, a.y - b.y);
    }
    // Strictly better, by more than rounding: an exact tie keeps the smaller shift.
    if (cost < bestCost - 1e-9) {
      best = shift;
      bestCost = cost;
    }
  }
  return best;
}

/** The items read from `shift` on, round the ring: `result[i] = items[(i + shift) % 4]`. */
export function shiftFour<T>(items: Four<T>, shift: number): Four<T> {
  return [
    items[shift % 4],
    items[(shift + 1) % 4],
    items[(shift + 2) % 4],
    items[(shift + 3) % 4],
  ];
}
