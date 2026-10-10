import { MOUSE_COUNT, type Pairing } from "./pairing";
import { mulberry32 } from "./random";

/**
 * The order the WebGL stage keeps its particles in, which is also each
 * particle's rank (Home v3, the WebGL stage, stars). The drawings (the logo,
 * the mice) light only the first few particles of the order, as stars, so
 * which particles come first decides how the stars sit on the line: a random
 * pick clumps and leaves gaps (the nearest neighbour's distance varies by
 * about 0.9 of its mean), and the stars read as dashes. Instead the order is
 * built by best-candidate sampling: each next particle is the one, out of a
 * few random candidates, that is farthest from the particles already chosen,
 * in the logo and in its mouse alike (the farther of the two matters less: the
 * nearer one decides, so a particle must fit in both drawings). Every prefix
 * of the order is then an even scatter on both drawings, which is what the
 * stars need at any lit fraction, and what the guard needs when it draws only
 * the first N particles.
 *
 * Only the leading `STAR_ORDER_SHARE` of the order is spread this way (the
 * stars never reach further); the rest is a seeded shuffle. Pure and seeded:
 * no DOM, no clock, no `Math.hypot` or other function the engines may round
 * differently, so the same pairing and seed give the same order everywhere
 * (the e2e suite relies on it).
 */

/** The seed of the order's random choices (the candidates, the shuffled rest). Fixed, so a layout always uploads the same buffer. */
export const STAR_ORDER_SEED = 20261005;

/** The share of the order that is spread evenly. The lit fractions stay under this (the hand lights everything). */
export const STAR_ORDER_SHARE = 0.3;

/** How many random candidates compete for each place. More is more even and slower. */
export const STAR_CANDIDATES = 8;

/** A search that finds nothing within this many cells of a candidate calls it "far enough". */
const MAX_RINGS = 3;

/** The most cells a grid may have, however fine the spacing gets. */
const MAX_CELLS = 60000;

/** The spacing is estimated from this many particles of each drawing. */
const SPACING_SAMPLES = 48;

/** The first grids are made for this many chosen particles: before that a handful are compared directly. */
const FIRST_GRID_AT = 16;

/** Picks per slice (the stage waits a task between slices). */
const SLICE = 150;

/**
 * Chosen particles of one drawing (the logo, or one mouse) in a uniform grid:
 * the nearest chosen particle to a point is found in a few cells.
 */
class Grid {
  private readonly x0: number;
  private readonly y0: number;
  private readonly x1: number;
  private readonly y1: number;
  private cell = 1;
  private cols = 1;
  private rows = 1;
  private head = new Int32Array(1).fill(-1);
  private readonly next: Int32Array;

  constructor(
    private readonly xs: Float64Array,
    private readonly ys: Float64Array,
    members: readonly number[],
    next: Int32Array,
  ) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of members) {
      x0 = Math.min(x0, xs[i]!);
      y0 = Math.min(y0, ys[i]!);
      x1 = Math.max(x1, xs[i]!);
      y1 = Math.max(y1, ys[i]!);
    }
    this.x0 = members.length ? x0 : 0;
    this.y0 = members.length ? y0 : 0;
    this.x1 = members.length ? x1 : 1;
    this.y1 = members.length ? y1 : 1;
    this.next = next;
  }

  /** The grid's cell size, set from the spacing the chosen particles are expected to have; the chosen ones are put in again. */
  rebuild(spacing: number, chosen: readonly number[]): void {
    const width = Math.max(this.x1 - this.x0, 1e-9);
    const height = Math.max(this.y1 - this.y0, 1e-9);
    const finest = Math.sqrt((width * height) / MAX_CELLS);
    this.cell = Math.max(spacing, finest, 1e-6);
    this.cols = Math.floor(width / this.cell) + 1;
    this.rows = Math.floor(height / this.cell) + 1;
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    for (const i of chosen) this.add(i);
  }

  add(i: number): void {
    const at = this.cellOf(this.xs[i]!, this.ys[i]!);
    this.next[i] = this.head[at]!;
    this.head[at] = i;
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.floor((x - this.x0) / this.cell));
    const cy = Math.min(this.rows - 1, Math.floor((y - this.y0) / this.cell));
    return cy * this.cols + cx;
  }

  /**
   * The squared distance from (x, y) to the nearest chosen particle, exact up
   * to `MAX_RINGS` cells and that far (squared) beyond.
   */
  nearestSq(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.floor((x - this.x0) / this.cell));
    const cy = Math.min(this.rows - 1, Math.floor((y - this.y0) / this.cell));
    const reachMax = MAX_RINGS * this.cell;
    let best = reachMax * reachMax;
    for (let r = 0; r <= MAX_RINGS; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        const row = cy + dy;
        if (row < 0 || row >= this.rows) continue;
        const edge = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r) {
          const col = cx + dx;
          if (col < 0 || col >= this.cols) continue;
          for (
            let i = this.head[row * this.cols + col]!;
            i >= 0;
            i = this.next[i]!
          ) {
            const ex = this.xs[i]! - x;
            const ey = this.ys[i]! - y;
            const d = ex * ex + ey * ey;
            if (d < best) best = d;
          }
        }
      }
      // Anything in a ring farther out is at least `r` cells away.
      const reach = r * this.cell;
      if (best <= reach * reach) break;
    }
    return best;
  }
}

