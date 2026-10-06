import { describe, expect, it } from "vitest";
import type { Pairing } from "@/lib/particles/pairing";
import {
  type StageLayout,
  buildParticleSet,
  pairingTables,
  pairingTablesInSlices,
  pairingTablesSteps,
} from "@/lib/particles/particle-set";

/** A small pairing of 7 particles, made up: x, y and tone of each on the logo, the hand and its mouse. */
const N = 7;
const pairing: Pairing = {
  count: N,
  layout: "row",
  logo: Array.from({ length: N }, (_, i) => ({
    x: i * 10 + (i % 3),
    y: i,
    tone: (i % 2) as 0 | 1,
  })),
  hand: Array.from({ length: N }, (_, i) => ({
    x: i,
    y: i * 2,
    tone: ((i + 1) % 2) as 0 | 1,
  })),
  mouse: Array.from({ length: N }, (_, i) => ({
    x: i * 3,
    y: i,
    tone: ((i + 1) % 2) as 0 | 1,
  })),
  slot: [0, 1, 2, 0, 1, 2, 0],
};
const layout: StageLayout = {
  width: 400,
  height: 300,
  logo: { x: 10, y: 20, scale: 1.5 },
  hand: { x: 5, y: 7, scale: 0.9 },
  mice: [
    { x: 1, y: 2, scale: 1.1 },
    { x: 3, y: 4, scale: 0.8 },
    { x: 5, y: 6, scale: 1.3 },
  ],
};

/**
 * What the particle set was before the swings and directions were cached per
 * pairing (`pairingTables`): main's `buildParticleSet` run on the pairing and
 * the layout above, for two seeds. Every number is the Float32 value it
 * stored, written out in full: the cached tables must give the same ones, not
 * numbers that are close.
 */
const FROM_MAIN: Record<number, Record<string, number[]>> = {
  20261003: {
    swirlForm: [
      57.755836486816406, 0, -36.852821350097656, 33.76020050048828,
      4.347898960113525, -49.54206848144531, 28.392404556274414,
      37.03286361694336, -52.75518035888672, -9.331648826599121,
      21.964826583862305, -13.972224235534668, -12.819290161132812,
      47.6871223449707,
    ],
    swirlSplit: [
      -15.276976585388184, 44.71719741821289, -16.390758514404297,
      -37.46302795410156, 37.207664489746094, 16.47069549560547,
      -36.182594299316406, 12.187142372131348, 21.179241180419922,
      -38.37715148925781, 5.008023738861084, 20.701955795288086,
      -33.53071594238281, -22.538982391357422,
    ],
    shimmerX: [
      0, 0.18333333730697632, 0.36666667461395264, 0.5, 0.6833333373069763,
      0.8666666746139526, 1,
    ],
    toneLogo: [0, 1, 0, 1, 0, 1, 0],
    toneHand: [1, 0, 1, 0, 1, 0, 1],
    toneMouse: [1, 0, 1, 0, 1, 0, 1],
    logo: [10, 20, 26.5, 21.5, 43, 23, 55, 24.5, 71.5, 26, 88, 27.5, 100, 29],
    hand: [
      5, 7, 5.900000095367432, 8.800000190734863, 6.800000190734863,
      10.600000381469727, 7.699999809265137, 12.399999618530273,
      8.600000381469727, 14.199999809265137, 9.5, 16, 10.399999618530273,
      17.799999237060547,
    ],
    mouse: [
      1, 2, 5.400000095367432, 4.800000190734863, 12.800000190734863,
      8.600000381469727, 10.899999618530273, 5.300000190734863,
      12.600000381469727, 7.199999809265137, 24.5, 12.5, 20.799999237060547,
      8.600000381469727,
    ],
  },
  7: {
    swirlForm: [
      20.34075927734375, 0, -16.710601806640625, 15.308279991149902,
      5.676826000213623, -64.68450927734375, 31.696699142456055,
      41.34273147583008, -43.21983337402344, -7.644979953765869,
      32.51419448852539, -20.682870864868164, -10.732028007507324,
      39.922611236572266,
    ],
    swirlSplit: [
      -5.380327224731445, 15.74874210357666, -7.432251930236816,
      -16.987295150756836, 48.58011245727539, 21.504932403564453,
      -40.39350891113281, 13.605476379394531, 17.351154327392578,
      -31.44059181213379, 7.41330099105835, 30.644790649414062,
      -28.071178436279297, -18.869140625,
    ],
    shimmerX: [
      0, 0.18333333730697632, 0.36666667461395264, 0.5, 0.6833333373069763,
      0.8666666746139526, 1,
    ],
    toneLogo: [0, 1, 0, 1, 0, 1, 0],
    toneHand: [1, 0, 1, 0, 1, 0, 1],
    toneMouse: [1, 0, 1, 0, 1, 0, 1],
    logo: [10, 20, 26.5, 21.5, 43, 23, 55, 24.5, 71.5, 26, 88, 27.5, 100, 29],
    hand: [
      5, 7, 5.900000095367432, 8.800000190734863, 6.800000190734863,
      10.600000381469727, 7.699999809265137, 12.399999618530273,
      8.600000381469727, 14.199999809265137, 9.5, 16, 10.399999618530273,
      17.799999237060547,
    ],
    mouse: [
      1, 2, 5.400000095367432, 4.800000190734863, 12.800000190734863,
      8.600000381469727, 10.899999618530273, 5.300000190734863,
      12.600000381469727, 7.199999809265137, 24.5, 12.5, 20.799999237060547,
      8.600000381469727,
    ],
  },
};

