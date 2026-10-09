import { describe, expect, it } from "vitest";
import {
  DEPTH_LAYERS,
  GATHER,
  type GatherParticle,
  SWEEP,
  arcControl,
  depthOf,
  easeOutCubic,
  gatherAt,
  gatherDelay,
  gatherTrail,
  quadraticAt,
  scatterSource,
  sweepAt,
  sweepX,
} from "@/lib/particles/finale-motion";
import { type Vec, distance } from "@/lib/particles/geometry";

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe("easeOutCubic", () => {
  it("runs from 0 to 1, rising all the way, fastest at the start, and clamps outside", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-2)).toBe(0);
    expect(easeOutCubic(3)).toBe(1);
    expect(easeOutCubic(Number.NaN)).toBe(0);
    const ts = steps(50);
    for (let i = 1; i < ts.length; i += 1) {
      expect(easeOutCubic(ts[i]!)).toBeGreaterThan(easeOutCubic(ts[i - 1]!));
    }
    // Ease-out: more than half done at the halfway mark.
    expect(easeOutCubic(0.5)).toBe(0.875);
  });
});

describe("gatherDelay", () => {
  it("starts the first letter at 0 and the last at letterSpread, later letters later", () => {
    expect(gatherDelay(0, 18, 0)).toBe(0);
    expect(gatherDelay(17, 18, 0)).toBeCloseTo(GATHER.letterSpread, 12);
    for (let l = 1; l < 18; l += 1) {
      expect(gatherDelay(l, 18, 0)).toBeGreaterThan(gatherDelay(l - 1, 18, 0));
    }
  });

  it("adds at most delayJitter of a particle's own, and clamps a letter outside the range", () => {
    expect(gatherDelay(3, 10, 1) - gatherDelay(3, 10, 0)).toBeCloseTo(
      GATHER.delayJitter,
      12,
    );
    expect(gatherDelay(3, 10, 7)).toBe(gatherDelay(3, 10, 1));
    expect(gatherDelay(-4, 10, 0)).toBe(0);
    expect(gatherDelay(40, 10, 0)).toBe(gatherDelay(9, 10, 0));
    // One letter: no spread at all.
    expect(gatherDelay(0, 1, 0)).toBe(0);
  });

  it("never pushes the last particle's landing past the end of the gather", () => {
    expect(gatherDelay(99, 100, 1) + GATHER.duration).toBeLessThanOrEqual(1);
  });

  it("refuses a letter count that is not a positive whole number", () => {
    expect(() => gatherDelay(0, 0, 0)).toThrow(/letterCount/);
    expect(() => gatherDelay(0, 2.5, 0)).toThrow(/letterCount/);
  });
});

describe("scatterSource, arcControl and quadraticAt", () => {
  it("scatters around the headline: stretched across, squeezed in height, then spread", () => {
    const centre: Vec = [100, 50];
    expect(scatterSource(centre, centre, [0, 0], { x: 9, y: 9 })).toEqual(
      centre,
    );
    expect(scatterSource([200, 150], centre, [0, 0], { x: 9, y: 9 })).toEqual([
      100 + 100 * GATHER.stretchX,
      50 + 100 * GATHER.squashY,
    ]);
    expect(scatterSource(centre, centre, [1, -2], { x: 10, y: 5 })).toEqual([
      110, 40,
    ]);
  });

  it("bends the curve sideways by `bend` of the distance, and not at all at 0", () => {
    expect(arcControl([0, 0], [10, 0], 0)).toEqual([5, 0]);
    expect(arcControl([0, 0], [10, 0], 0.2)).toEqual([5, 2]);
    expect(arcControl([0, 0], [10, 0], -0.2)).toEqual([5, -2]);
    // Travelling down the screen, a positive bend swings to -x.
    expect(arcControl([0, 0], [0, 10], 0.2)).toEqual([-2, 5]);
  });

  it("starts and ends a curve exactly on its ends", () => {
    const a: Vec = [1, 2];
    const c: Vec = [7, -3];
    const b: Vec = [9, 9];
    expect(quadraticAt(a, c, b, 0)).toEqual(a);
    expect(quadraticAt(a, c, b, 1)).toEqual(b);
    expect(quadraticAt(a, c, b, 2)).toEqual(b);
    expect(quadraticAt(a, c, b, 0.5)).toEqual([
      0.25 * 1 + 0.5 * 7 + 0.25 * 9,
      0.25 * 2 + 0.5 * -3 + 0.25 * 9,
    ]);
  });
});