/** The spacing estimate yields every this many samples. */
const SPACING_SLICE = 12;

/** The typical distance from a particle to its nearest neighbour in the same drawing, from a sample of them (squared compare, then one root). A generator: it yields every `SPACING_SLICE` samples. */
function* typicalSpacing(
  xs: Float64Array,
  ys: Float64Array,
  groups: readonly (readonly number[])[],
): Generator<void, number, void> {
  let total = 0;
  for (const group of groups) total += group.length;
  const every = Math.max(1, Math.floor(total / SPACING_SAMPLES));
  const nearest: number[] = [];
  let seen = 0;
  for (const group of groups) {
    for (let k = 0; k < group.length; k += 1) {
      seen += 1;
      if (seen % every !== 0) continue;
      const a = group[k]!;
      let best = Infinity;
      for (let m = 0; m < group.length; m += 1) {
        if (m === k) continue;
        const b = group[m]!;
        const ex = xs[b]! - xs[a]!;
        const ey = ys[b]! - ys[a]!;
        const d = ex * ex + ey * ey;
        if (d < best) best = d;
      }
      if (best < Infinity) nearest.push(best);
      if (nearest.length % SPACING_SLICE === 0) yield;
    }
  }
  if (nearest.length === 0) return 1;
  nearest.sort((p, q) => p - q);
  return Math.max(Math.sqrt(nearest[nearest.length >> 1]!), 1e-6);
}

/**
 * The order (entry j is the index of the particle in place j), as a generator
 * that yields between slices, so the stage can run it a slice per task.
 */
