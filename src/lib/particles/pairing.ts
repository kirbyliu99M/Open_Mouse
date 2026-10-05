import { densifyStrokes } from "./dense";
import { type TargetPoint, resampleToCount } from "./sampling";
import type { ParticleTargets } from "./targets";
import { createHandFiller } from "./template-hand";

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

/**
 * The indices of `points` in order of `primary`, then `secondary`, then input
 * order. Sorting 20,000 objects with a comparator took 25 ms; this packs each
 * point's two coordinates and its index into one integer below 2^52 and lets
 * the engine sort those numbers, which takes a few ms. The coordinates are
 * quantised to the room left (23 bits for the primary one at 20,000 points,
 * a resolution of about 0.00006 px over a 480 px range), so two points are
 * only ordered by their index when their coordinates agree to that precision.
 */
function rankedIndices(
  points: readonly Xy[],
  primary: "x" | "y",
  secondary: "x" | "y",
): number[] {
  const n = points.length;
  if (n < 2) return n === 1 ? [0] : [];
  const indexBits = Math.max(1, Math.ceil(Math.log2(n)));
  const spare = 52 - indexBits;
  const primaryBits = Math.floor(spare * 0.6);
  const secondaryBits = spare - primaryBits;
  let lowP = Infinity;
  let highP = -Infinity;
  let lowS = Infinity;
  let highS = -Infinity;
  for (const point of points) {
    lowP = Math.min(lowP, point[primary]);
    highP = Math.max(highP, point[primary]);
    lowS = Math.min(lowS, point[secondary]);
    highS = Math.max(highS, point[secondary]);
  }
  const scaleP = (2 ** primaryBits - 1) / (highP - lowP || 1);
  const scaleS = (2 ** secondaryBits - 1) / (highS - lowS || 1);
  const indexRange = 2 ** indexBits;
  const secondaryRange = 2 ** secondaryBits;
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = Math.round((points[i]![primary] - lowP) * scaleP);
    const q = Math.round((points[i]![secondary] - lowS) * scaleS);
    keys[i] = (p * secondaryRange + q) * indexRange + i;
  }
  keys.sort();
  const order = new Array<number>(n);
  for (let i = 0; i < n; i += 1) order[i] = keys[i]! % indexRange;
  return order;
}

/** A stable sort by x, then y; equal points keep their order. Does not modify the input. */
export function sortByX<T extends Xy>(points: readonly T[]): T[] {
  return rankedIndices(points, "x", "y").map((index) => points[index]!);
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
  const ranked = rankedIndices(points, axis, axis === "x" ? "y" : "x");
  const size = points.length / groups;
  const groupOf = new Array<number>(points.length);
  ranked.forEach((index, rank) => {
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
  checkCounts(logo.length, hand.length, mice);
  return pairSorted(
    sortByX(logo),
    sortByX(hand),
    mice.map((m) => sortByX(m)),
    layout,
  );
}

function checkCounts(
  count: number,
  handCount: number,
  mice: readonly (readonly TargetPoint[])[],
): void {
  if (mice.length !== MOUSE_COUNT) {
    throw new RangeError(`expected ${MOUSE_COUNT} mice, got ${mice.length}`);
  }
  if (
    handCount !== count ||
    mice.some((m) => m.length * MOUSE_COUNT !== count)
  ) {
    throw new RangeError(
      "the logo and the hand need the same count, and each mouse a third of it",
    );
  }
}

/** `pairTargets` for lists that are already sorted by x. */
function pairSorted(
  logoSorted: readonly TargetPoint[],
  handSorted: readonly TargetPoint[],
  miceSorted: readonly (readonly TargetPoint[])[],
  layout: MiceLayout,
): Pairing {
  const count = logoSorted.length;
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

/**
 * How the targets are brought to the particle count. "sparse" is the Canvas 2D
 * stage's: the sampled lists thinned, or topped up with copies nudged by a
 * pixel. "dense" is the WebGL stage's: strokes walked at a finer step and the
 * hand filled further (see dense.ts), so thousands of particles still sit on
 * the shapes.
 */
export type Density = "sparse" | "dense";

export interface PairingOptions {
  /** The particle budget; a multiple of three. */
  readonly count: number;
  readonly layout: MiceLayout;
  readonly seed: number;
  /** The sketch each mouse slot shows, by name in `targets.mice`. */
  readonly mice: readonly string[];
  /** Sparse when left out. */
  readonly density?: Density;
}

/** How many hand points one slice of the dense fill makes. */
const FILL_SLICE = 2500;

/**
 * Resample every target to the budget, then pair them, as a generator that
 * yields between the steps. The stage runs it a step per task, so no task
 * is long on a slow phone; `buildPairing` runs it to the end.
 */
export function* pairingSteps(
  targets: ParticleTargets,
  { count, layout, seed, mice, density = "sparse" }: PairingOptions,
): Generator<void, Pairing, void> {
  if (!Number.isInteger(count) || count < MOUSE_COUNT || count % MOUSE_COUNT) {
    throw new RangeError("count must be a positive multiple of three");
  }
  const perMouse = count / MOUSE_COUNT;
  const dense = density === "dense";
  const logoSorted = sortByX(
    dense
      ? densifyStrokes(targets.logo.points, targets.logo.runs, count, seed)
      : resampleToCount(targets.logo.points, count, seed),
  );
  yield;

  let hand: TargetPoint[];
  if (dense && count > targets.hand.points.length) {
    // The generator's own sequence, continued: the committed points come first.
    const filler = createHandFiller(seed);
    hand = [];
    while (hand.length < count) {
      hand.push(...filler.next(Math.min(FILL_SLICE, count - hand.length)));
      yield;
    }
  } else {
    hand = resampleToCount(targets.hand.points, count, seed + 1);
  }
  const handSorted = sortByX(hand);
  yield;

  const miceSorted: TargetPoint[][] = [];
  for (const [slot, name] of mice.entries()) {
    const sketch = targets.mice[name];
    if (!sketch) throw new RangeError(`no sketch named ${name}`);
    miceSorted.push(
      sortByX(
        dense
          ? densifyStrokes(
              sketch.points,
              sketch.runs,
              perMouse,
              seed + 2 + slot,
            )
          : resampleToCount(sketch.points, perMouse, seed + 2 + slot),
      ),
    );
    yield;
  }
  checkCounts(count, handSorted.length, miceSorted);
  return pairSorted(logoSorted, handSorted, miceSorted, layout);
}

/** Resample every target to the budget, then pair them. */
export function buildPairing(
  targets: ParticleTargets,
  options: PairingOptions,
): Pairing {
  const steps = pairingSteps(targets, options);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** The same, with `pause()` awaited between the steps. */
export async function buildPairingInSlices(
  targets: ParticleTargets,
  options: PairingOptions,
  pause: () => Promise<void>,
): Promise<Pairing> {
  const steps = pairingSteps(targets, options);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await pause();
  }
}
