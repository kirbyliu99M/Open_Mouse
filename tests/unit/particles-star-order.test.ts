import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import { parseTargets } from "@/lib/particles/load-targets";
import { LOGO_SAMPLING } from "@/lib/particles/logo";
import { LIT_FRACTION } from "@/lib/particles/look";
import {
  type Pairing,
  buildPairing,
  MOUSE_COUNT,
} from "@/lib/particles/pairing";
import { mulberry32 } from "@/lib/particles/random";
import {
  STAR_CANDIDATES,
  STAR_ORDER_SEED,
  STAR_ORDER_SHARE,
  starOrder,
  starOrderInSlices,
  starOrderSteps,
} from "@/lib/particles/star-order";

const targets = parseTargets(
  JSON.parse(readFileSync(ARTIFACT_PATHS.targets, "utf8")),
);

const COUNT = 3000;
const MICE = ["g-pro-sketch"];
const pairing = buildPairing(targets, {
  count: COUNT,
  layout: "stacked",
  seed: 7,
  mice: MICE,
  density: "dense",
});
const order = starOrder(pairing, STAR_ORDER_SEED);

/** A seeded Fisher-Yates shuffle: what picking the stars at random would do. */
function shuffled(count: number, seed: number): number[] {
  const out = Array.from({ length: count }, (_, i) => i);
  const random = mulberry32(seed);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface Spread {
  /** The nearest neighbour's distance: its mean, its spread as a share of the mean, and its 5th percentile as a share of the mean (how close the closest pairs get). */
  readonly mean: number;
  readonly cv: number;
  readonly closest: number;
}

/** How evenly `points` are spread: by the distance from each to its nearest neighbour. */
function spreadOf(points: readonly { x: number; y: number }[]): Spread {
  const nearest = points.map((a, i) => {
    let best = Infinity;
    points.forEach((b, j) => {
      if (i === j) return;
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (d < best) best = d;
    });
    return Math.sqrt(best);
  });
  const mean = nearest.reduce((sum, d) => sum + d, 0) / nearest.length;
  const sd = Math.sqrt(
    nearest.reduce((sum, d) => sum + (d - mean) ** 2, 0) / nearest.length,
  );
  const sorted = [...nearest].sort((a, b) => a - b);
  return {
    mean,
    cv: sd / mean,
    closest: sorted[Math.floor(sorted.length * 0.05)]! / mean,
  };
}

/**
 * The logo's strays (24 single points round the mark, the target's last 24
 * runs): a budget's copy of one is within a pixel of it (a dense walk nudges
 * a lone point by up to 0.75 px). Told apart by the target's runs, so a point
 * of the mark that strayed out of its box is still measured below.
 */
const strays = targets.logo.runs
  .slice(-LOGO_SAMPLING.ambient)
  .map((run) => targets.logo.points[run.start]!);
const isStray = (p: { x: number; y: number }) =>
  strays.some((s) => Math.hypot(p.x - s.x, p.y - s.y) < 2);

/** The first `lit` particles of `placing`, on the logo and on mouse 0 (each mouse is a drawing of its own). */
function litOn(pairing: Pairing, placing: readonly number[], lit: number) {
  const logo: { x: number; y: number }[] = [];
  const mouse: { x: number; y: number }[] = [];
  for (let place = 0; place < lit; place += 1) {
    const i = placing[place]!;
    const onLogo = pairing.logo[i]!;
    // The strays are lone stars by design, tens of px from anything: they are
    // left out of the evenness of the mark itself, which is what this
    // measures. Every other point of the logo is in it.
    if (!isStray(onLogo)) logo.push(onLogo);
    if (pairing.slot[i] === 0) mouse.push(pairing.mouse[i]!);
  }
  return { logo, mouse };
}

describe("starOrder", () => {
  it("lists every particle once", () => {
    expect(order).toBeInstanceOf(Uint32Array);
    expect(order).toHaveLength(COUNT);
    expect([...order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: COUNT }, (_, i) => i),
    );
  });

  it("is the same for the same pairing and seed, and another for another seed", () => {
    expect(Array.from(starOrder(pairing, STAR_ORDER_SEED))).toEqual(
      Array.from(order),
    );
    const other = starOrder(pairing, STAR_ORDER_SEED + 1);
    expect(Array.from(other)).not.toEqual(Array.from(order));
    expect([...other].sort((a, b) => a - b)).toEqual(
      Array.from({ length: COUNT }, (_, i) => i),
    );
  });

  it("spreads the first particles evenly on the logo and on a mouse, much more evenly than a random pick, at every share the stars may use", () => {
    const random = shuffled(COUNT, 99);
    for (const share of [0.08, 0.15, 0.25]) {
      const lit = Math.round(COUNT * share);
      const stars = litOn(pairing, Array.from(order), lit);
      const dots = litOn(pairing, random, lit);
      for (const where of ["logo", "mouse"] as const) {
        const even = spreadOf(stars[where]);
        const chance = spreadOf(dots[where]);
        const label = `${where} at ${share}`;
        // A random pick's nearest-neighbour distances vary by 0.6 to 0.8 of
        // their mean and the closest pairs sit at a tenth of it; the evenly
        // spread order stays under 0.55 (0.3 to 0.5 measured; three
        // candidates instead of eight give 0.58) and keeps its closest pairs
        // apart.
        expect(even.cv, label).toBeLessThan(0.55);
        expect(even.cv, label).toBeLessThan(chance.cv * 0.8);
        expect(even.closest, label).toBeGreaterThan(0.3);
        // The closest pairs against a random pick's, for the shipped seed: 1.8
        // times or more on a mouse (2.08, 2.80 and 2.63 at the three shares on
        // the B3 cloud), 1.5 on the logo. The logo's figure against a random
        // pick fell when the cloud was made even (the random pick itself is
        // less clumped there: see the next test, which also reads the logo
        // over five seeds). The logo and the mice share one order, picked on
        // both at once, so a change to the logo's target alone moves the
        // mice's figures too (a review's mutations of the logo's width period
        // made the mouse bound fail): a mouse failure here after a logo
        // change is that coupling, and is read over seeds before the bound
        // is touched.
        const floor = where === "mouse" ? 1.8 : 1.5;
        expect(even.closest, label).toBeGreaterThan(chance.closest * floor);
        // And the stars are not bunched at one end: the mean distance is the
        // one a random pick would have, or more.
        expect(even.mean, label).toBeGreaterThan(chance.mean);
      }
    }
  });

  it("keeps the closest stars apart at the median of five order seeds: half the mean gap or more, and 1.6 times a random pick's closest pairs or more", () => {
    // The figure is the 5th percentile of the nearest-neighbour distance as a
    // share of the mean: with 80 stars on a mouse (a share of 0.08) that is
    // the 4th smallest gap, so one seed's value swings, and the median of five
    // seeds is the algorithm's figure, not one draw's. Each seed must still
    // clear 1.5 times a random pick's (the test above).
    //
    // Measured 2026-10-10 over 12 seeds (the shipped one and 1000 to 1010) on
    // the swelling, golden-ratio cloud (variant B3), every share, logo and
    // mouse: the closest pairs at 0.46 to 0.68 of the mean gap, and the median
    // of the first five seeds 0.52 or more in every case. With 3 candidates
    // instead of 8 the medians are 0.37 to 0.45, with 2 they are 0.30 to
    // 0.47: the bound, 0.49, is between the two.
    //
    // Against a random pick the figure is lower than it was on the random
    // cloud (variant B: 1.8 or more at the median): the evener cloud makes
    // the random pick itself less clumped (its closest pairs on the logo at
    // 0.25 went from 0.249 to 0.315 of its mean gap), not the order worse (its
    // own went from 0.55 to 0.55). B3's medians are 1.74 or more; 3
    // candidates give 1.38 (logo at 0.25) and 1.53 (mouse at 0.08). 1.6 is
    // between.
    const random = shuffled(COUNT, 99);
    const seeds = [STAR_ORDER_SEED, 1000, 1001, 1002, 1003];
    const orders = seeds.map((seed) =>
      seed === STAR_ORDER_SEED
        ? Array.from(order)
        : Array.from(starOrder(pairing, seed)),
    );
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[2]!;
    for (const share of [0.08, 0.15, 0.25]) {
      const lit = Math.round(COUNT * share);
      const dots = litOn(pairing, random, lit);
      for (const where of ["logo", "mouse"] as const) {
        const chance = spreadOf(dots[where]).closest;
        const closest = orders.map(
          (placing) => spreadOf(litOn(pairing, placing, lit)[where]).closest,
        );
        const label = `${where} at ${share}: ${closest.map((c) => c.toFixed(2)).join(", ")} (random ${chance.toFixed(2)})`;
        expect(median(closest), label).toBeGreaterThan(0.49);
        expect(median(closest) / chance, label).toBeGreaterThan(1.6);
      }
    }
  });

  it("gives each last drawing its share of the first particles (one since the finale: all of them)", () => {
    for (const share of [0.08, 0.15, 0.25]) {
      const lit = Math.round(COUNT * share);
      const perSlot = new Array<number>(MOUSE_COUNT).fill(0);
      for (let place = 0; place < lit; place += 1) {
        perSlot[pairing.slot[order[place]!]!] += 1;
      }
      for (const count of perSlot) {
        expect(count).toBeGreaterThan((lit / MOUSE_COUNT) * 0.8);
        expect(count).toBeLessThan((lit / MOUSE_COUNT) * 1.2);
      }
    }
  });

  it("keeps the lit shares inside the part of the order that is spread evenly", () => {
    const stars = Object.values(LIT_FRACTION).filter((share) => share < 1);
    expect(Math.max(...stars)).toBeLessThanOrEqual(STAR_ORDER_SHARE);
    // The shares the options in the screenshots offer.
    expect(0.25).toBeLessThanOrEqual(STAR_ORDER_SHARE);
    expect(STAR_CANDIDATES).toBeGreaterThan(1);
  });

  it("is also a fair sample of the rest: the guard draws the first N, and the first N reach every part of the logo and of a mouse", () => {
    const quarter = Math.floor(COUNT / 4);
    const bins = 10;
    const histogram = (xs: number[], lo: number, hi: number) => {
      const counts = new Array<number>(bins).fill(0);
      for (const x of xs) {
        const bin = Math.floor(((x - lo) / (hi - lo)) * bins);
        counts[Math.min(bins - 1, Math.max(0, bin))] += 1;
      }
      return counts;
    };
    for (const points of [pairing.logo, pairing.mouse, pairing.hand]) {
      const all = points.map((p) => p.x);
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      const whole = histogram(all, lo, hi);
      const part = histogram(
        Array.from(order.slice(0, quarter), (i) => points[i]!.x),
        lo,
        hi,
      );
      for (let bin = 0; bin < bins; bin += 1) {
        if (whole[bin]! >= 100) {
          expect(part[bin]!).toBeGreaterThan(whole[bin]! * 0.25 * 0.6);
          expect(part[bin]!).toBeLessThan(whole[bin]! * 0.25 * 1.5);
        }
      }
    }
  });

  it("handles a pairing of none, of one and of a few", () => {
    for (const n of [0, 1, 3, 7]) {
      const point = (i: number) => ({
        x: i * 3,
        y: (i * 7) % 5,
        tone: 0 as const,
      });
      const small: Pairing = {
        count: n,
        layout: "row",
        logo: Array.from({ length: n }, (_, i) => point(i)),
        hand: Array.from({ length: n }, (_, i) => point(i)),
        mouse: Array.from({ length: n }, (_, i) => point(i)),
        slot: Array.from({ length: n }, (_, i) => i % MOUSE_COUNT),
      };
      const got = starOrder(small, 1);
      expect([...got].sort((a, b) => a - b)).toEqual(
        Array.from({ length: n }, (_, i) => i),
      );
    }
  });

  it("copes with particles on the same spot", () => {
    const n = 90;
    const same = { x: 5, y: 5, tone: 1 as const };
    const stacked: Pairing = {
      count: n,
      layout: "row",
      logo: Array.from({ length: n }, () => same),
      hand: Array.from({ length: n }, () => same),
      mouse: Array.from({ length: n }, () => same),
      slot: Array.from({ length: n }, (_, i) => i % MOUSE_COUNT),
    };
    const got = starOrder(stacked, 1);
    expect(new Set(got).size).toBe(n);
  });
});

describe("starOrderSteps", () => {
  it("runs in several short slices that add up to the same order", () => {
    const steps = starOrderSteps(pairing, STAR_ORDER_SEED);
    let slices = 0;
    for (;;) {
      const next = steps.next();
      if (next.done) {
        expect(Array.from(next.value)).toEqual(Array.from(order));
        break;
      }
      slices += 1;
    }
    // 3,000 particles: 900 picked evenly in slices of 600, and the set-up.
    expect(slices).toBeGreaterThanOrEqual(4);
  });

  it("waits for `pause` between the slices and gives the same order", async () => {
    let pauses = 0;
    const got = await starOrderInSlices(pairing, STAR_ORDER_SEED, async () => {
      pauses += 1;
    });
    expect(Array.from(got)).toEqual(Array.from(order));
    expect(pauses).toBeGreaterThanOrEqual(4);
  });

  it("stops at once when `pause` throws: the stage was destroyed", async () => {
    let pauses = 0;
    await expect(
      starOrderInSlices(pairing, STAR_ORDER_SEED, async () => {
        pauses += 1;
        throw new Error("destroyed");
      }),
    ).rejects.toThrow("destroyed");
    expect(pauses).toBe(1);
  });
});
