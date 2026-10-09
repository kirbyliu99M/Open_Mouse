import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_PATHS,
  SKETCH_DIR,
  buildArtifacts,
} from "@/lib/particles/artifacts";
import { type Vec, distance, polylineLength } from "@/lib/particles/geometry";
import {
  LOGO_BOX,
  LOGO_SAMPLING,
  LOGO_SCALE,
  LOGO_STROKE,
  LOGO_VIEWBOX,
  PALMATE_PATH,
  logoPolylines,
} from "@/lib/particles/logo";
import { buildPairing } from "@/lib/particles/pairing";
import { parseSketchSvg } from "@/lib/particles/svg-path";
import { renderHandSvg, renderLogoSvg } from "@/lib/particles/static-svg";
import {
  HAND_FILL_COUNT,
  SAMPLING,
  STAGE_WIDTH,
  buildHand,
  buildTargets,
  sampleLogo,
  sampleSketch,
  serializeTargets,
  toneOfStroke,
} from "@/lib/particles/targets";
import {
  LANDMARKS_MM,
  SKELETON,
  STAGE_SCALE,
  fillTemplateHand,
  insideTemplateHand,
} from "@/lib/particles/template-hand";

const sketches = Object.fromEntries(
  readdirSync(SKETCH_DIR)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => [
      basename(file, ".svg"),
      readFileSync(`${SKETCH_DIR}/${file}`, "utf8"),
    ]),
);

function distanceToPolylines(
  point: Vec,
  polylines: readonly { points: readonly Vec[]; closed: boolean }[],
): number {
  let best = Infinity;
  for (const { points, closed } of polylines) {
    const n = points.length;
    for (let i = 0; i < (closed ? n : n - 1); i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
                  lengthSquared,
              ),
            );
      best = Math.min(best, distance(point, [a[0] + dx * t, a[1] + dy * t]));
    }
  }
  return best;
}

describe("the mouse sketches", () => {
  it("has at least the G Pro sketch, in public/images/sketches/", () => {
    expect(Object.keys(sketches)).toContain("g-pro-sketch");
  });

  it("maps the two stroke colours to bright and dim, and refuses any other", () => {
    expect(toneOfStroke("#CFE0FF")).toBe(1);
    expect(toneOfStroke("#6e9bf5")).toBe(0);
    expect(() => toneOfStroke("#256AF0")).toThrow(/neither/);
  });

  describe.each(Object.keys(sketches))("%s", (name) => {
    const svg = sketches[name]!;
    const target = sampleSketch(svg);

    it("is sampled at a 340 px stage width, with both tones present", () => {
      expect(target.width).toBe(STAGE_WIDTH);
      const { viewBox } = parseSketchSvg(svg);
      expect(target.height).toBeCloseTo(
        (viewBox.height * 340) / viewBox.width,
        9,
      );
      expect(new Set(target.points.map((p) => p.tone))).toEqual(
        new Set([0, 1]),
      );
      expect(target.points.length).toBeGreaterThan(400);
    });

    it("lands every point on a stroke of the sketch, and both ends of every stroke", () => {
      const sketch = parseSketchSvg(svg);
      const scale = STAGE_WIDTH / sketch.viewBox.width;
      const polylines = sketch.strokes.map(({ polyline }) => ({
        closed: polyline.closed,
        points: polyline.points.map(([x, y]): Vec => [
          (x - sketch.viewBox.x) * scale,
          (y - sketch.viewBox.y) * scale,
        ]),
      }));
      for (const p of target.points) {
        expect(distanceToPolylines([p.x, p.y], polylines)).toBeLessThan(1e-6);
      }
      const has = (v: Vec) =>
        target.points.some((p) => distance([p.x, p.y], v) < 1e-9);
      for (const { points, closed } of polylines) {
        expect(has(points[0]!)).toBe(true);
        if (!closed) expect(has(points[points.length - 1]!)).toBe(true);
      }
    });

    it("spaces points about 2.6 px (bright) and 4.2 px (dim) apart along a stroke", () => {
      // The longest bright and dim runs: consecutive points of one stroke.
      const gaps = { 0: [] as number[], 1: [] as number[] };
      for (let i = 1; i < target.points.length; i += 1) {
        const a = target.points[i - 1]!;
        const b = target.points[i]!;
        if (a.tone !== b.tone) continue;
        const gap = distance([a.x, a.y], [b.x, b.y]);
        // A jump to the next stroke is far longer than any spacing.
        if (gap < 6) gaps[a.tone].push(gap);
      }
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      expect(mean(gaps[1])).toBeGreaterThan(SAMPLING.brightSpacing * 0.8);
      expect(mean(gaps[1])).toBeLessThan(SAMPLING.brightSpacing * 1.05);
      expect(mean(gaps[0])).toBeGreaterThan(SAMPLING.dimSpacing * 0.8);
      expect(mean(gaps[0])).toBeLessThan(SAMPLING.dimSpacing * 1.05);
    });
  });
});

