import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import {
  LOW_END_CORES,
  MAX_DPR,
  MIN_VIEWPORT_HEIGHT,
  PARTICLE_BUDGET,
  SHIMMER_MAX_MS,
  SHIMMER_MS,
  canvasScale,
  mayAnimate,
  particleCount,
  shimmerAt,
  shimmerBoost,
} from "@/lib/particles/budget";
import {
  interpolatePosition,
  swirlDirection,
} from "@/lib/particles/interpolate";
import { parseTargets } from "@/lib/particles/load-targets";
import { LOGO_BOX } from "@/lib/particles/logo";
import { buildPairing } from "@/lib/particles/pairing";
import {
  type StageLayout,
  buildParticleSet,
  createFrame,
  handBox,
  logoBox,
  mouseBox,
  writeParticles,
} from "@/lib/particles/particle-set";
import { phaseAt } from "@/lib/particles/timeline";

const targets = parseTargets(
  JSON.parse(readFileSync(ARTIFACT_PATHS.targets, "utf8")),
);
const sketch = ["g-pro-sketch", "g-pro-sketch", "g-pro-sketch"];

describe("the particle budget", () => {
  it("is about 900 on a phone and 1,300 on a desktop, as constants", () => {
    expect(PARTICLE_BUDGET).toEqual({ mobile: 900, desktop: 1300 });
    expect(particleCount(false, 8)).toBe(900);
    // 1300 is not a multiple of three, and the mice each take a third.
    expect(particleCount(true, 8)).toBe(1299);
    expect(particleCount(true, undefined)).toBe(1299);
  });

  it("is halved on 4 cores or fewer", () => {
    expect(LOW_END_CORES).toBe(4);
    expect(particleCount(false, 4)).toBe(450);
    expect(particleCount(false, 2)).toBe(450);
    expect(particleCount(true, 4)).toBe(648);
    expect(particleCount(false, 5)).toBe(900);
    // 0 and missing mean "unknown", not "low end".
    expect(particleCount(false, 0)).toBe(900);
  });

  it("always gives a multiple of three", () => {
    for (const wide of [false, true]) {
      for (const cores of [undefined, 1, 4, 6, 16]) {
        expect(particleCount(wide, cores) % 3).toBe(0);
      }
    }
  });

  it("caps the canvas's device pixel ratio at 2", () => {
    expect(MAX_DPR).toBe(2);
    expect(canvasScale(1)).toBe(1);
    expect(canvasScale(1.5)).toBe(1.5);
    expect(canvasScale(3)).toBe(2);
    expect(canvasScale(0.5)).toBe(1);
    expect(canvasScale(undefined)).toBe(1);
    expect(canvasScale(Number.NaN)).toBe(1);
  });
});

describe("when the animated layout may switch on", () => {
  const ok = {
    reducedMotion: false,
    heroHeight: 600,
    panelHeight: 844,
    viewportHeight: 844,
  };

  it("needs all three: motion allowed, the hero fits in 100svh, a viewport 600 px tall", () => {
    expect(MIN_VIEWPORT_HEIGHT).toBe(600);
    expect(mayAnimate(ok)).toBe(true);
    expect(mayAnimate({ ...ok, reducedMotion: true })).toBe(false);
    expect(mayAnimate({ ...ok, heroHeight: 845 })).toBe(false);
    expect(mayAnimate({ ...ok, heroHeight: 844 })).toBe(true);
    expect(mayAnimate({ ...ok, viewportHeight: 599, panelHeight: 599 })).toBe(
      false,
    );
    expect(mayAnimate({ ...ok, viewportHeight: 600, panelHeight: 600 })).toBe(
      true,
    );
  });

  it("is false for sizes that were never measured", () => {
    expect(mayAnimate({ ...ok, heroHeight: 0 })).toBe(false);
    expect(mayAnimate({ ...ok, panelHeight: 0 })).toBe(false);
    expect(mayAnimate({ ...ok, heroHeight: Number.NaN })).toBe(false);
  });

  it("320x568, a phone in landscape and a hero that has grown with the text all stay static", () => {
    expect(
      mayAnimate({
        ...ok,
        heroHeight: 540,
        panelHeight: 568,
        viewportHeight: 568,
      }),
    ).toBe(false);
    expect(
      mayAnimate({
        ...ok,
        heroHeight: 300,
        panelHeight: 390,
        viewportHeight: 390,
      }),
    ).toBe(false);
    expect(mayAnimate({ ...ok, heroHeight: 1100 })).toBe(false);
  });
});

