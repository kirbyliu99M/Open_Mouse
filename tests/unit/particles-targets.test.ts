import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_PATHS,
  SKETCH_DIR,
  buildArtifacts,
} from "@/lib/particles/artifacts";
import { type Vec, distance } from "@/lib/particles/geometry";
import { LOGO_BOX, logoStrokes } from "@/lib/particles/logo";
import { parseSketchSvg } from "@/lib/particles/svg-path";
import { renderHandSvg, renderLogoSvg } from "@/lib/particles/static-svg";
import {
  HAND_FILL_COUNT,
  SAMPLING,
  STAGE_WIDTH,
  buildHand,
  buildTargets,
  isMouseSketch,
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

const mouseSketches = Object.keys(sketches).filter(isMouseSketch);

describe("the mouse sketches", () => {
  it("has at least the G Pro sketch, in public/images/sketches/", () => {
    expect(Object.keys(sketches)).toContain("g-pro-sketch");
  });

  it("maps the two stroke colours to bright and dim, and refuses any other", () => {
    expect(toneOfStroke("#CFE0FF")).toBe(1);
    expect(toneOfStroke("#6e9bf5")).toBe(0);
    expect(() => toneOfStroke("#256AF0")).toThrow(/neither/);
  });

  it("are every drawing in the folder but the finale's hand on a mouse", () => {
    expect(Object.keys(sketches)).toContain("finale-grip");
    expect(mouseSketches).not.toContain("finale-grip");
    expect(mouseSketches).toHaveLength(Object.keys(sketches).length - 1);
  });

  describe.each(mouseSketches)("%s", (name) => {
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

describe("the placeholder logo", () => {
  const target = sampleLogo();
  const strokes = logoStrokes();

  it("is the spec's geometry in a 220 x 196 box centred on (90, 98)", () => {
    const { cx, cy } = LOGO_BOX;
    expect([LOGO_BOX.width, LOGO_BOX.height, cx, cy]).toEqual([
      220, 196, 90, 98,
    ]);
    const [outline, split, wheel, ruler] = strokes;
    // x = cx + 58·(0.86 − 0.14·cos t)·sin t, y = cy − 88·cos t: the top and
    // bottom of the shell are the points at t = 0 and t = π.
    expect(outline!.polyline.points[0]).toEqual([cx, cy - 88]);
    const ys = outline!.polyline.points.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(cy - 88, 9);
    expect(Math.max(...ys)).toBeCloseTo(cy + 88, 1);
    // Widest at 58 · 0.86 = 49.9 either side (the −0.14·cos t term moves it a little).
    const xs = outline!.polyline.points.map((p) => p[0]);
    expect(Math.max(...xs) - cx).toBeGreaterThan(48);
    expect(Math.max(...xs) - cx).toBeLessThan(58);
    expect(split!.polyline.points).toEqual([
      [cx, cy - 88],
      [cx, cy - 22],
    ]);
    expect(Math.min(...wheel!.polyline.points.map((p) => p[0]))).toBeCloseTo(
      cx - 4.5,
      9,
    );
    expect(Math.max(...wheel!.polyline.points.map((p) => p[1]))).toBeCloseTo(
      cy - 56 + 9,
      1,
    );
    expect(ruler!.polyline.points).toEqual([
      [cx + 84, cy - 88],
      [cx + 84, cy + 88],
    ]);
    // End ticks: 5 px each side, at both ends of the ruler.
    const ticks = strokes.slice(4);
    expect(ticks).toHaveLength(2);
    for (const tick of ticks) {
      const [a, b] = tick.polyline.points;
      expect(distance(a!, b!)).toBe(10);
      expect(a![1]).toBe(b![1]);
    }
  });

  it("lands every point on the logo, and the ruler's ends are sampled", () => {
    const polylines = strokes.map((s) => s.polyline);
    for (const p of target.points) {
      expect(distanceToPolylines([p.x, p.y], polylines)).toBeLessThan(1e-6);
    }
    for (const end of [
      [LOGO_BOX.cx + 84, LOGO_BOX.cy - 88],
      [LOGO_BOX.cx + 84, LOGO_BOX.cy + 88],
    ] as Vec[]) {
      expect(target.points.some((p) => distance([p.x, p.y], end) < 1e-9)).toBe(
        true,
      );
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
    expect(Object.keys(parsed.mice)).toEqual([...mouseSketches].sort());
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
    for (const svg of [renderHandSvg(targets.hand), renderLogoSvg()]) {
      expect(svg).not.toContain("var(");
      expect(svg).toMatch(/#CFE0FF/);
      expect(svg).toMatch(/#6E9BF5/);
    }
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