describe("gatherAt", () => {
  const particle: GatherParticle = {
    source: [-40, 80],
    target: [120, 30],
    delay: 0.3,
    bend: GATHER.bendMin + GATHER.bendRange,
  };

  it("waits at its source until its delay, then flies, then rests on its target", () => {
    expect(gatherAt(particle, 0)).toEqual({
      phase: "waiting",
      position: particle.source,
      q: 0,
      flash: false,
    });
    expect(gatherAt(particle, 0.3).phase).toBe("waiting");
    expect(gatherAt(particle, 0.4).phase).toBe("flying");
    const done = gatherAt(particle, 0.501);
    expect(done.phase).toBe("arrived");
    expect(done.position).toEqual(particle.target);
    expect(gatherAt(particle, 1).position).toEqual(particle.target);
    expect(gatherAt(particle, Number.NaN).phase).toBe("waiting");
  });

  it("flashes only just after it lands", () => {
    expect(gatherAt(particle, 0.501).flash).toBe(true);
    expect(gatherAt(particle, 0.5 + GATHER.flash * 0.9).flash).toBe(true);
    expect(gatherAt(particle, 0.5 + GATHER.flash * 1.1).flash).toBe(false);
    expect(gatherAt(particle, 0.45).flash).toBe(false);
  });

  it("gets closer to its target all the way (the larger t, the nearer), even on the most bent curve", () => {
    for (const bend of [
      0,
      GATHER.bendMin,
      GATHER.bendMin + GATHER.bendRange,
      -0.32,
    ]) {
      const p = { ...particle, bend };
      let last = Infinity;
      for (const t of steps(200)) {
        const d = distance(gatherAt(p, t).position, p.target);
        expect(d).toBeLessThanOrEqual(last + 1e-9);
        last = d;
      }
      expect(last).toBe(0);
    }
  });

  it("swings to the side of its bend: off the straight line mid-flight", () => {
    const mid = gatherAt(particle, 0.3 + GATHER.duration / 2).position;
    // Signed distance from the source-target line; a positive bend goes left.
    const [ax, ay] = particle.source;
    const [bx, by] = particle.target;
    const side = (bx - ax) * (mid[1] - ay) - (by - ay) * (mid[0] - ax);
    expect(side).toBeGreaterThan(0);
  });
});

describe("gatherTrail", () => {
  const particle: GatherParticle = {
    source: [0, 0],
    target: [100, 0],
    delay: 0,
    bend: 0,
  };

  it("is trailSamples points ending where the particle is, all behind it", () => {
    const t = 0.1;
    const trail = gatherTrail(particle, t);
    expect(trail).toHaveLength(GATHER.trailSamples);
    expect(trail[trail.length - 1]).toEqual(gatherAt(particle, t).position);
    for (let i = 1; i < trail.length; i += 1) {
      expect(trail[i]![0]).toBeGreaterThanOrEqual(trail[i - 1]![0]);
    }
  });

  it("reaches back `trail` of the flight: its first point is where the particle was then", () => {
    const t = 0.15; // q = 0.75
    const trail = gatherTrail(particle, t);
    const then = gatherAt(particle, t - GATHER.trail * GATHER.duration);
    expect(then.phase).toBe("flying");
    expect(distance(trail[0]!, then.position)).toBeLessThan(1e-9);
    // A real length, not a dot: the first point is well behind the last.
    expect(distance(trail[0]!, trail[trail.length - 1]!)).toBeGreaterThan(1);
    // Evenly spread in flight progress: point j is at q - trail + trail·j/(n-1).
    trail.forEach((p, j) => {
      const q =
        0.75 - GATHER.trail + (GATHER.trail * j) / (GATHER.trailSamples - 1);
      const at = gatherAt(particle, q * GATHER.duration).position;
      expect(distance(p, at)).toBeLessThan(1e-9);
    });
  });

  it("clips the trail at the source early in the flight", () => {
    const trail = gatherTrail(particle, 0.002); // q = 0.01
    expect(trail[0]).toEqual(particle.source);
  });

  it("is empty while the particle waits or rests", () => {
    expect(gatherTrail({ ...particle, delay: 0.5 }, 0.2)).toEqual([]);
    expect(gatherTrail(particle, 0.9)).toEqual([]);
  });
});