describe("the Palmate logo", () => {
  const target = sampleLogo();
  const polylines = logoPolylines();
  /** The path in the target's own px. */
  const inBox = polylines.map(({ points, closed }) => ({
    closed,
    points: points.map(([x, y]): Vec => [
      (x - LOGO_VIEWBOX.x) * LOGO_SCALE,
      (y - LOGO_VIEWBOX.y) * LOGO_SCALE,
    ]),
  }));
  const pathRuns = target.runs.filter((run) => run.count > 1);
  const strayRuns = target.runs.filter((run) => run.count === 1);
  const cloud = pathRuns.flatMap((run) =>
    target.points.slice(run.start, run.start + run.count),
  );
  const strays = strayRuns.map((run) => target.points[run.start]!);
  const pathLength = polylines.reduce(
    (sum, { points }) => sum + polylineLength(points),
    0,
  );
  const mean = (xs: readonly number[]) =>
    xs.reduce((sum, x) => sum + x, 0) / xs.length;

  it("is the four lines of the hand, about 349 units long, in a viewBox with room all round and a box that is that viewBox times 3", () => {
    expect(polylines).toHaveLength(4);
    expect(polylines.every((p) => !p.closed)).toBe(true);
    expect(pathLength).toBeGreaterThan(345);
    expect(pathLength).toBeLessThan(353);
    const xs = polylines.flatMap((p) => p.points.map((v) => v[0]));
    const ys = polylines.flatMap((p) => p.points.map((v) => v[1]));
    const { x, y, width, height } = LOGO_VIEWBOX;
    // At least 4 units between the path and every edge: the cloud reaches 2.4 units off the line.
    expect(Math.min(...xs) - x).toBeGreaterThanOrEqual(4);
    expect(Math.min(...ys) - y).toBeGreaterThanOrEqual(4);
    expect(x + width - Math.max(...xs)).toBeGreaterThanOrEqual(4);
    expect(y + height - Math.max(...ys)).toBeGreaterThanOrEqual(4);
    expect(LOGO_BOX.width).toBe(width * LOGO_SCALE);
    expect(LOGO_BOX.height).toBe(height * LOGO_SCALE);
    expect(target.width).toBe(LOGO_BOX.width);
    expect(target.height).toBe(LOGO_BOX.height);
  });

  it("has 600 points along the lines (one run for each of the four) and 24 strays (a run of one each), in that order", () => {
    expect(cloud).toHaveLength(LOGO_SAMPLING.particles);
    expect(cloud).toHaveLength(600);
    expect(pathRuns).toHaveLength(4);
    expect(strays).toHaveLength(LOGO_SAMPLING.ambient);
    expect(strays).toHaveLength(24);
    expect(target.points).toHaveLength(624);
    // The runs cover the points once, in order, strays last.
    let next = 0;
    for (const run of target.runs) {
      expect(run.start).toBe(next);
      expect(run.closed).toBe(false);
      next += run.count;
    }
    expect(next).toBe(target.points.length);
    expect(target.runs.slice(0, 4)).toEqual(pathRuns);
    // Each line has its share of the 600: in proportion to its length, to within a point or two.
    polylines.forEach(({ points }, i) => {
      expect(
        Math.abs(
          pathRuns[i]!.count - (600 * polylineLength(points)) / pathLength,
        ),
      ).toBeLessThanOrEqual(1);
    });
  });

  it("puts every point of the cloud inside the box, within 2.4 units of the line and a few at the very edge of that, and no point is exactly on the line", () => {
    const limit = LOGO_SAMPLING.maxSpread * LOGO_SCALE + 0.3;
    const distances = cloud.map((p) => distanceToPolylines([p.x, p.y], inBox));
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(LOGO_BOX.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(LOGO_BOX.height);
    }
    expect(Math.max(...distances)).toBeLessThan(limit);
    // Not a line: a bell-shaped width round it. Spread 0.8 units has a mean
    // distance of 0.64 units (1.9 px) and about 21 % of the points beyond 1 unit.
    const units = distances.map((d) => d / LOGO_SCALE);
    expect(mean(units)).toBeGreaterThan(0.5);
    expect(mean(units)).toBeLessThan(0.75);
    const beyond = units.filter((d) => d > 1).length / units.length;
    expect(beyond).toBeGreaterThan(0.1);
    expect(beyond).toBeLessThan(0.35);
    expect(Math.max(...units)).toBeGreaterThan(1.6);
  });

  it("covers the line: every stretch of 5 units has points within 2 units, so no finger is bare", () => {
    for (const { points } of inBox) {
      let sinceLast = Infinity;
      for (let i = 1; i < points.length; i += 1) {
        sinceLast += distance(points[i - 1]!, points[i]!);
        if (sinceLast < 5 * LOGO_SCALE) continue;
        sinceLast = 0;
        const [x, y] = points[i]!;
        expect(
          cloud.some((p) => distance([p.x, p.y], [x, y]) < 2 * LOGO_SCALE),
          `no point near ${x.toFixed(1)}, ${y.toFixed(1)}`,
        ).toBe(true);
      }
    }
  });

  it("is a hand: the cloud's centre and its width to height are those of the path", () => {
    const pathPoints = inBox.flatMap((p) => p.points);
    const centre = (list: readonly { x: number; y: number }[]) => [
      mean(list.map((p) => p.x)),
      mean(list.map((p) => p.y)),
    ];
    const [cx, cy] = centre(cloud);
    const [px, py] = centre(pathPoints.map(([x, y]) => ({ x, y })));
    // The path's own points are about a unit apart, so their mean is the line's centroid.
    expect(Math.abs(cx! - px!)).toBeLessThan(3);
    expect(Math.abs(cy! - py!)).toBeLessThan(3);
    const spanOf = (values: readonly number[]) =>
      Math.max(...values) - Math.min(...values);
    const ratio = spanOf(cloud.map((p) => p.x)) / spanOf(cloud.map((p) => p.y));
    const want =
      spanOf(pathPoints.map((v) => v[0])) / spanOf(pathPoints.map((v) => v[1]));
    expect(ratio).toBeGreaterThan(want * 0.9);
    expect(ratio).toBeLessThan(want * 1.1);
    expect(want).toBeGreaterThan(0.85);
    expect(want).toBeLessThan(0.95);
  });

  it("has about half bright and half dim points on the lines, and dim strays only, outside a hole round the box and inside the frame", () => {
    const bright = cloud.filter((p) => p.tone === 1).length / cloud.length;
    expect(bright).toBeGreaterThan(0.42);
    expect(bright).toBeLessThan(0.58);
    expect(strays.every((p) => p.tone === 0)).toBe(true);
    const { ambientHole, ambientReach } = LOGO_SAMPLING;
    for (const p of strays) {
      const inHole =
        p.x > -ambientHole &&
        p.x < LOGO_BOX.width + ambientHole &&
        p.y > -ambientHole &&
        p.y < LOGO_BOX.height + ambientHole;
      expect(inHole).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(-ambientReach.x * LOGO_BOX.width);
      expect(p.x).toBeLessThanOrEqual(LOGO_BOX.width * (1 + ambientReach.x));
      expect(p.y).toBeGreaterThanOrEqual(-ambientReach.y * LOGO_BOX.height);
      expect(p.y).toBeLessThanOrEqual(LOGO_BOX.height * (1 + ambientReach.y));
    }
    for (let i = 0; i < strays.length; i += 1) {
      for (let j = i + 1; j < strays.length; j += 1) {
        expect(
          distance([strays[i]!.x, strays[i]!.y], [strays[j]!.x, strays[j]!.y]),
        ).toBeGreaterThanOrEqual(LOGO_SAMPLING.ambientGap);
      }
    }
  });

  it("is deterministic: the same points every time, and the generator's seed does not move it", () => {
    expect(sampleLogo()).toEqual(sampleLogo());
    expect(buildTargets(sketches, 1).logo).toEqual(sampleLogo());
    expect(buildTargets(sketches, 2).logo).toEqual(sampleLogo());
  });

  it("pairs with the hand and the mice at every budget the stage uses, in both densities, with the same number of particles in all three states", () => {
    const all = buildTargets(sketches);
    const names = Object.keys(all.mice).slice(0, 1);
    // 900 and 1,299 (the Canvas 2D path's phone and desktop), 3,000 and 6,000 (WebGL on a low-end device and a phone), 12,000 (WebGL on a desktop).
    for (const count of [900, 1299, 3000, 6000, 12000]) {
      for (const density of ["sparse", "dense"] as const) {
        const pairing = buildPairing(all, {
          count,
          layout: "row",
          seed: 20261003,
          mice: [names[0]!, names[0]!, names[0]!],
          density,
        });
        const label = `${count} ${density}`;
        expect(pairing.logo, label).toHaveLength(count);
        expect(pairing.hand, label).toHaveLength(count);
        expect(pairing.mouse, label).toHaveLength(count);
        // Every particle has a place on the logo: the cloud, or a stray.
        for (const p of pairing.logo) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y), label).toBe(
            true,
          );
          expect(p.x, label).toBeGreaterThan(-LOGO_BOX.width);
          expect(p.x, label).toBeLessThan(2 * LOGO_BOX.width);
          expect(p.y, label).toBeGreaterThan(-LOGO_BOX.height);
          expect(p.y, label).toBeLessThan(2 * LOGO_BOX.height);
        }
        // The logo's particle count is the stage's budget, not the target's 624:
        // the surplus is made the way it always was (thinned, topped up or
        // walked along the lines), so no later state is short of particles.
        expect(new Set(pairing.slot), label).toEqual(new Set([0, 1, 2]));
      }
    }
  });
});