export function* starOrderSteps(
  pairing: Pairing,
  seed: number,
): Generator<void, Uint32Array, void> {
  const n = pairing.count;
  const logoX = new Float64Array(n);
  const logoY = new Float64Array(n);
  const mouseX = new Float64Array(n);
  const mouseY = new Float64Array(n);
  const slots = Array.from({ length: MOUSE_COUNT }, () => [] as number[]);
  for (let i = 0; i < n; i += 1) {
    logoX[i] = pairing.logo[i]!.x;
    logoY[i] = pairing.logo[i]!.y;
    mouseX[i] = pairing.mouse[i]!.x;
    mouseY[i] = pairing.mouse[i]!.y;
    slots[pairing.slot[i]!]!.push(i);
  }
  const everyone = Array.from({ length: n }, (_, i) => i);
  yield;

  // How far apart neighbours are when every particle is drawn: the unit each
  // drawing's distances are measured in, so a gap on the logo and a gap on a
  // mouse can be compared (a mouse holds a third of the particles on a longer
  // line, so its gaps are in other units).
  const logoUnit = yield* typicalSpacing(logoX, logoY, [everyone]);
  yield;
  const mouseUnit = yield* typicalSpacing(mouseX, mouseY, slots);
  yield;

  const next = new Int32Array(n).fill(-1);
  const logoGrid = new Grid(logoX, logoY, everyone, next);
  const mouseGrids = slots.map(
    (members) => new Grid(mouseX, mouseY, members, new Int32Array(n).fill(-1)),
  );
  const random = mulberry32(seed);
  const pool = everyone.slice();
  const order = new Uint32Array(n);
  const chosen: number[] = [];
  const chosenBySlot: number[][] = Array.from(
    { length: MOUSE_COUNT },
    () => [] as number[],
  );
  const limit = Math.min(n, Math.ceil(STAR_ORDER_SHARE * n));
  let builtAt = 0;
  const logoUnitSq = logoUnit * logoUnit;
  const mouseUnitSq = mouseUnit * mouseUnit;

  for (let j = 0; j < limit; j += 1) {
    // The grids' cells follow the spacing the chosen particles have: it
    // halves as their number doubles.
    if (j >= FIRST_GRID_AT && (builtAt === 0 || j >= 2 * builtAt)) {
      builtAt = j;
      logoGrid.rebuild((logoUnit * n) / j, chosen);
      mouseGrids.forEach((grid, s) =>
        grid.rebuild((mouseUnit * n) / j, chosenBySlot[s]!),
      );
    }
    let bestAt = 0;
    let bestScore = -1;
    for (let k = 0; k < STAR_CANDIDATES; k += 1) {
      const at = Math.floor(random() * pool.length);
      const c = pool[at]!;
      const slot = pairing.slot[c]!;
      const onLogo =
        j < FIRST_GRID_AT
          ? bruteNearestSq(logoX, logoY, chosen, logoX[c]!, logoY[c]!)
          : logoGrid.nearestSq(logoX[c]!, logoY[c]!);
      const onMouse =
        j < FIRST_GRID_AT
          ? bruteNearestSq(
              mouseX,
              mouseY,
              chosenBySlot[slot]!,
              mouseX[c]!,
              mouseY[c]!,
            )
          : mouseGrids[slot]!.nearestSq(mouseX[c]!, mouseY[c]!);
      const score = Math.min(onLogo / logoUnitSq, onMouse / mouseUnitSq);
      if (score > bestScore) {
        bestScore = score;
        bestAt = at;
      }
    }
    const pick = pool[bestAt]!;
    const last = pool.pop()!;
    if (bestAt < pool.length) pool[bestAt] = last;
    order[j] = pick;
    chosen.push(pick);
    chosenBySlot[pairing.slot[pick]!]!.push(pick);
    if (j >= FIRST_GRID_AT) {
      logoGrid.add(pick);
      mouseGrids[pairing.slot[pick]!]!.add(pick);
    }
    if ((j + 1) % SLICE === 0) yield;
  }

  // The rest, in a seeded shuffle.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const k = Math.floor(random() * (i + 1));
    const held = pool[i]!;
    pool[i] = pool[k]!;
    pool[k] = held;
  }
  for (let i = 0; i < pool.length; i += 1) order[limit + i] = pool[i]!;
  yield;
  return order;
}

/** The nearest chosen particle, compared one by one: for the first few picks, before a grid is worth building. */
function bruteNearestSq(
  xs: Float64Array,
  ys: Float64Array,
  chosen: readonly number[],
  x: number,
  y: number,
): number {
  let best = Infinity;
  for (const i of chosen) {
    const ex = xs[i]! - x;
    const ey = ys[i]! - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return best;
}

/** The order of a pairing's particles (see the top of this file), all at once. */
export function starOrder(pairing: Pairing, seed: number): Uint32Array {
  const steps = starOrderSteps(pairing, seed);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** The same, with `pause()` awaited between the slices. */
export async function starOrderInSlices(
  pairing: Pairing,
  seed: number,
  pause: () => Promise<void>,
): Promise<Uint32Array> {
  const steps = starOrderSteps(pairing, seed);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await pause();
  }
}
