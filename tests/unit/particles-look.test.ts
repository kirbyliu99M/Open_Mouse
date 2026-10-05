import { describe, expect, it } from "vitest";
import {
  GAIN_SIZE_POWER,
  LOOK_LIMITS,
  REFERENCE_COUNT,
  REFERENCE_SCALE,
  SHIMMER_GROWTH,
  STATE_GAIN,
  crowdOf,
  glLook,
  legGain,
  maxPointCssPx,
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

describe("the gain of a state", () => {
  it("draws the logo (the most particles per pixel of line) fainter and a mouse (the fewest) stronger than the hand", () => {
    expect(STATE_GAIN.logo).toBeLessThan(STATE_GAIN.hand);
    expect(STATE_GAIN.mouse).toBeGreaterThan(STATE_GAIN.hand);
  });

  it("gives a leg the gain it starts with and the gain it ends with", () => {
    expect(legGain(false)).toEqual([STATE_GAIN.logo, STATE_GAIN.hand]);
    expect(legGain(true)).toEqual([STATE_GAIN.hand, STATE_GAIN.mouse]);
  });
});

describe("the biggest point", () => {
  it("bounds every point the stage can ask for: the biggest look, swelled by the shimmer, at the biggest gain", () => {
    const bound = maxPointCssPx();
    const biggestGain = Math.max(...Object.values(STATE_GAIN));
    for (const count of [1, 1300, 4000, 6000, 12000, 20000]) {
      for (const scale of [0.4, 0.97, 1.2, 2, 5]) {
        const look = glLook(count, scale);
        const biggest =
          Math.max(look.brightPx, look.dimPx) *
          (1 + SHIMMER_GROWTH) *
          biggestGain ** GAIN_SIZE_POWER;
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