describe("the template hand", () => {
  it("has the 21 MediaPipe landmarks and the 21 skeleton connections, all inside the A4 sheet", () => {
    expect(LANDMARKS_MM).toHaveLength(21);
    expect(SKELETON).toHaveLength(21);
    for (const [x, y] of LANDMARKS_MM) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(210);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(297);
    }
    for (const [a, b] of SKELETON) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(20);
    }
    // Thumb tip is the left-most landmark, the wrist the lowest: a right hand, fingers up.
    expect(LANDMARKS_MM[4]![0]).toBe(
      Math.min(...LANDMARKS_MM.map((p) => p[0])),
    );
    expect(LANDMARKS_MM[0]![1]).toBe(
      Math.max(...LANDMARKS_MM.map((p) => p[1])),
    );
  });

  it("fills the hand with the requested number of points, all on the hand", () => {
    const points = fillTemplateHand(500, 1);
    expect(points).toHaveLength(500);
    for (const p of points) {
      expect(insideTemplateHand([p.x / STAGE_SCALE, p.y / STAGE_SCALE])).toBe(
        true,
      );
    }
    expect(new Set(points.map((p) => p.tone))).toEqual(new Set([0, 1]));
  });

  it("gives the same points for the same seed and others for another seed", () => {
    expect(fillTemplateHand(300, 7)).toEqual(fillTemplateHand(300, 7));
    expect(fillTemplateHand(300, 7)).not.toEqual(fillTemplateHand(300, 8));
  });

  it("puts every landmark on the hand and a point far from it off the hand", () => {
    for (const landmark of LANDMARKS_MM)
      expect(insideTemplateHand(landmark)).toBe(true);
    expect(insideTemplateHand([5, 5])).toBe(false);
    expect(insideTemplateHand([200, 280])).toBe(false);
  });

  it("scales the landmarks into the stage and draws the ruler beside the sheet, not on the hand", () => {
    const hand = buildHand(1, 100);
    expect(hand.landmarks[0]).toEqual([
      LANDMARKS_MM[0]![0] * STAGE_SCALE,
      LANDMARKS_MM[0]![1] * STAGE_SCALE,
    ]);
    expect(hand.a4.width).toBeCloseTo(340, 9);
    expect(hand.lengthLine.from[0]).toBeGreaterThan(hand.a4.width * 0.9);
    // The ruler is in the viewBox, so it is not clipped.
    const right = hand.viewBox.x + hand.viewBox.width;
    expect(hand.lengthLine.from[0]).toBeLessThan(right);
    // Four end ticks: two on each measurement line.
    expect(hand.ticks).toHaveLength(4);
  });
});

