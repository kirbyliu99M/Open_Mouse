import { describe, expect, it } from "vitest";
import {
  LIT_FRACTION,
  LOOK_LIMITS,
  REFERENCE_COUNT,
  REFERENCE_SCALE,
  SHIMMER_GROWTH,
  STAR_SIZE,
  crowdOf,
  glLook,
  isLit,
  legFractions,
  legLook,
  legStates,
  litCount,
  litness,
  maxPointCssPx,
  rankOf,
} from "@/lib/particles/look";
import { pointSizeFits } from "@/lib/particles/budget";

describe("how crowded the picture is", () => {
  it("is 1 at the count and the scale the 2D look was tuned for, and never less", () => {
    expect(crowdOf(REFERENCE_COUNT, REFERENCE_SCALE)).toBeCloseTo(1, 9);
    expect(crowdOf(10, REFERENCE_SCALE)).toBe(1);
    expect(crowdOf(1, 0.5)).toBe(1);
  });

  it("grows with the count, and falls as the picture is drawn bigger", () => {
    expect(crowdOf(12000, 1.2)).toBeCloseTo(12000 / 1300, 6);
    expect(crowdOf(6000, 1.2)).toBeGreaterThan(crowdOf(3000, 1.2));
    expect(crowdOf(6000, 0.8)).toBeGreaterThan(crowdOf(6000, 1.2));
    // Twice the width is a quarter of the crowd.
    expect(crowdOf(12000, 2.4)).toBeCloseTo(crowdOf(12000, 1.2) / 4, 6);
  });

  it("is about the same for a phone's 6,000 and a desktop's 12,000: it is particles per pixel that counts", () => {
    const phone = crowdOf(6000, 0.97);
    const desktop = crowdOf(12000, 1.2);
    expect(desktop / phone).toBeGreaterThan(0.7);
    expect(desktop / phone).toBeLessThan(1.5);
  });

  it("treats a scale that was not measured as the reference", () => {
    expect(crowdOf(6000, 0)).toBe(crowdOf(6000, REFERENCE_SCALE));
    expect(crowdOf(6000, Number.NaN)).toBe(crowdOf(6000, REFERENCE_SCALE));
  });
});

describe("a particle's look", () => {
  it("is the 2D look's size when nothing is crowded, and gets smaller as the picture fills", () => {
    const calm = glLook(REFERENCE_COUNT, REFERENCE_SCALE);
    const busy = glLook(6000, 1);
    const packed = glLook(20000, 1);
    expect(calm.brightPx).toBeLessThanOrEqual(LOOK_LIMITS.brightPx[1]);
    expect(busy.brightPx).toBeLessThan(calm.brightPx);
    expect(packed.brightPx).toBeLessThanOrEqual(busy.brightPx);
    expect(packed.dimPx).toBeLessThanOrEqual(busy.dimPx);
  });

  it("fades a particle as the picture fills, and never lets it vanish or exceed full", () => {
    for (const [count, scale] of [
      [1300, 1.2],
      [4000, 0.9],
      [6000, 1],
      [8000, 1.2],
      [12000, 1.2],
      [20000, 1.2],
      [20000, 0.6],
      [100000, 0.3],
    ] as const) {
      const look = glLook(count, scale);
      for (const key of [
        "brightPx",
        "dimPx",
        "brightAlpha",
        "dimAlpha",
      ] as const) {
        const [low, high] = LOOK_LIMITS[key];
        expect(look[key], `${key} at ${count}`).toBeGreaterThanOrEqual(low);
        expect(look[key], `${key} at ${count}`).toBeLessThanOrEqual(high);
      }
      expect(look.brightPx).toBeGreaterThan(look.dimPx * 0.6);
    }
    expect(glLook(20000, 1).dimAlpha).toBeLessThan(glLook(4000, 1).dimAlpha);
    expect(glLook(20000, 1).brightAlpha).toBeLessThanOrEqual(
      glLook(4000, 1).brightAlpha,
    );
  });

  it("is the same every time", () => {
    expect(glLook(6000, 0.97)).toEqual(glLook(6000, 0.97));
  });
});

describe("a rank", () => {
  it("is the middle of the particle's place, as a share of the count: inside 0 to 1, never on an edge, and rising with the place", () => {
    expect(rankOf(0, 10)).toBeCloseTo(0.05, 12);
    expect(rankOf(9, 10)).toBeCloseTo(0.95, 12);
    for (const total of [3, 3000, 6000, 12000]) {
      let before = 0;
      for (let place = 0; place < total; place += 1) {
        const r = rankOf(place, total);
        expect(r).toBeGreaterThan(before);
        expect(r).toBeLessThan(1);
        before = r;
      }
    }
  });

  it("is lit in a state when it is under the state's share, and the hand's share of 1 lights every particle", () => {
    expect(isLit(0.149, 0.15)).toBe(true);
    expect(isLit(0.15, 0.15)).toBe(false);
    expect(isLit(0.9999, LIT_FRACTION.hand)).toBe(true);
    expect(isLit(0, 0)).toBe(false);
  });

  it("lights a smaller share's particles inside a bigger share's: the stars of 0.08 are among those of 0.15 and 0.25", () => {
    for (const rank of [0.01, 0.07, 0.079, 0.1, 0.149, 0.2, 0.249, 0.6]) {
      if (isLit(rank, 0.08)) expect(isLit(rank, 0.15)).toBe(true);
      if (isLit(rank, 0.15)) expect(isLit(rank, 0.25)).toBe(true);
    }
  });
});

