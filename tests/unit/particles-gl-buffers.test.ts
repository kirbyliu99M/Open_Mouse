import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import {
  GL_FIELD,
  GL_FLOATS_PER_PARTICLE,
  packParticles,
} from "@/lib/particles/gl-buffers";
import { parseTargets } from "@/lib/particles/load-targets";
import { LIT_FRACTION, litCount, rankOf } from "@/lib/particles/look";
import { buildPairing } from "@/lib/particles/pairing";
import {
  type StageLayout,
  buildParticleSet,
  createFrame,
  handBox,
  legOf,
  logoBox,
  mouseBox,
  writeParticles,
} from "@/lib/particles/particle-set";
import { STAR_ORDER_SEED, starOrder } from "@/lib/particles/star-order";
import { phaseAt } from "@/lib/particles/timeline";

const targets = parseTargets(
  JSON.parse(readFileSync(ARTIFACT_PATHS.targets, "utf8")),
);

const layout: StageLayout = {
  width: 350,
  height: 844,
  logo: logoBox({ x: 55, y: 80, width: 240, height: 214 }),
  hand: handBox(
    { x: 10, y: 150, width: 330, height: 407 },
    targets.hand.viewBox,
  ),
  // One last drawing since the finale (MOUSE_COUNT = 1); the mechanics are
  // the same for any sketch, so the mouse sketch stands in for it here.
  mice: [0].map((slot) =>
    mouseBox({ x: 20, y: 120 + slot * 220, width: 310, height: 147 }, 340),
  ),
};
const COUNT = 3000;
const pairing = buildPairing(targets, {
  count: COUNT,
  layout: "stacked",
  seed: 7,
  mice: ["g-pro-sketch"],
  density: "dense",
});
const set = buildParticleSet(pairing, layout, 7);