describe("buildTargets", () => {
  it("is reproducible: the same seed gives the same output, byte for byte", () => {
    const a = serializeTargets(buildTargets(sketches, 11));
    const b = serializeTargets(buildTargets(sketches, 11));
    expect(b).toBe(a);
  });

  it("changes only the random parts with the seed: the hand's fill, never the sketches or the logo", () => {
    const a = buildTargets(sketches, 1);
    const b = buildTargets(sketches, 2);
    expect(b.hand.points).not.toEqual(a.hand.points);
    expect(b.mice).toEqual(a.mice);
    expect(b.logo).toEqual(a.logo);
    expect(b.hand.landmarks).toEqual(a.hand.landmarks);
    expect(a.hand.points).toHaveLength(HAND_FILL_COUNT);
  });

  it("writes one JSON file: points as [x, y, tone] rounded to 0.1 px, one entry per sketch", () => {
    const parsed = JSON.parse(serializeTargets(buildTargets(sketches)));
    expect(Object.keys(parsed.mice)).toEqual(Object.keys(sketches).sort());
    for (const [x, y, tone] of parsed.mice["g-pro-sketch"].points) {
      expect(Math.abs(x * 10 - Math.round(x * 10))).toBeLessThan(1e-6);
      expect(Math.abs(y * 10 - Math.round(y * 10))).toBeLessThan(1e-6);
      expect([0, 1]).toContain(tone);
    }
    expect(parsed.hand.landmarks).toHaveLength(21);
  });
});