describe("the shimmer", () => {
  it("plays once and is over within 3 s (WCAG 2.2.2)", () => {
    expect(SHIMMER_MS).toBeLessThanOrEqual(3000);
    expect(SHIMMER_MAX_MS).toBe(3000);
    expect(shimmerAt(0).active).toBe(true);
    expect(shimmerAt(SHIMMER_MS - 1).active).toBe(true);
    expect(shimmerAt(SHIMMER_MS).active).toBe(false);
    expect(shimmerAt(SHIMMER_MS + 5000).active).toBe(false);
    expect(shimmerAt(-5).active).toBe(false);
    expect(shimmerAt(Number.NaN).active).toBe(false);
  });

  it("sweeps a band across the logo, left to right, and leaves nothing lit once it has finished", () => {
    let previous = -Infinity;
    for (let ms = 0; ms < SHIMMER_MS; ms += 50) {
      const { center } = shimmerAt(ms);
      expect(center).toBeGreaterThanOrEqual(previous);
      previous = center;
    }
    // It starts left of the logo and ends right of it.
    expect(shimmerAt(0).center).toBeLessThan(0);
    expect(shimmerAt(SHIMMER_MS - 1).center).toBeGreaterThan(1);
    // A particle is lit when the band is on it, and not when the band is far away.
    expect(shimmerBoost(0.5, 0.5)).toBe(1);
    expect(shimmerBoost(0.5, 0.9)).toBeLessThan(0.01);
    const done = shimmerAt(SHIMMER_MS + 1);
    for (let x = 0; x <= 1; x += 0.05)
      expect(shimmerBoost(x, done.center)).toBeLessThan(0.01);
  });
});

describe("the boxes the targets are drawn into", () => {
  it("the logo is fitted inside its image and centred (object-fit: contain)", () => {
    // A box exactly the logo's shape, at twice the size.
    const exact = logoBox({ x: 100, y: 50, width: 440, height: 392 });
    expect(exact).toEqual({ x: 100, y: 50, scale: 2 });
    // Wider than the logo: it is as tall as the box and centred sideways.
    const wide = logoBox({ x: 0, y: 0, width: 1000, height: 196 });
    expect(wide.scale).toBe(1);
    expect(wide.x).toBeCloseTo((1000 - LOGO_BOX.width) / 2, 12);
    // Narrower: as wide as the box and centred vertically.
    const narrow = logoBox({ x: 10, y: 20, width: 110, height: 500 });
    expect(narrow.scale).toBe(0.5);
    expect(narrow.y).toBeCloseTo(20 + (500 - 98) / 2, 12);
  });

  it("the hand's A4 origin is offset by the drawing's viewBox, and the mice start at their image's corner", () => {
    const hand = handBox(
      { x: 50, y: 80, width: 411.2, height: 506.8 },
      { x: -35.6, y: -13, width: 411.2 },
    );
    expect(hand.scale).toBeCloseTo(1, 12);
    // The sheet's top-left corner (0, 0) lands 35.6 px right of and 13 px below the image's corner.
    expect(hand.x).toBeCloseTo(50 + 35.6, 9);
    expect(hand.y).toBeCloseTo(80 + 13, 9);
    expect(mouseBox({ x: 7, y: 9, width: 170, height: 80 }, 340)).toEqual({
      x: 7,
      y: 9,
      scale: 0.5,
    });
  });
});

