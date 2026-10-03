import { type TargetPoint, resampleToCount } from "./sampling";
import type { ParticleTargets } from "./targets";

/**
 * Pairing of the particle story's targets (Home v3, PR B; spec: docs/design/
 * home-v3-2026-10-03/README.md, "Targets", "Pairing"). The same particles move
 * through every state, so each target list is resampled to the particle count
 * and the lists are paired point for point:
 *
 * - Sort both point lists by x and pair by index. That gives a coherent
 *   sideways flow instead of random crossings.
 * - Logo to hand: one list to one list.
 * - Hand to three mice: the hand's points are split into three groups, by y on
 *   a phone (the mice are stacked) or by x on a desktop (side by side). Each
 *   group is paired with one mouse, again by x.
 *
 * Pure and seeded: the same input and seed give the same pairing.
 */

/** Stacked on a phone, side by side from 48 rem. */
export type MiceLayout = "stacked" | "row";

/** How many mice the last step shows. */
export const MOUSE_COUNT = 3;

type Xy = { readonly x: number; readonly y: number };

/** A stable sort by x, then y; equal points keep their order. Does not modify the input. */
export function sortByX<T extends Xy>(points: readonly T[]): T[] {
  return points
    .map((point, index) => ({ point, index }))
    .sort(
      (a, b) =>
        a.point.x - b.point.x || a.point.y - b.point.y || a.index - b.index,
    )
    .map(({ point }) => point);
}

/**
 * The group (0 to groups - 1) of every point, by its rank along `axis`: the
 * lowest third of the y values (or x values) is group 0, and so on. Equal
 * values are ranked by the other axis, then by input order. The count must
 * divide evenly.
 */
export function groupByRank(
  points: readonly Xy[],
  groups: number,
  axis: "x" | "y",
): number[] {
  if (!Number.isInteger(groups) || groups < 1) {
    throw new RangeError("groups must be a positive integer");
  }
  if (points.length % groups !== 0) {
    throw new RangeError(
      `${points.length} points do not split evenly into ${groups} groups`,
    );
  }
  const other = axis === "x" ? "y" : "x";
  const ranked = points
    .map((point, index) => ({ point, index }))
    .sort(
      (a, b) =>
        a.point[axis] - b.point[axis] ||
        a.point[other] - b.point[other] ||
        a.index - b.index,
    );
  const size = points.length / groups;
  const groupOf = new Array<number>(points.length);
  ranked.forEach(({ index }, rank) => {
    groupOf[index] = Math.floor(rank / size);
  });
  return groupOf;
}

/** Split points into equal groups by rank along `axis` (see `groupByRank`). Each group keeps the input order. */
export function splitIntoGroups<T extends Xy>(
  points: readonly T[],
  groups: number,
  axis: "x" | "y",
): T[][] {
  const groupOf = groupByRank(points, groups, axis);
  const out: T[][] = Array.from({ length: groups }, () => []);
  points.forEach((point, index) => out[groupOf[index]!]!.push(point));
  return out;
}

/** One list of particles, in particle order: entry i of every list belongs to particle i. */
export interface Pairing {
  readonly count: number;
  readonly layout: MiceLayout;
  /** Where each particle starts, in the logo's own coordinates. Sorted by x. */
  readonly logo: readonly TargetPoint[];
  /** Where it rests on the hand, in the hand's own coordinates. Sorted by x. */
  readonly hand: readonly TargetPoint[];
  /** Where it ends, in its mouse's own coordinates. */
  readonly mouse: readonly TargetPoint[];
  /** Which mouse (0 to 2: top to bottom when stacked, left to right in a row) it ends on. */
  readonly slot: readonly number[];
}

/**
 * Pair already resampled lists: `logo` and `hand` have `count` points, and
 * each of the three `mice` has `count / 3`.
 */
export function pairTargets(
  logo: readonly TargetPoint[],
  hand: readonly TargetPoint[],
  mice: readonly (readonly TargetPoint[])[],
  layout: MiceLayout,
): Pairing {
  const count = logo.length;
  if (mice.length !== MOUSE_COUNT) {
    throw new RangeError(`expected ${MOUSE_COUNT} mice, got ${mice.length}`);
  }
  if (
    hand.length !== count ||
    mice.some((m) => m.length * MOUSE_COUNT !== count)
  ) {
    throw new RangeError(
      "the logo and the hand need the same count, and each mouse a third of it",
    );
  }
  const logoSorted = sortByX(logo);
  const handSorted = sortByX(hand);
  const miceSorted = mice.map((m) => sortByX(m));

  // Which of the three groups each hand point is in, by y when stacked, by x in a row.
  const axis = layout === "stacked" ? "y" : "x";
  const groupOf = groupByRank(handSorted, MOUSE_COUNT, axis);

  // handSorted is in x order, so each group's points come out in x order too:
  // the k-th point of a group meets the k-th point of its mouse.
  const next = [0, 0, 0];
  const mouse: TargetPoint[] = [];
  const slot: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const g = groupOf[i]!;
    mouse.push(miceSorted[g]![next[g]!]!);
    slot.push(g);
    next[g] = next[g]! + 1;
  }
  return { count, layout, logo: logoSorted, hand: handSorted, mouse, slot };
}

export interface PairingOptions {
  /** The particle budget; a multiple of three. */
  readonly count: number;
  readonly layout: MiceLayout;
  readonly seed: number;
  /** The sketch each mouse slot shows, by name in `targets.mice`. */
  readonly mice: readonly string[];
}

/** Resample every target to the budget, then pair them. */
export function buildPairing(
  targets: ParticleTargets,
  { count, layout, seed, mice }: PairingOptions,
): Pairing {
  if (!Number.isInteger(count) || count < MOUSE_COUNT || count % MOUSE_COUNT) {
    throw new RangeError("count must be a positive multiple of three");
  }
  const perMouse = count / MOUSE_COUNT;
  const logo = resampleToCount(targets.logo.points, count, seed);
  const hand = resampleToCount(targets.hand.points, count, seed + 1);
  const resampledMice = mice.map((name, slot) => {
    const sketch = targets.mice[name];
    if (!sketch) throw new RangeError(`no sketch named ${name}`);
    return resampleToCount(sketch.points, perMouse, seed + 2 + slot);
  });
  return pairTargets(logo, hand, resampledMice, layout);
}