describe("how many particles a state lights", () => {
  it("is the count of ranks under the share, for every budget the stage uses and every share it may use", () => {
    for (const total of [1500, 3000, 6000, 12000]) {
      for (const fraction of [0.08, 0.108, 0.15, 0.25, 1]) {
        let counted = 0;
        for (let place = 0; place < total; place += 1) {
          if (isLit(rankOf(place, total), fraction)) counted += 1;
        }
        expect(
          litCount(fraction, total, total),
          `${fraction} of ${total}`,
        ).toBe(counted);
      }
    }
  });

  it("is a share of the total, whatever the guard draws, and never more than is drawn", () => {
    expect(litCount(0.15, 12000, 12000)).toBe(1800);
    // The guard draws the first N; the stars come first, so they survive until N is smaller than they are.
    expect(litCount(0.15, 12000, 6000)).toBe(1800);
    expect(litCount(0.15, 12000, 3000)).toBe(1800);
    expect(litCount(0.15, 12000, 1000)).toBe(1000);
    expect(litCount(1, 12000, 9000)).toBe(9000);
    expect(litCount(0, 12000, 12000)).toBe(0);
  });
});

describe("how much of a particle shows during a leg", () => {
  const stars = LIT_FRACTION.mouse;
  const dust = LIT_FRACTION.hand;

  it("is exactly the start state's value at the start and the end state's at the end, however far the progress goes past them", () => {
    for (const rank of [0.01, 0.1, 0.149, 0.15, 0.3, 0.99]) {
      const inStart = isLit(rank, dust) ? 1 : 0;
      const inEnd = isLit(rank, stars) ? 1 : 0;
      expect(litness(rank, dust, stars, 0)).toBe(inStart);
      expect(litness(rank, dust, stars, -0.5)).toBe(inStart);
      expect(litness(rank, dust, stars, 1)).toBe(inEnd);
      expect(litness(rank, dust, stars, 1.7)).toBe(inEnd);
    }
  });

  it("fades out a particle that is not a star in the end, fades in one that is not in the start, and leaves the rest as they are", () => {
    let before = 1;
    for (let e = 0; e <= 1.0001; e += 0.05) {
      // Dust that ends not lit: 1 down to 0, never rising.
      const out = litness(0.6, dust, stars, e);
      expect(out).toBeLessThanOrEqual(before + 1e-12);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
      before = out;
      // A star on both ends: always 1.
      expect(litness(0.05, dust, stars, e)).toBe(1);
    }
    let after = 0;
    for (let e = 0; e <= 1.0001; e += 0.05) {
      // The leg from the logo (stars) to the hand (dust): a particle that is not a star fades in, 0 up to 1.
      const inward = litness(0.6, LIT_FRACTION.logo, dust, e);
      expect(inward).toBeGreaterThanOrEqual(after - 1e-12);
      expect(inward).toBeLessThanOrEqual(1);
      after = inward;
    }
    // Lit on neither end: never shows.
    expect(litness(0.6, 0.15, 0.25, 0.5)).toBe(0);
  });

  it("is half way at half, and is a straight line in the leg's progress", () => {
    expect(litness(0.6, dust, stars, 0.5)).toBeCloseTo(0.5, 12);
    expect(litness(0.6, dust, stars, 0.25)).toBeCloseTo(0.75, 12);
    expect(litness(0.6, stars, dust, 0.25)).toBeCloseTo(0.25, 12);
  });

  it("gives the same answer every time", () => {
    expect(litness(0.42, 1, 0.15, 0.37)).toBe(litness(0.42, 1, 0.15, 0.37));
  });
});

describe("a leg's states", () => {
  it("runs logo to hand, then hand to the mice", () => {
    expect(legStates(false)).toEqual(["logo", "hand"]);
    expect(legStates(true)).toEqual(["hand", "mouse"]);
    expect(legFractions(false)).toEqual([LIT_FRACTION.logo, LIT_FRACTION.hand]);
    expect(legFractions(true)).toEqual([LIT_FRACTION.hand, LIT_FRACTION.mouse]);
  });

  it("makes the drawings stars (a share well under the hand's) and the hand a dust of every particle", () => {
    expect(LIT_FRACTION.hand).toBe(1);
    expect(LIT_FRACTION.logo).toBeGreaterThan(0);
    expect(LIT_FRACTION.logo).toBeLessThan(0.5);
    expect(LIT_FRACTION.mouse).toBeGreaterThan(0);
    expect(LIT_FRACTION.mouse).toBeLessThan(0.5);
  });
});