describe("packParticles", () => {
  const order = starOrder(pairing, STAR_ORDER_SEED);
  const data = packParticles(set, order);

  it("makes one interleaved buffer: 16 floats per particle", () => {
    // 15 before the finale (2026-10-11) added the clip mark.
    expect(GL_FLOATS_PER_PARTICLE).toBe(16);
    expect(data).toBeInstanceOf(Float32Array);
    expect(data).toHaveLength(COUNT * 16);
    // Every field has its own floats: no two overlap, and they fill the 16.
    const fields = [
      [GL_FIELD.logo, 2],
      [GL_FIELD.hand, 2],
      [GL_FIELD.mouse, 2],
      [GL_FIELD.swirlForm, 2],
      [GL_FIELD.swirlSplit, 2],
      [GL_FIELD.tone, 3],
      [GL_FIELD.shimmerX, 1],
      [GL_FIELD.rank, 1],
      [GL_FIELD.clip, 1],
    ] as const;
    const used = fields.flatMap(([at, size]) =>
      Array.from({ length: size }, (_, i) => at + i),
    );
    expect(used.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
  });

  it("puts each particle's fields side by side, in the star order", () => {
    for (const j of [0, 1, 2, 500, COUNT - 1]) {
      const i = order[j]!;
      const at = j * GL_FLOATS_PER_PARTICLE;
      const field = (offset: number, n: number) =>
        Array.from(data.slice(at + offset, at + offset + n));
      expect(field(GL_FIELD.logo, 2)).toEqual([
        set.logo[2 * i],
        set.logo[2 * i + 1],
      ]);
      expect(field(GL_FIELD.hand, 2)).toEqual([
        set.hand[2 * i],
        set.hand[2 * i + 1],
      ]);
      expect(field(GL_FIELD.mouse, 2)).toEqual([
        set.mouse[2 * i],
        set.mouse[2 * i + 1],
      ]);
      expect(field(GL_FIELD.swirlForm, 2)).toEqual([
        set.swirlForm[2 * i],
        set.swirlForm[2 * i + 1],
      ]);
      expect(field(GL_FIELD.swirlSplit, 2)).toEqual([
        set.swirlSplit[2 * i],
        set.swirlSplit[2 * i + 1],
      ]);
      expect(field(GL_FIELD.tone, 3)).toEqual([
        set.toneLogo[i],
        set.toneHand[i],
        set.toneMouse[i],
      ]);
      expect(field(GL_FIELD.shimmerX, 1)).toEqual([set.shimmerX[i]]);
      expect(field(GL_FIELD.rank, 1)).toEqual([Math.fround(rankOf(j, COUNT))]);
    }
  });

  it("gives each particle its rank: its place as a share of the count, rising from the first to the last", () => {
    let before = 0;
    for (let j = 0; j < COUNT; j += 1) {
      const rank = data[j * GL_FLOATS_PER_PARTICLE + GL_FIELD.rank]!;
      expect(rank).toBeGreaterThan(before);
      expect(rank).toBeLessThan(1);
      before = rank;
    }
  });

  it("lights the number of particles the look is worked out for: the ranks under each state's share are exactly litCount of them", () => {
    for (const share of [0.08, 0.15, 0.25, LIT_FRACTION.logo, 1]) {
      let lit = 0;
      for (let j = 0; j < COUNT; j += 1) {
        // The shader compares the float32 rank with the float32 share.
        if (
          data[j * GL_FLOATS_PER_PARTICLE + GL_FIELD.rank]! < Math.fround(share)
        ) {
          lit += 1;
        }
      }
      expect(lit, `share ${share}`).toBe(litCount(share, COUNT, COUNT));
    }
  });

  it("lights the first particles of the buffer, so the guard that draws the first N loses dust before it loses stars", () => {
    const lit = litCount(LIT_FRACTION.mouse, COUNT, COUNT);
    for (let j = 0; j < COUNT; j += 1) {
      const rank = data[j * GL_FLOATS_PER_PARTICLE + GL_FIELD.rank]!;
      expect(rank < Math.fround(LIT_FRACTION.mouse), `place ${j}`).toBe(
        j < lit,
      );
    }
  });

  it("keeps the pairing: reordering moves whole particles, so a particle is still the same one on the logo, the hand and its mouse", () => {
    // Every particle of the set appears exactly once, with all of its fields.
    const seen = new Set<string>();
    for (let j = 0; j < COUNT; j += 1) {
      const at = j * GL_FLOATS_PER_PARTICLE;
      seen.add(
        Array.from(data.slice(at, at + GL_FIELD.tone + 3))
          .map((v) => v.toFixed(3))
          .join(","),
      );
    }
    const original = new Set<string>();
    for (let i = 0; i < COUNT; i += 1) {
      original.add(
        [
          set.logo[2 * i]!,
          set.logo[2 * i + 1]!,
          set.hand[2 * i]!,
          set.hand[2 * i + 1]!,
          set.mouse[2 * i]!,
          set.mouse[2 * i + 1]!,
          set.swirlForm[2 * i]!,
          set.swirlForm[2 * i + 1]!,
          set.swirlSplit[2 * i]!,
          set.swirlSplit[2 * i + 1]!,
          set.toneLogo[i]!,
          set.toneHand[i]!,
          set.toneMouse[i]!,
        ]
          .map((v) => v.toFixed(3))
          .join(","),
      );
    }
    expect(seen).toEqual(original);
  });

  it("at every progress, the buffer in star order holds the positions the frame writer makes, particle for particle", () => {
    const frame = createFrame(COUNT);
    for (const p of [0, 0.2, 0.38, 0.6, 0.8, 1]) {
      const phase = phaseAt(p);
      writeParticles(set, phase, frame);
      const leg = legOf(phase);
      const from = leg.split ? GL_FIELD.hand : GL_FIELD.logo;
      const to = leg.split ? GL_FIELD.mouse : GL_FIELD.hand;
      const swirl = leg.split ? GL_FIELD.swirlSplit : GL_FIELD.swirlForm;
      for (const j of [0, 7, 1500, COUNT - 1]) {
        const i = order[j]!;
        const at = j * GL_FLOATS_PER_PARTICLE;
        const a = [data[at + from]!, data[at + from + 1]!];
        const b = [data[at + to]!, data[at + to + 1]!];
        const s = [data[at + swirl]!, data[at + swirl + 1]!];
        // What the vertex shader computes from this record, in float64.
        const e = leg.weights.e;
        const x =
          e <= 0
            ? a[0]!
            : e >= 1
              ? b[0]!
              : a[0]! + (b[0]! - a[0]!) * e + s[0]! * leg.weights.swing;
        const y =
          e <= 0
            ? a[1]!
            : e >= 1
              ? b[1]!
              : a[1]! + (b[1]! - a[1]!) * e + s[1]! * leg.weights.swing;
        expect(x).toBeCloseTo(frame.xy[2 * i]!, 3);
        expect(y).toBeCloseTo(frame.xy[2 * i + 1]!, 3);
      }
    }
  });

  it("the first N particles are a fair sample of every shape: drawing fewer leaves no piece of the logo, the hand or a mouse out", () => {
    const quarter = Math.floor(COUNT / 4);
    /** How many of `xs` fall in each of `bins` equal slices of [lo, hi]. */
    const histogram = (xs: number[], lo: number, hi: number, bins: number) => {
      const counts = new Array<number>(bins).fill(0);
      for (const x of xs) {
        const bin = Math.floor(((x - lo) / (hi - lo)) * bins);
        counts[Math.min(bins - 1, Math.max(0, bin))] += 1;
      }
      return counts;
    };
    const xsOf = (positions: Float32Array) =>
      Array.from({ length: COUNT }, (_, i) => positions[2 * i]!);
    const firstQuarterX = (buffer: Float32Array, field: number) =>
      Array.from(
        { length: quarter },
        (_, j) => buffer[j * GL_FLOATS_PER_PARTICLE + field]!,
      );

    for (const [field, positions] of [
      [GL_FIELD.logo, set.logo],
      [GL_FIELD.hand, set.hand],
      [GL_FIELD.mouse, set.mouse],
    ] as const) {
      const all = xsOf(positions);
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      const whole = histogram(all, lo, hi, 10);
      const part = histogram(firstQuarterX(data, field), lo, hi, 10);
      for (let bin = 0; bin < 10; bin += 1) {
        // A slice the whole set fills well holds about a quarter of that in the first quarter.
        if (whole[bin]! >= 100) {
          expect(part[bin]!).toBeGreaterThan(whole[bin]! * 0.25 * 0.5);
          expect(part[bin]!).toBeLessThan(whole[bin]! * 0.25 * 1.6);
        }
      }
    }

    // Without the order it is not so: the pairing is sorted by x, so the
    // first quarter is only the left of the logo.
    const unordered = packParticles(
      set,
      Uint32Array.from({ length: COUNT }, (_, i) => i),
    );
    const leftOnly = Math.max(...firstQuarterX(unordered, GL_FIELD.logo));
    expect(leftOnly).toBeLessThan(Math.max(...xsOf(set.logo)) - 20);
  });

  it("reuses a buffer that is big enough, and makes a new one that is not", () => {
    const out = new Float32Array(COUNT * GL_FLOATS_PER_PARTICLE + 100);
    expect(packParticles(set, order, out)).toBe(out);
    const small = new Float32Array(10);
    expect(packParticles(set, order, small)).not.toBe(small);
  });

  it("refuses an order that does not list every particle", () => {
    expect(() => packParticles(set, new Uint32Array(5))).toThrow(RangeError);
  });
});