describe("the particles", () => {
  const layout: StageLayout = {
    width: 350,
    height: 844,
    logo: logoBox({ x: 55, y: 80, width: 240, height: 214 }),
    hand: handBox(
      { x: 10, y: 150, width: 330, height: 407 },
      targets.hand.viewBox,
    ),
    mice: [0, 1, 2].map((slot) =>
      mouseBox({ x: 20, y: 120 + slot * 220, width: 310, height: 147 }, 340),
    ),
  };
  const pairing = buildPairing(targets, {
    count: 900,
    layout: "stacked",
    seed: 5,
    mice: sketch,
  });
  const set = buildParticleSet(pairing, layout, 5);

  const at = (p: number) => {
    const frame = createFrame(set.count);
    writeParticles(set, phaseAt(p), frame);
    return frame;
  };

  it("at p = 0 every particle is exactly on the logo, and bright where the logo's point is", () => {
    const { xy, bright } = at(0);
    expect(Array.from(xy)).toEqual(Array.from(set.logo));
    expect(Array.from(bright)).toEqual(Array.from(set.toneLogo));
    // The logo's points are where the box puts them.
    const first = pairing.logo[0]!;
    expect(xy[0]).toBeCloseTo(layout.logo.x + first.x * layout.logo.scale, 3);
    expect(xy[1]).toBeCloseTo(layout.logo.y + first.y * layout.logo.scale, 3);
  });

  it("at p = 0.38 every particle is exactly on the hand, and it rests there until the hand is measured", () => {
    for (const p of [0.38, 0.45, 0.55]) {
      expect(Array.from(at(p).xy)).toEqual(Array.from(set.hand));
    }
  });

  it("at p = 0.90 every particle is exactly on its mouse, and holds still to 1.00", () => {
    const settled = Array.from(at(0.9).xy);
    expect(settled).toEqual(Array.from(set.mouse));
    for (const p of [0.92, 0.96, 1])
      expect(Array.from(at(p).xy)).toEqual(settled);
    // Each mouse's particles are inside that mouse's box.
    for (let i = 0; i < set.count; i += 1) {
      const box = layout.mice[pairing.slot[i]!]!;
      expect(settled[2 * i]!).toBeGreaterThanOrEqual(box.x - 1);
      expect(settled[2 * i]!).toBeLessThanOrEqual(box.x + 340 * box.scale + 1);
      expect(settled[2 * i + 1]!).toBeGreaterThanOrEqual(box.y - 1);
      expect(settled[2 * i + 1]!).toBeLessThanOrEqual(
        box.y + 162 * box.scale + 1,
      );
    }
  });

  it("between, a particle follows pos = a + (b - a) * e(t) + sin(pi * e) * A along its golden-angle direction", () => {
    // Logo to hand at p = 0.19, hand to mouse at p = 0.725.
    for (const [p, from, to, swirl] of [
      [0.19, set.logo, set.hand, set.swirlForm],
      [0.725, set.hand, set.mouse, set.swirlSplit],
    ] as const) {
      const phase = phaseAt(p);
      const t = p < 0.5 ? phase.formT : phase.mouseT;
      const { xy } = at(p);
      for (const i of [0, 1, 17, 450, 899]) {
        const amplitude = Math.hypot(swirl[2 * i]!, swirl[2 * i + 1]!);
        const direction: [number, number] = [
          swirl[2 * i]! / amplitude,
          swirl[2 * i + 1]! / amplitude,
        ];
        const [x, y] = interpolatePosition(
          [from[2 * i]!, from[2 * i + 1]!],
          [to[2 * i]!, to[2 * i + 1]!],
          t,
          direction,
          amplitude,
        );
        expect(xy[2 * i]!).toBeCloseTo(x, 2);
        expect(xy[2 * i + 1]!).toBeCloseTo(y, 2);
      }
    }
  });

  it("the swirl directions are the golden-angle ones, and the amplitudes stay within the canvas's reach", () => {
    const reach = Math.min(layout.width, layout.height);
    for (const i of [0, 1, 2, 100, 899]) {
      const [dx, dy] = swirlDirection(i);
      const length = Math.hypot(
        set.swirlForm[2 * i]!,
        set.swirlForm[2 * i + 1]!,
      );
      expect(set.swirlForm[2 * i]! / length).toBeCloseTo(dx, 4);
      expect(set.swirlForm[2 * i + 1]! / length).toBeCloseTo(dy, 4);
      expect(length).toBeLessThanOrEqual(0.25 * reach);
      expect(length).toBeGreaterThan(0.03 * reach);
    }
  });

  it("the same seed gives the same particles, another seed other swirls", () => {
    const again = buildParticleSet(pairing, layout, 5);
    expect(Array.from(again.swirlForm)).toEqual(Array.from(set.swirlForm));
    expect(Array.from(again.hand)).toEqual(Array.from(set.hand));
    const other = buildParticleSet(pairing, layout, 6);
    expect(Array.from(other.swirlForm)).not.toEqual(Array.from(set.swirlForm));
    // The resting positions do not depend on the seed: only the swing does.
    expect(Array.from(other.mouse)).toEqual(Array.from(set.mouse));
    expect(Array.from(at(0.2).xy)).toEqual(Array.from(at(0.2).xy));
  });

  it("scrolling back retraces the same positions", () => {
    const down = [0.05, 0.2, 0.5, 0.65, 0.8].map((p) => Array.from(at(p).xy));
    const up = [0.8, 0.65, 0.5, 0.2, 0.05]
      .map((p) => Array.from(at(p).xy))
      .reverse();
    expect(up).toEqual(down);
  });

  it("the cloud opens up on the way: mid-way, particles are away from the straight line between the two states", () => {
    const { xy } = at(0.19);
    let off = 0;
    for (let i = 0; i < set.count; i += 1) {
      const e = 0.5; // 0.19 / 0.38
      const lineX =
        set.logo[2 * i]! + (set.hand[2 * i]! - set.logo[2 * i]!) * e;
      const lineY =
        set.logo[2 * i + 1]! +
        (set.hand[2 * i + 1]! - set.logo[2 * i + 1]!) * e;
      off += Math.hypot(xy[2 * i]! - lineX, xy[2 * i + 1]! - lineY);
    }
    // The mean swing is a good share of the canvas's reach: they have scattered.
    expect(off / set.count).toBeGreaterThan(0.08 * 350);
  });

  it("every particle starts and ends in the budget's count of three equal mouse groups", () => {
    const counts = [0, 0, 0];
    for (const s of pairing.slot) counts[s] = counts[s]! + 1;
    expect(counts).toEqual([300, 300, 300]);
  });
});