/** A bigger made-up pairing, for the slices (more than the 2,000 particles a slice makes). */
function bigPairing(n: number): Pairing {
  return {
    count: n,
    layout: "row",
    logo: Array.from({ length: n }, (_, i) => ({
      x: i * 0.37,
      y: i % 11,
      tone: (i % 2) as 0 | 1,
    })),
    hand: Array.from({ length: n }, (_, i) => ({
      x: i * 0.11,
      y: i % 7,
      tone: (i % 3 === 0 ? 1 : 0) as 0 | 1,
    })),
    mouse: Array.from({ length: n }, (_, i) => ({
      x: i * 0.23,
      y: i % 5,
      tone: (i % 5 === 0 ? 1 : 0) as 0 | 1,
    })),
    slot: Array.from({ length: n }, (_, i) => i % 3),
  };
}

describe("the particle set is what main's buildParticleSet made", () => {
  for (const seed of [20261003, 7]) {
    it(`seed ${seed}: the swirls, the shimmer's x, the tones and the positions are the same numbers, exactly`, () => {
      const set = buildParticleSet(pairing, layout, seed);
      const want = FROM_MAIN[seed]!;
      expect(Array.from(set.swirlForm)).toEqual(want.swirlForm);
      expect(Array.from(set.swirlSplit)).toEqual(want.swirlSplit);
      expect(Array.from(set.shimmerX)).toEqual(want.shimmerX);
      expect(Array.from(set.toneLogo)).toEqual(want.toneLogo);
      expect(Array.from(set.toneHand)).toEqual(want.toneHand);
      expect(Array.from(set.toneMouse)).toEqual(want.toneMouse);
      expect(Array.from(set.logo)).toEqual(want.logo);
      expect(Array.from(set.hand)).toEqual(want.hand);
      expect(Array.from(set.mouse)).toEqual(want.mouse);
    });
  }

  it("a seed that is not one of those gives other swirls (the numbers above are not a coincidence of the pairing)", () => {
    const a = buildParticleSet(pairing, layout, 20261003);
    const b = buildParticleSet(pairing, layout, 8);
    expect(Array.from(a.swirlForm)).not.toEqual(Array.from(b.swirlForm));
  });
});

describe("pairingTablesInSlices", () => {
  it("makes the same tables as pairingTables, number for number, for several sizes and seeds (a size over a slice too)", async () => {
    for (const n of [3, 7, 1999, 2000, 2001, 4500]) {
      for (const seed of [20261003, 7, 1]) {
        const p = n === 7 ? pairing : bigPairing(n);
        // Two pairings with the same points: the tables are cached per pairing.
        const whole = pairingTables({ ...p }, seed);
        let pauses = 0;
        const sliced = await pairingTablesInSlices({ ...p }, seed, async () => {
          pauses += 1;
        });
        for (const key of [
          "formX",
          "formY",
          "splitX",
          "splitY",
          "shimmerX",
          "toneLogo",
          "toneHand",
          "toneMouse",
        ] as const) {
          expect(
            Array.from(sliced[key]),
            `${n} particles, seed ${seed}, ${key}`,
          ).toEqual(Array.from(whole[key]));
        }
        // A slice is 2,000 particles: one pause for every full slice.
        expect(pauses, `${n} particles`).toBe(Math.floor(n / 2000));
      }
    }
  });

  it("gives the tables the set is built from: the swirls are the tables times the amplitude and the reach", () => {
    const tables = pairingTables({ ...pairing }, 20261003);
    const set = buildParticleSet(pairing, layout, 20261003);
    const reach = Math.min(layout.width, layout.height);
    for (let i = 0; i < N; i += 1) {
      expect(set.swirlForm[2 * i]).toBe(
        Math.fround(tables.formX[i]! * 0.22 * reach),
      );
    }
  });

  it("is cached per pairing: asking again gives the same tables, and the generator version returns them too", async () => {
    const p = { ...pairing };
    const first = await pairingTablesInSlices(p, 5, async () => {});
    expect(pairingTables(p, 5)).toBe(first);
    const steps = pairingTablesSteps(p, 5);
    const next = steps.next();
    expect(next.done).toBe(true);
    expect(next.value).toBe(first);
  });

  it("stops when pause throws: the stage was destroyed", async () => {
    await expect(
      pairingTablesInSlices(bigPairing(4500), 3, async () => {
        throw new Error("destroyed");
      }),
    ).rejects.toThrow("destroyed");
  });
});