describe("the look at each end of a leg", () => {
  it("gives a state the look of the particles it lights: the hand's dust is as small as before, the stars are about the 2D look's size", () => {
    const form = legLook(false, 12000, 12000, 1.2);
    const split = legLook(true, 12000, 12000, 1.2);
    // The hand lights all 12,000: the look of 12,000 particles, as it always was.
    expect(form.looks[1]).toEqual(glLook(12000, 1.2));
    expect(split.looks[0]).toEqual(glLook(12000, 1.2));
    // The mice light 1,800: close to the 1,300 the 2D look was tuned for.
    expect(split.looks[1]).toEqual(glLook(1800, 1.2));
    expect(split.looks[1].brightPx).toBeGreaterThan(5);
    expect(split.looks[1].brightPx).toBeLessThanOrEqual(6);
    expect(split.looks[0].brightPx).toBeLessThan(3);
    // The logo lights its own share, and its stars are STAR_SIZE.logo bigger.
    const logoLit = litCount(LIT_FRACTION.logo, 12000, 12000);
    const logo = glLook(logoLit, 1.2);
    expect(form.looks[0].brightPx).toBeCloseTo(
      logo.brightPx * STAR_SIZE.logo,
      12,
    );
    expect(form.looks[0].dimPx).toBeCloseTo(logo.dimPx * STAR_SIZE.logo, 12);
    expect(form.looks[0].brightAlpha).toBe(logo.brightAlpha);
    expect(form.looks[0].brightPx).toBeGreaterThan(split.looks[1].brightPx);
  });

  it("makes the logo's stars a little bigger than a mouse's, and nothing else bigger than its look", () => {
    expect(STAR_SIZE.logo).toBeGreaterThan(1);
    expect(STAR_SIZE.logo).toBeLessThan(2);
    expect(STAR_SIZE.hand).toBe(1);
    expect(STAR_SIZE.mouse).toBe(1);
  });

  it("makes a star bigger and stronger than the dust it comes from, on a desktop and on a phone", () => {
    for (const [total, scale] of [
      [12000, 1.2],
      [6000, 0.97],
      [3000, 0.97],
      [6000, 1.2],
    ] as const) {
      const { looks } = legLook(true, total, total, scale);
      expect(looks[1].brightPx).toBeGreaterThan(looks[0].brightPx * 1.5);
      expect(looks[1].dimPx).toBeGreaterThanOrEqual(looks[0].dimPx);
      expect(looks[1].brightAlpha).toBeGreaterThanOrEqual(looks[0].brightAlpha);
    }
  });

  it("does not shrink the stars as the budget grows: a phone's 900 lit and a desktop's 1,800 lit are both about the 2D look's size", () => {
    const phone = legLook(true, 6000, 6000, 0.97).looks[1];
    const desktop = legLook(true, 12000, 12000, 1.2).looks[1];
    expect(phone.brightPx).toBeGreaterThan(5);
    expect(desktop.brightPx).toBeGreaterThan(5);
    expect(Math.abs(phone.brightPx - desktop.brightPx)).toBeLessThan(1);
  });

  it("counts the lit particles that are drawn: when the guard thins the picture to its floor the stars are the same, the dust is no bigger a crowd", () => {
    const full = legLook(true, 12000, 12000, 1.2);
    const thin = legLook(true, 12000, 3000, 1.2);
    expect(thin.looks[1]).toEqual(full.looks[1]);
    // Fewer dust particles are crowded less, so each is as big or a little bigger.
    expect(thin.looks[0].brightPx).toBeGreaterThanOrEqual(
      full.looks[0].brightPx,
    );
  });
});

describe("the biggest point", () => {
  it("bounds every point the stage can ask for: the biggest look, swelled by the shimmer", () => {
    const bound = maxPointCssPx();
    for (const count of [1, 1300, 4000, 6000, 12000, 20000]) {
      for (const scale of [0.4, 0.97, 1.2, 2, 5]) {
        const look = glLook(count, scale);
        const biggest =
          Math.max(look.brightPx, look.dimPx) *
          Math.max(...Object.values(STAR_SIZE)) *
          (1 + SHIMMER_GROWTH);
        expect(biggest).toBeLessThanOrEqual(bound + 1e-9);
      }
    }
  });

  it("is small enough that an ordinary GPU (largest point 64 or more) passes the check at a ratio of 2, with the 24 px of headroom", () => {
    expect(pointSizeFits([1, 64], maxPointCssPx() * 2)).toBe(true);
    expect(pointSizeFits([1, 1023], maxPointCssPx() * 2)).toBe(true);
    expect(pointSizeFits([1, 16], maxPointCssPx() * 2)).toBe(false);
  });
});
