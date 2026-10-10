import { describe, expect, it } from "vitest";
import {
  type FinaleScene,
  drawnAtShare,
  isBlocked,
} from "@/components/home/stage-finale";
import {
  GL_FIELD,
  GL_FLOATS_PER_PARTICLE,
  packParticles,
} from "@/lib/particles/gl-buffers";
import { type ParticleSet, markClipped } from "@/lib/particles/particle-set";

/**
 * The finale's cut (home finale, 2026-10-11): the figure's particles under
 * the headline's grown letters are marked (`markClipped`, reading the scene's
 * mask through `isBlocked`), and the mark goes to the GPU with the particle.
 * And the headline's live particles thin with the slow-frame guard's share
 * (`drawnAtShare`).
 */

/** A 4 × 3 mask at (10, 20): the middle two columns of the middle row set. */
const scene = {
  maskX: 10,
  maskY: 20,
  maskWidth: 4,
  maskHeight: 3,
  blocked: Uint8Array.from([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]),
} as unknown as FinaleScene;

describe("isBlocked", () => {
  it("reads the mask at the canvas point: a pixel covers [i, i + 1) from the mask's origin", () => {
    expect(isBlocked(scene, 11, 21)).toBe(true);
    expect(isBlocked(scene, 12.99, 21.5)).toBe(true);
    expect(isBlocked(scene, 10.99, 21)).toBe(false);
    expect(isBlocked(scene, 13, 21)).toBe(false);
    expect(isBlocked(scene, 11, 20.99)).toBe(false);
    expect(isBlocked(scene, 11, 22)).toBe(false);
  });

  it("is false anywhere off the mask, and for a point that is not a number", () => {
    for (const [x, y] of [
      [9.99, 21],
      [14, 21],
      [11, 19.99],
      [11, 23],
      [-1e9, -1e9],
      [Number.NaN, 21],
    ] as const) {
      expect(isBlocked(scene, x, y)).toBe(false);
    }
  });
});

function setWith(points: readonly [number, number][]): ParticleSet {
  const n = points.length;
  const zeros = () => new Float32Array(2 * n);
  return {
    count: n,
    logo: zeros(),
    hand: zeros(),
    mouse: Float32Array.from(points.flat()),
    toneLogo: new Uint8Array(n),
    toneHand: new Uint8Array(n),
    toneMouse: new Uint8Array(n),
    swirlForm: zeros(),
    swirlSplit: zeros(),
    shimmerX: new Float32Array(n),
    clip: new Uint8Array(n),
  };
}

describe("markClipped", () => {
  const points: [number, number][] = [
    [11.5, 21.5], // under the letters
    [5, 5],
    [12.2, 21.1], // under the letters
    [13.5, 21.5],
  ];

  it("marks exactly the particles whose last place is blocked, and says how many", () => {
    const set = setWith(points);
    const marked = markClipped(set, (x, y) => isBlocked(scene, x, y));
    expect(marked).toBe(2);
    expect([...set.clip]).toEqual([1, 0, 1, 0]);
  });

  it("clears the marks of an earlier layout: a particle no longer blocked is unmarked", () => {
    const set = setWith(points);
    set.clip.fill(1);
    expect(markClipped(set, () => false)).toBe(0);
    expect([...set.clip]).toEqual([0, 0, 0, 0]);
  });

  it("reads each particle's last place (x then y), not its first", () => {
    const set = setWith(points);
    const seen: [number, number][] = [];
    markClipped(set, (x, y) => {
      seen.push([x, y]);
      return false;
    });
    expect(seen).toEqual(
      points.map(([x, y]) => [Math.fround(x), Math.fround(y)]),
    );
  });

  it("goes to the GPU with its particle, in the buffer's order", () => {
    const set = setWith(points);
    markClipped(set, (x, y) => isBlocked(scene, x, y));
    const order = [3, 2, 1, 0];
    const data = packParticles(set, order);
    const clipAt = (j: number) =>
      data[j * GL_FLOATS_PER_PARTICLE + GL_FIELD.clip];
    expect(order.map((_, j) => clipAt(j))).toEqual([0, 1, 0, 1]);
  });
});

describe("drawnAtShare", () => {
  it("draws all at a share of 1 or more, none at 0 or less (or not a number)", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(drawnAtShare(i, 1)).toBe(true);
      expect(drawnAtShare(i, 1.5)).toBe(true);
      expect(drawnAtShare(i, 0)).toBe(false);
      expect(drawnAtShare(i, -1)).toBe(false);
      expect(drawnAtShare(i, Number.NaN)).toBe(false);
    }
  });

  it("draws floor(n · share) of the first n, spread evenly (no two runs of skips differ by more than one)", () => {
    for (const share of [0.25, 0.5, 0.75, 0.33, 0.9]) {
      const n = 2600;
      let drawn = 0;
      let gap = 0;
      const gaps: number[] = [];
      for (let i = 0; i < n; i += 1) {
        if (drawnAtShare(i, share)) {
          drawn += 1;
          gaps.push(gap);
          gap = 0;
        } else {
          gap += 1;
        }
      }
      expect(drawn).toBe(Math.floor(n * share));
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    }
  });
});