describe("depthOf", () => {
  it("is 0 to 1 with a layer 0 to 4, the same for the same input", () => {
    for (let i = 0; i < 300; i += 1) {
      const x = i * 7.3;
      const y = (i * 13) % 90;
      const r = (i % 17) / 16;
      const a = depthOf(x, y, r);
      expect(a).toEqual(depthOf(x, y, r));
      expect(a.depth).toBeGreaterThanOrEqual(0);
      expect(a.depth).toBeLessThanOrEqual(1);
      expect(a.layer).toBe(
        Math.min(
          DEPTH_LAYERS.length - 1,
          Math.floor(a.depth * DEPTH_LAYERS.length),
        ),
      );
    }
  });

  it("varies with position, not only with the particle's own share: v8's slow wave and finer ripple", () => {
    // depth = 0.52 + 0.14 sin(0.012x + 1) + 0.2 sin(0.09x + 0.13y) cos(0.05x - 0.08y) + 0.55 (r - 0.5)
    const at = (x: number, y: number) =>
      0.52 +
      0.14 * Math.sin(x * 0.012 + 1) +
      0.2 * Math.sin(x * 0.09 + y * 0.13) * Math.cos(x * 0.05 - y * 0.08);
    for (const [x, y] of [
      [0, 0],
      [40, 10],
      [130, 0],
      [300, 55],
      [-90, 20],
    ] as const) {
      expect(depthOf(x, y, 0.5).depth).toBeCloseTo(
        Math.min(1, Math.max(0, at(x, y))),
        12,
      );
    }
    // Same share, different places, different depths.
    const depths = new Set(
      [0, 17, 50, 133, 260].map((x) => depthOf(x, 30, 0.5).depth.toFixed(6)),
    );
    expect(depths.size).toBe(5);
  });

  it("goes deeper (nearer) with the particle's own share", () => {
    expect(depthOf(10, 10, 0.9).depth).toBeGreaterThan(
      depthOf(10, 10, 0.1).depth,
    );
  });

  it("puts nearer layers bigger and brighter", () => {
    for (let i = 1; i < DEPTH_LAYERS.length; i += 1) {
      expect(DEPTH_LAYERS[i]!.px).toBeGreaterThan(DEPTH_LAYERS[i - 1]!.px);
      expect(DEPTH_LAYERS[i]!.alpha).toBeGreaterThan(
        DEPTH_LAYERS[i - 1]!.alpha,
      );
    }
  });
});

describe("the sweep", () => {
  const w = SWEEP.desktop;
  const left = 380;
  const right = 1060;

  it("has nothing solid at t = 0 and everything solid with no afterglow left at t = 1", () => {
    const start = sweepX(0, left, right, w);
    const end = sweepX(1, left, right, w);
    for (const x of [left, (left + right) / 2, right]) {
      expect(sweepAt(x, start, w).solid).toBe(false);
      expect(sweepAt(x, start, w).excite).toBeLessThanOrEqual(1);
      const s = sweepAt(x, end, w);
      expect(s.solid).toBe(true);
      expect(s.afterglow).toBe(0);
      expect(s.core).toBeLessThan(1e-6);
    }
  });

  it("moves right all the way, and clamps t", () => {
    let last = -Infinity;
    for (const t of steps(100)) {
      const x = sweepX(t, left, right, w);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
    expect(sweepX(-1, left, right, w)).toBe(sweepX(0, left, right, w));
    expect(sweepX(2, left, right, w)).toBe(sweepX(1, left, right, w));
    expect(() => sweepX(0.5, 10, 0, w)).toThrow(/right/);
  });

  it("solidifies a point once and for all: solid at one t stays solid at every later t", () => {
    for (const x of [left, 500, 777, right]) {
      let was = false;
      for (const t of steps(100)) {
        const solid = sweepAt(x, sweepX(t, left, right, w), w).solid;
        if (was) expect(solid).toBe(true);
        was = solid;
      }
      expect(was).toBe(true);
    }
  });

  it("splits the line at the core: solid behind it, live ahead of it, neither inside it", () => {
    const at = 600;
    expect(sweepAt(at - w.core - 0.01, at, w)).toMatchObject({
      solid: true,
      live: false,
    });
    expect(sweepAt(at, at, w)).toMatchObject({ solid: false, live: false });
    expect(sweepAt(at + w.core, at, w)).toMatchObject({
      solid: false,
      live: true,
    });
  });

  it("fades the afterglow from the core back over its width", () => {
    const at = 600;
    const back = at - w.core;
    expect(sweepAt(back - w.afterglow - 1, at, w).afterglow).toBe(0);
    let last = -1;
    for (let x = back - w.afterglow; x < back; x += 5) {
      const g = sweepAt(x, at, w).afterglow;
      expect(g).toBeGreaterThanOrEqual(last);
      expect(g).toBeLessThanOrEqual(1);
      last = g;
    }
    expect(last).toBeGreaterThan(0.9);
  });

  it("is hottest at its centre, with a longer tail behind than in front", () => {
    const at = 600;
    expect(sweepAt(at, at, w).core).toBe(0.95);
    const behind = sweepAt(at - w.core, at, w).core;
    const ahead = sweepAt(at + w.core, at, w).core;
    expect(behind).toBeGreaterThan(ahead);
    expect(behind).toBeLessThan(0.95);
  });

  it("lifts live particles just ahead of it by up to two layers, less further away", () => {
    const at = 600;
    expect(sweepAt(at + w.core, at, w).excite).toBe(2);
    let last = 2;
    for (let x = at + w.core; x < at + 400; x += 3) {
      const e = sweepAt(x, at, w).excite;
      expect([0, 1, 2]).toContain(e);
      expect(e).toBeLessThanOrEqual(last);
      last = e;
    }
    expect(last).toBe(0);
    expect(sweepAt(at - 50, at, w).excite).toBe(0);
  });

  it("has a narrower phone version", () => {
    expect(SWEEP.mobile.core).toBeLessThan(SWEEP.desktop.core);
    expect(SWEEP.mobile.afterglow).toBeLessThan(SWEEP.desktop.afterglow);
  });
});