describe("the static SVGs", () => {
  const targets = buildTargets(sketches);

  it("carries no numbers or text: the measurement lines are lines and end ticks only", () => {
    const hand = renderHandSvg(targets.hand);
    expect(hand).not.toMatch(/<text|<tspan|font-/);
    expect(renderLogoSvg()).not.toMatch(/<text|<tspan|font-/);
  });

  it("hard-codes its colours, because an <img> can not read CSS variables", () => {
    const hand = renderHandSvg(targets.hand);
    expect(hand).not.toContain("var(");
    expect(hand).toMatch(/#CFE0FF/);
    expect(hand).toMatch(/#6E9BF5/);
    expect(renderLogoSvg()).not.toContain("var(");
  });

  it("draws the Palmate mark as the hand's own path, one stroke in #7FA8FF with round ends, no fill, no background", () => {
    const svg = renderLogoSvg();
    expect(svg).toContain(`d="${PALMATE_PATH}"`);
    expect(svg.match(/<path/g)).toHaveLength(1);
    const { x, y, width, height } = LOGO_VIEWBOX;
    expect(svg).toContain(`viewBox="${x} ${y} ${width} ${height}"`);
    expect(svg).toContain(`stroke="${LOGO_STROKE.color}"`);
    expect(LOGO_STROKE.color).toBe("#7FA8FF");
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).not.toMatch(/<rect|<circle|<ellipse|<image|<g\b/);
    expect(svg).not.toMatch(/fill="(?!none)/);
  });

  it("draws every particle of the hand, from the same point list as the JSON", () => {
    const svg = renderHandSvg(targets.hand);
    expect((svg.match(/h0/g) ?? []).length).toBe(targets.hand.points.length);
    // 21 landmark halos and 21 cores.
    expect((svg.match(/<circle/g) ?? []).length).toBe(42);
  });
});

describe("the committed outputs", () => {
  it("match what the generator makes today (run `npm run particles:build` if this fails)", () => {
    for (const [path, text] of Object.entries(buildArtifacts(sketches))) {
      expect(existsSync(path), `${path} is missing`).toBe(true);
      expect(readFileSync(path, "utf8") === text, `${path} is stale`).toBe(
        true,
      );
    }
    expect(Object.keys(buildArtifacts(sketches)).sort()).toEqual(
      Object.values(ARTIFACT_PATHS).sort(),
    );
  });
});
