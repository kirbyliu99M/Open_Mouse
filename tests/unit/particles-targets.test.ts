import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_PATHS,
  SKETCH_DIR,
  buildArtifacts,
} from "@/lib/particles/artifacts";
import { type Vec, distance, polylineLength } from "@/lib/particles/geometry";
import { densifyStrokes, shareOut } from "@/lib/particles/dense";
import { fillTemplateHand, insideHandFill } from "@/lib/particles/hand-fill";
import {
  LOGO_BOX,
  LOGO_PAGE,
  LOGO_SAMPLING,
  LOGO_SCALE,
  LOGO_STROKE,
  LOGO_VIEWBOX,
  PALMATE_DOT,
  PALMATE_PATH,
  bellQuantile,
  inLogoMark,
  logoPolylines,
  strayReach,
} from "@/lib/particles/logo";
import { LOOK_LIMITS, STAR_SIZE } from "@/lib/particles/look";
import { buildPairing } from "@/lib/particles/pairing";
import { pairingTables } from "@/lib/particles/particle-set";
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
  // The runs, in order: the four lines, the dot's points, the strays.
  const pathRuns = target.runs.slice(0, 4);
  const dotCount = LOGO_SAMPLING.dotCore + LOGO_SAMPLING.dotRing;
  const dotRuns = target.runs.slice(4, 4 + dotCount);
  const strayRuns = target.runs.slice(4 + dotCount);
  const cloud = pathRuns.flatMap((run) =>
    target.points.slice(run.start, run.start + run.count),
  );
  const dot = dotRuns.map((run) => target.points[run.start]!);
  const strays = strayRuns.map((run) => target.points[run.start]!);
  /** A target point back in the path's viewBox units. */
  const toUnits = (p: { x: number; y: number }): Vec => [
    p.x / LOGO_SCALE + LOGO_VIEWBOX.x,
    p.y / LOGO_SCALE + LOGO_VIEWBOX.y,
  ];
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

  it("has 840 points along the lines (one run for each of the four), 9 in the dot and 24 strays (a run of one each), in that order", () => {
    expect(cloud).toHaveLength(LOGO_SAMPLING.particles);
    // 840: Kirby's second call for a denser mark (2026-10-10; it was 600).
    expect(cloud).toHaveLength(840);
    expect(pathRuns.every((run) => run.count > 1)).toBe(true);
    expect(dotRuns).toHaveLength(9);
    expect(dotRuns.every((run) => run.count === 1)).toBe(true);
    expect(strays).toHaveLength(LOGO_SAMPLING.ambient);
    expect(strays).toHaveLength(24);
    expect(strayRuns.every((run) => run.count === 1)).toBe(true);
    expect(target.points).toHaveLength(873);
    // The runs cover the points once, in order, strays last.
    let next = 0;
    for (const run of target.runs) {
      expect(run.start).toBe(next);
      expect(run.closed).toBe(false);
      next += run.count;
    }
    expect(next).toBe(target.points.length);
    // Each line has its share of the 840: in proportion to its length, to within a point or two.
    polylines.forEach(({ points }, i) => {
      expect(
        Math.abs(
          pathRuns[i]!.count - (840 * polylineLength(points)) / pathLength,
        ),
      ).toBeLessThanOrEqual(1);
    });
  });

  it("puts every point of the cloud inside the box, within 1.6 units of the line and a few at the very edge of that, and no point is exactly on the line", () => {
    const limit = LOGO_SAMPLING.maxSpread * LOGO_SCALE + 0.3;
    const distances = cloud.map((p) => distanceToPolylines([p.x, p.y], inBox));
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(LOGO_BOX.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(LOGO_BOX.height);
    }
    expect(Math.max(...distances)).toBeLessThan(limit);
    // Not a line: a bell-shaped width round it. The swelling bell has a mean
    // distance of 0.398 units (1.2 px) and 5.5 % of the points beyond 1 unit
    // (the bounds are those of the test below, a little lower at the bottom:
    // the nearest line of any of the four can only be nearer than a point's
    // own).
    const units = distances.map((d) => d / LOGO_SCALE);
    expect(mean(units)).toBeGreaterThan(0.34);
    expect(mean(units)).toBeLessThan(0.436);
    const beyond = units.filter((d) => d > 1).length / units.length;
    expect(beyond).toBeGreaterThan(0.022);
    expect(beyond).toBeLessThan(0.083);
    expect(Math.max(...units)).toBeGreaterThan(1.3);
  });

  /**
   * Each cloud point placed against its own line (in viewBox units): how far
   * along the line its foot is, and its distance across, signed (+ on the
   * left of the way the line is drawn). The expected values below come from
   * the sampling's description, not from what the code made: a bell clipped
   * at 1.6 whose standard deviation is 0.5 x (1 + 0.3 sin(2 pi u / 24 +
   * 1.7 line)) at u units along a line (worked out over the sine's phase):
   * the mean distance is 0.398, the share beyond 1 unit 0.055 and the
   * standard deviation 0.508; over 840 points random draws would have
   * standard errors of 0.011, 0.008 and 0.012, and each bound is about 3.5
   * of them either side (the low-discrepancy order lands much nearer). (An
   * even bell of 0.5 had 0.399, 0.046 and 0.500; the first cut, 0.8 clipped
   * at 2.4 over 600 points, 0.638, 0.211 and 0.795.)
   */
  const placed = pathRuns.map((run, w) =>
    target.points.slice(run.start, run.start + run.count).map((p) => {
      const line = inBox[w]!.points;
      let best = Infinity;
      let along = 0;
      let across = 0;
      let walked = 0;
      for (let i = 1; i < line.length; i += 1) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const length = Math.hypot(dx, dy);
        const t =
          length === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (length * length),
                ),
              );
        const gap = distance([p.x, p.y], [a[0] + dx * t, a[1] + dy * t]);
        if (gap < best) {
          best = gap;
          along = walked + t * length;
          const side = dx * (p.y - a[1]) - dy * (p.x - a[0]);
          across = side < 0 ? -gap : gap;
        }
        walked += length;
      }
      return {
        along: along / LOGO_SCALE,
        across: across / LOGO_SCALE,
        tone: p.tone,
      };
    }),
  );
  /** The even step between places on each line, in units, as the sampling describes it: the line's length over its count of places. */
  const steps = pathRuns.map((run, w) => {
    const places = Math.round(run.count / (1 + 0.26));
    return polylineLength(inBox[w]!.points) / LOGO_SCALE / places;
  });

  it("spreads the points across the line as a bell about 0.5 units wide, both sides alike, clipped at 1.6 units", () => {
    const across = placed.flat().map((p) => p.across);
    const centre = mean(across);
    const sd = Math.sqrt(mean(across.map((a) => (a - centre) ** 2)));
    const size = across.map(Math.abs);
    // Both sides alike: the signed mean is 0 (standard error 0.018).
    expect(Math.abs(centre)).toBeLessThan(0.061);
    expect(sd).toBeGreaterThan(0.465);
    expect(sd).toBeLessThan(0.552);
    expect(mean(size)).toBeGreaterThan(0.36);
    expect(mean(size)).toBeLessThan(0.436);
    const beyond = size.filter((d) => d > 1).length / size.length;
    expect(beyond).toBeGreaterThan(0.027);
    expect(beyond).toBeLessThan(0.083);
    // The tail reaches the clip. Over the swelling bell a point is past 1.55
    // units with a chance of 0.0053, so 840 of them have 4.4 there on
    // average (random draws would leave none 1.2 % of the time); the golden
    // order has no draw to miss with: it spreads the tail's levels evenly, and
    // 5 are past 1.55. A clip of 1.5 or 1.4 leaves none. Nothing is past 1.6.
    expect(Math.max(...size)).toBeGreaterThanOrEqual(1.55);
    expect(Math.max(...size)).toBeLessThanOrEqual(1.6 + 0.05);
  });

  it("lights about half the points in every stretch of the line, not whole stretches bright or dim", () => {
    // Stretches of 10 units, about 24 points each. With each point bright at
    // a half chance, a stretch is outside 25 % to 75 % bright 0.7 % of the
    // time and all one tone almost never (1 in 8 million).
    let stretches = 0;
    let even = 0;
    for (const line of placed) {
      const end = Math.max(...line.map((p) => p.along));
      for (let from = 0; from + 10 <= end; from += 10) {
        const inside = line.filter(
          (p) => p.along >= from && p.along < from + 10,
        );
        if (inside.length < 10) continue;
        stretches += 1;
        const bright =
          inside.filter((p) => p.tone === 1).length / inside.length;
        expect(bright, `a stretch from ${from} units`).toBeGreaterThan(0);
        expect(bright, `a stretch from ${from} units`).toBeLessThan(1);
        if (bright >= 0.25 && bright <= 0.75) even += 1;
      }
    }
    expect(stretches).toBeGreaterThanOrEqual(30);
    expect(even / stretches).toBeGreaterThanOrEqual(0.9);
  });

  it("walks each line in order, a place an even step apart, about a quarter of the places with two points a half step apart", () => {
    let half = 0;
    placed.forEach((line, w) => {
      const step = steps[w]!;
      // The places are about 0.52 units apart (349 units over 667 places).
      expect(step).toBeGreaterThan(0.49);
      expect(step).toBeLessThan(0.56);
      for (let i = 1; i < line.length; i += 1) {
        const move = (line[i]!.along - line[i - 1]!.along) / step;
        // The next point is at most two steps on and at most one step back.
        // A tight bend stretches or squeezes the along-the-line distance by
        // the point's distance across over the bend's radius, which half a
        // step allows for.
        expect(move, `line ${w}, point ${i}`).toBeLessThanOrEqual(2.5);
        expect(move, `line ${w}, point ${i}`).toBeGreaterThanOrEqual(-1.5);
        if (move >= 0.25 && move <= 0.62) half += 1;
      }
    });
    // A place's two points sit at a quarter and three quarters of its step,
    // each moved by up to a tenth of it: the move from the first to the
    // second is 0.5 step plus the difference of two jitters (a triangle on
    // -0.2 to 0.2), so it is 0.25 to 0.62 steps with a chance of
    // 1 - 0.08^2 / (2 x 0.04) = 0.92. The same holds from the second point of
    // a pair to the first of the next when the next place is doubled too,
    // which the shuffle makes 43.9 times (173 doubled places of 667, by line:
    // 91 x 90 / 352 + 31 x 30 / 121 + 27 x 26 / 104 + 24 x 23 / 90). Every
    // other move is 0.65 steps or more. So about 0.92 x (173 + 43.9) = 200
    // moves (standard deviation about 8: the adjacencies vary by about 6.6,
    // the jitters by 4); the bound is 3.5 of those either side. Points placed
    // anywhere in their step (the earlier sampling) give about 75, one point
    // a place none.
    expect(half).toBeGreaterThanOrEqual(172);
    expect(half).toBeLessThanOrEqual(228);
  });

  it("jitters a pair's two points by a tenth of a step each: the half-step moves spread by 0.08 of a step", () => {
    // The moves of 0.2 to 0.65 steps are a pair's (and a pair's into the next
    // pair): 0.5 plus the difference of two jitters uniform on -0.1 to 0.1
    // (a triangle; standard deviation 0.2 / sqrt(6) = 0.082, 0.077 inside
    // the window). Placing a point on its line and back adds some along-the-
    // line noise at the bends: 0.029 of a step, measured with no jitter.
    // Together sqrt(0.077^2 + 0.029^2) = 0.082. Over about 210 moves the
    // standard deviation's own error is about 0.003 (a triangle's tails are
    // light), and the bounds are a little over 4 of those either side.
    // Measured 0.080; no jitter gives 0.029, 0.05 gives 0.050, 0.2 gives
    // 0.123.
    const moves: number[] = [];
    placed.forEach((line, w) => {
      for (let i = 1; i < line.length; i += 1) {
        const move = (line[i]!.along - line[i - 1]!.along) / steps[w]!;
        if (move >= 0.2 && move < 0.65) moves.push(move);
      }
    });
    expect(moves.length).toBeGreaterThan(180);
    const m = mean(moves);
    const sd = Math.sqrt(mean(moves.map((v) => (v - m) ** 2)));
    expect(Math.abs(m - 0.5)).toBeLessThan(0.03);
    expect(sd).toBeGreaterThan(0.068);
    expect(sd).toBeLessThan(0.096);
  });

  it("bellQuantile is the bell's quantile: the published values, to 1e-8, and symmetric", () => {
    const known: [number, number][] = [
      [0.5, 0],
      [0.8413447460685429, 1],
      [0.975, 1.959963984540054],
      [0.99, 2.326347874040841],
      [0.001, -3.090232306167813],
      [0.02, -2.053748910631823],
    ];
    for (const [p, z] of known) expect(bellQuantile(p)).toBeCloseTo(z, 8);
    for (const p of [0.01, 0.1, 0.3, 0.45]) {
      expect(bellQuantile(1 - p)).toBeCloseTo(-bellQuantile(p), 8);
    }
  });

  it("bellQuantile gives a number at and past the ends (not NaN) and never goes down as the level goes up", () => {
    for (const p of [0, 1, -1, 2, 1e-15, 1 - 1e-15]) {
      expect(Number.isFinite(bellQuantile(p)), `level ${p}`).toBe(true);
    }
    // Held to 1e-12 .. 1 - 1e-12: about 7 either way.
    expect(bellQuantile(0)).toBeCloseTo(bellQuantile(1e-12), 12);
    expect(bellQuantile(0)).toBeLessThan(-6.9);
    expect(bellQuantile(1)).toBeGreaterThan(6.9);
    // Rising everywhere, across the two seams of the approximation (0.02425
    // and 0.97575) as well.
    const levels = [0, 1e-12, 1e-6, 0.001, 0.0242, 0.02425, 0.0243, 0.1];
    for (let k = 1; k < 1000; k += 1) levels.push(0.1 + (0.8 * k) / 1000);
    levels.push(0.9, 0.9757, 0.97575, 0.9758, 0.999, 1 - 1e-6, 1);
    levels.sort((a, b) => a - b);
    for (let k = 1; k < levels.length; k += 1) {
      expect(
        bellQuantile(levels[k]!),
        `${levels[k - 1]} to ${levels[k]}`,
      ).toBeGreaterThanOrEqual(bellQuantile(levels[k - 1]!));
    }
  });

  it("takes the bell's quantiles in the golden-ratio order: point n of the cloud is at the level (0.5 + n x 0.618...) mod 1 of a bell as wide as the line is there", () => {
    // The spec's own numbers, worked out here: the level each point should
    // have, and the width the line should have where it is.
    const golden = (Math.sqrt(5) - 1) / 2;
    const width = (line: number, u: number) =>
      0.5 * (1 + 0.3 * Math.sin((2 * Math.PI * u) / 24 + 1.7 * line));
    let n = 0;
    let checked = 0;
    let onWidth = 0;
    let levelsMatch = 0;
    const levels: number[] = [];
    placed.forEach((line, w) => {
      for (const p of line) {
        const level = (0.5 + n * golden) % 1;
        n += 1;
        levels.push(level);
        const z = bellQuantile(level);
        // Points near the middle of the bell or at the clip say little about
        // the width: the rest do.
        if (Math.abs(z) < 0.6 || Math.abs(p.across) > 1.55) continue;
        checked += 1;
        const seen = p.across / z;
        if (Math.abs(seen - width(w, p.along)) < 0.04) onWidth += 1;
        if (Math.sign(p.across) === Math.sign(z)) levelsMatch += 1;
      }
    });
    expect(n).toBe(840);
    expect(checked).toBeGreaterThan(400);
    // Away from a line's sharpest bends (where the nearest piece of line is
    // not the one a point was placed from) every point is where the spec
    // puts it: its side of the line, and its width to a few hundredths.
    expect(levelsMatch / checked).toBeGreaterThan(0.97);
    expect(onWidth / checked).toBeGreaterThan(0.9);
    // The order itself: 840 levels in (0, 1), no two close (a golden-ratio
    // sequence's gaps take at most three sizes, the largest under 2 / 840).
    const sorted = [...levels].sort((a, b) => a - b);
    let widest = sorted[0]! + 1 - sorted[sorted.length - 1]!;
    for (let k = 1; k < sorted.length; k += 1) {
      widest = Math.max(widest, sorted[k]! - sorted[k - 1]!);
    }
    expect(widest).toBeLessThan(2 / 840);
  });

  it("swells and thins the line like a drawn stroke: about 0.64 units wide where the sine is high, 0.36 where it is low, on each line in its own phase", () => {
    // The points where sin(2 pi u / 24 + 1.7 line) is over 0.5, and under
    // -0.5: a third of each line each. Over the sine's phase there, the
    // clipped bell's standard deviation is 0.618 and 0.377 (worked out like
    // the figures above): 0.64 and 0.36 at the very top and bottom. A run of
    // consecutive points of a golden-ratio sequence covers the quantiles
    // evenly, so a third of a line lands within a few % of its figure.
    const phaseOf = (line: number, u: number) =>
      Math.sin((2 * Math.PI * u) / 24 + 1.7 * line);
    const sdOf = (values: readonly number[]) => {
      const m = mean(values);
      return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
    };
    placed.forEach((line, w) => {
      const wide = line.filter((p) => phaseOf(w, p.along) > 0.5);
      const thin = line.filter((p) => phaseOf(w, p.along) < -0.5);
      expect(wide.length, `line ${w}`).toBeGreaterThan(30);
      expect(thin.length, `line ${w}`).toBeGreaterThan(30);
      const label = `line ${w}: wide ${sdOf(wide.map((p) => p.across)).toFixed(3)}, thin ${sdOf(thin.map((p) => p.across)).toFixed(3)}`;
      expect(sdOf(wide.map((p) => p.across)), label).toBeGreaterThan(0.54);
      expect(sdOf(wide.map((p) => p.across)), label).toBeLessThan(0.7);
      expect(sdOf(thin.map((p) => p.across)), label).toBeGreaterThan(0.31);
      expect(sdOf(thin.map((p) => p.across)), label).toBeLessThan(0.43);
    });
    // The four lines are not in step: each starts its sine 1.7 radians on.
    const starts = [0, 1, 2, 3].map((line) => phaseOf(line, 0));
    expect(new Set(starts.map((v) => v.toFixed(3))).size).toBe(4);
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
    const { ambientHole } = LOGO_SAMPLING;
    const reach = strayReach();
    for (const p of strays) {
      const inHole =
        p.x > -ambientHole &&
        p.x < LOGO_BOX.width + ambientHole &&
        p.y > -ambientHole &&
        p.y < LOGO_BOX.height + ambientHole;
      expect(inHole).toBe(false);
      expect(inLogoMark(p)).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(-reach.x);
      expect(p.x).toBeLessThanOrEqual(LOGO_BOX.width + reach.x);
      expect(p.y).toBeGreaterThanOrEqual(-reach.y);
      expect(p.y).toBeLessThanOrEqual(LOGO_BOX.height + reach.y);
    }
    // Every point of the mark (the lines and the dot) counts as the mark.
    expect([...cloud, ...dot].every((p) => inLogoMark(p))).toBe(true);
    for (let i = 0; i < strays.length; i += 1) {
      for (let j = i + 1; j < strays.length; j += 1) {
        expect(
          distance([strays[i]!.x, strays[i]!.y], [strays[j]!.x, strays[j]!.y]),
        ).toBeGreaterThanOrEqual(LOGO_SAMPLING.ambientGap);
      }
    }
  });

  it("keeps every stray, as its biggest star, inside the logo's slot and the page's column, on phones from 320 px wide and on desktops (home.css read here, not the numbers logo.ts copied)", () => {
    const css = readFileSync("src/app/home.css", "utf8");
    const phone = css.match(/--slot: clamp\((\d+)rem, (\d+)svh, (\d+)rem\);/)!;
    expect(phone).not.toBeNull();
    const slotMin = Number(phone[1]) * 16;
    const slotShare = Number(phone[2]) / 100;
    const slotMax = Number(phone[3]) * 16;
    const phoneImage = Number(
      css.match(/height: calc\(var\(--slot\) \* ([\d.]+)\);/)![1],
    );
    const desktop = css.match(
      /height: calc\(var\(--slot\) \* ([\d.]+) \/ ([\d.]+)\);/,
    )!;
    const desktopImage = Number(desktop[1]) / Number(desktop[2]);
    const desktopSlot = css.match(
      /--slot: clamp\(\s*(\d+)rem,\s*calc\([\s\S]*?\),\s*(\d+)rem\s*\);/,
    )!;
    expect(desktopSlot).not.toBeNull();
    const dMin = Number(desktopSlot[1]);
    const dMax = Number(desktopSlot[2]);
    const pad = css.match(
      /padding: [\d.]+rem clamp\(([\d.]+)rem, calc\([\d.]+rem \+ \(100vw - (\d+)px\) \* ([\d.]+)\), ([\d.]+)rem\)/,
    )!;
    expect(pad).not.toBeNull();
    const padding = (w: number) =>
      Math.min(
        Number(pad[4]) * 16,
        Math.max(
          Number(pad[1]) * 16,
          Number(pad[1]) * 16 + (w - Number(pad[2])) * Number(pad[3]),
        ),
      );
    // logo.ts describes the same page.
    expect(LOGO_PAGE.phoneSlotRem).toEqual({
      min: slotMin / 16,
      max: slotMax / 16,
    });
    expect(LOGO_PAGE.phoneSlotOfWindow).toBe(slotShare);
    expect(LOGO_PAGE.phoneImage).toBe(phoneImage);
    expect(LOGO_PAGE.desktopImage).toBeCloseTo(desktopImage, 12);
    expect(LOGO_PAGE.desktopSlotRem).toEqual({ min: dMin, max: dMax });
    expect(LOGO_PAGE.paddingRem).toEqual({
      min: Number(pad[1]),
      max: Number(pad[4]),
    });
    expect(LOGO_PAGE.paddingFromPx).toBe(Number(pad[2]));
    expect(css).toContain(`@media (min-width: ${LOGO_PAGE.desktopFromRem}rem)`);

    const radius = (LOOK_LIMITS.brightPx[1] * STAR_SIZE.logo) / 2;
    // One layout: the image `image` px tall in a slot `slot` tall, in a column `column` wide.
    const fits = (
      label: string,
      slot: number,
      image: number,
      column: number,
    ) => {
      const scale = image / LOGO_BOX.height;
      const roomY = (slot - image) / 2;
      const roomX = (column - LOGO_BOX.width * scale) / 2;
      for (const p of strays) {
        const at = `${label}: the stray at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
        const beyond = [
          [-p.y, roomY],
          [p.y - LOGO_BOX.height, roomY],
          [-p.x, roomX],
          [p.x - LOGO_BOX.width, roomX],
        ] as const;
        for (const [past, room] of beyond) {
          if (past > 0)
            expect(past * scale + radius, at).toBeLessThanOrEqual(room);
        }
      }
    };
    // Phones, each at least 9 wide to 20 tall: the review found strays cut
    // off at 390, 412 and 430.
    for (const [w, h] of [
      [320, 568],
      [320, 711],
      [360, 640],
      [360, 800],
      [375, 667],
      [375, 812],
      [376, 835],
      [390, 844],
      [412, 892],
      [412, 915],
      [430, 932],
      [440, 956],
    ] as const) {
      expect(w / h).toBeGreaterThanOrEqual(LOGO_PAGE.phoneAspect - 1e-9);
      const slot = Math.min(slotMax, Math.max(slotMin, h * slotShare));
      fits(`${w}x${h}`, slot, slot * phoneImage, w - 2 * padding(w));
    }
    // Desktops: the slot from its floor to its full size, in the narrowest
    // desktop window (the review found strays over the headline at 29 rem).
    for (let slotRem = dMin; slotRem <= dMax; slotRem += 1) {
      const slot = slotRem * 16;
      fits(
        `desktop, slot ${slotRem} rem`,
        slot,
        slot * desktopImage,
        768 - 2 * padding(768),
      );
    }
  });

  /** Kirby's official logo frame in Pencil: the dot's centre, and the hand's ink box there (getBBox of the path). */
  const OFFICIAL = {
    centre: [45, 53.5] as Vec,
    share: [0.493, 0.687] as Vec,
    bbox: { x: 18.625, y: 12.959, width: 53.504, height: 59.041 },
  };

  it("puts the dot where Kirby's official logo frame has it: (45, 53.5), 0.493 of the hand's ink box across and 0.687 down, a white disc in a blue ring, in the static image and in the particles", () => {
    const { bbox, centre, share } = OFFICIAL;
    expect(PALMATE_DOT).toEqual({
      cx: 45,
      cy: 53.5,
      r: 1.15,
      fill: "#CFE0FF",
      stroke: "#2463EB",
      strokeWidth: 0.8,
    });
    // The path's own box is the frame's ink box.
    const xs = polylines.flatMap((p) => p.points.map((v) => v[0]));
    const ys = polylines.flatMap((p) => p.points.map((v) => v[1]));
    expect(Math.abs(Math.min(...xs) - bbox.x)).toBeLessThan(0.1);
    expect(Math.abs(Math.min(...ys) - bbox.y)).toBeLessThan(0.1);
    expect(Math.abs(Math.max(...xs) - bbox.x - bbox.width)).toBeLessThan(0.1);
    expect(Math.abs(Math.max(...ys) - bbox.y - bbox.height)).toBeLessThan(0.1);
    const near = (got: Vec, label: string) => {
      expect(Math.abs(got[0] - centre[0]), `${label} x`).toBeLessThan(0.5);
      expect(Math.abs(got[1] - centre[1]), `${label} y`).toBeLessThan(0.5);
      const across = (got[0] - bbox.x) / bbox.width;
      const down = (got[1] - bbox.y) / bbox.height;
      expect(Math.abs(across - share[0]) * bbox.width, label).toBeLessThan(0.5);
      expect(Math.abs(down - share[1]) * bbox.height, label).toBeLessThan(0.5);
    };

    // The static image: one circle, its stroke the ring (outer edge 1.55,
    // white inside 0.75), inside the viewBox.
    const svg = renderLogoSvg();
    const circles = [...svg.matchAll(/<circle ([^>]*)\/>/g)];
    expect(circles).toHaveLength(1);
    const attr = (name: string) =>
      circles[0]![1]!.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    near([Number(attr("cx")), Number(attr("cy"))], "static");
    expect(attr("fill")).toBe("#CFE0FF");
    expect(attr("stroke")).toBe("#2463EB");
    const r = Number(attr("r"));
    const ring = Number(attr("stroke-width"));
    expect(r + ring / 2).toBeCloseTo(1.55, 9);
    expect(r - ring / 2).toBeCloseTo(0.75, 9);
    const { x, y, width, height } = LOGO_VIEWBOX;
    const [cx, cy] = [Number(attr("cx")), Number(attr("cy"))];
    expect(cx - 1.55).toBeGreaterThan(x);
    expect(cy - 1.55).toBeGreaterThan(y);
    expect(cx + 1.55).toBeLessThan(x + width);
    expect(cy + 1.55).toBeLessThan(y + height);

    // The particles: a bright core and a ring of dim points round the same
    // centre, in the box, all part of the mark.
    const core = dot.filter((p) => p.tone === 1);
    const rim = dot.filter((p) => p.tone === 0);
    // Pinned: a core of 3 and a ring of 6 (the dot as compared in the
    // screenshots Kirby chose from, 2026-10-10).
    expect(LOGO_SAMPLING.dotCore).toBe(3);
    expect(LOGO_SAMPLING.dotRing).toBe(6);
    expect(core).toHaveLength(3);
    expect(rim).toHaveLength(6);
    const centreOf = (list: readonly { x: number; y: number }[]): Vec =>
      toUnits({ x: mean(list.map((p) => p.x)), y: mean(list.map((p) => p.y)) });
    near(centreOf(dot), "particles");
    near(centreOf(core), "the core");
    near(centreOf(rim), "the ring");
    // The core inside the white (0.75), the ring on the ring's middle line
    // (1.15) and inside its outer edge (1.55), to the JSON's 0.1 px.
    const out = (p: { x: number; y: number }) => {
      const [u, v] = toUnits(p);
      return Math.hypot(u - centre[0], v - centre[1]);
    };
    for (const p of core) expect(out(p)).toBeLessThan(0.75);
    for (const p of rim) {
      expect(Math.abs(out(p) - 1.15)).toBeLessThan(0.05);
      expect(out(p)).toBeLessThan(1.55);
    }
    // Evenly round: neighbours on the ring a sixth of a turn apart.
    const angles = rim
      .map((p) => {
        const [u, v] = toUnits(p);
        return Math.atan2(v - centre[1], u - centre[0]);
      })
      .sort((a, b) => a - b);
    angles.forEach((a, k) => {
      const next =
        k + 1 < angles.length ? angles[k + 1]! : angles[0]! + 2 * Math.PI;
      expect(next - a).toBeCloseTo((2 * Math.PI) / rim.length, 2);
    });
    for (const p of dot) expect(inLogoMark(p)).toBe(true);
  });

  it("keeps the dot's shape when a WebGL budget grows it: the core's particles stay in the white, the ring's on the ring", () => {
    const { centre } = OFFICIAL;
    const out = (p: { x: number; y: number }) => {
      const [u, v] = toUnits(p);
      return Math.hypot(u - centre[0], v - centre[1]);
    };
    for (const count of [6000, 12000]) {
      const grown = densifyStrokes(target.points, target.runs, count, 20261003);
      const shares = shareOut(
        target.runs.map((run) => run.count),
        count,
      );
      let at = shares.slice(0, 4).reduce((sum, n) => sum + n, 0);
      dotRuns.forEach((run, k) => {
        const own = grown.slice(at, at + shares[4 + k]!);
        at += shares[4 + k]!;
        expect(own.length, `${count}`).toBeGreaterThan(3);
        const tone = target.points[run.start]!.tone;
        for (const p of own) {
          expect(p.tone).toBe(tone);
          // A dense walk nudges a lone point by up to 0.75 px (0.25 units).
          if (tone === 1) expect(out(p), `${count}`).toBeLessThan(0.75);
          else expect(Math.abs(out(p) - 1.15), `${count}`).toBeLessThan(0.3);
        }
      });
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
    // 900 and 1,299 (the Canvas 2D path's phone and desktop; 1,300 since the finale is one drawing, 1,299 still a budget the maths must take), 3,000 and 6,000 (WebGL on a low-end device and a phone), 12,000 (WebGL on a desktop).
    for (const count of [900, 1299, 3000, 6000, 12000]) {
      for (const density of ["sparse", "dense"] as const) {
        const pairing = buildPairing(all, {
          count,
          layout: "row",
          seed: 20261003,
          mice: [names[0]!],
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
        // The logo's particle count is the stage's budget, not the target's 633:
        // the surplus is made the way it always was (thinned, topped up or
        // walked along the lines), so no later state is short of particles.
        // One last drawing since the finale (2026-10-11): every particle ends on slot 0.
        expect(new Set(pairing.slot), label).toEqual(new Set([0]));
      }
    }
  });

  it("lets the shimmer's band cross the mark from 0 to 1 at every budget: the strays round it neither stretch nor shift it", () => {
    const all = buildTargets(sketches);
    const names = Object.keys(all.mice).slice(0, 1);
    // A budget's copy of a stray is within a pixel of it (a sparse top-up
    // nudges by up to 1 px, a dense walk by up to 0.75): told apart by the
    // target's own runs, not by the code under test.
    const strayAt = all.logo.runs
      .slice(-LOGO_SAMPLING.ambient)
      .map((run) => all.logo.points[run.start]!);
    expect(strayAt.every((p) => p.tone === 0)).toBe(true);
    expect(strayAt).toHaveLength(LOGO_SAMPLING.ambient);
    const isStray = (p: { x: number; y: number }) =>
      strayAt.some((s) => distance([p.x, p.y], [s.x, s.y]) < 2);
    for (const count of [900, 1299, 6000, 12000]) {
      for (const density of ["sparse", "dense"] as const) {
        const label = `${count} ${density}`;
        const pairing = buildPairing(all, {
          count,
          layout: "row",
          seed: 20261003,
          mice: [names[0]!],
          density,
        });
        const { shimmerX } = pairingTables(pairing, 20261003);
        const markXs: number[] = [];
        const stray = new Set<number>();
        pairing.logo.forEach((p, i) => {
          if (isStray(p)) stray.add(i);
          else markXs.push(p.x);
        });
        // Strays are there at every budget (else this would prove nothing).
        expect(stray.size, label).toBeGreaterThanOrEqual(LOGO_SAMPLING.ambient);
        const left = Math.min(...markXs);
        const right = Math.max(...markXs);
        let markLow = Infinity;
        let markHigh = -Infinity;
        let worst = 0;
        pairing.logo.forEach((p, i) => {
          const want = Math.min(1, Math.max(0, (p.x - left) / (right - left)));
          worst = Math.max(worst, Math.abs(shimmerX[i]! - want));
          if (stray.has(i)) return;
          markLow = Math.min(markLow, shimmerX[i]!);
          markHigh = Math.max(markHigh, shimmerX[i]!);
        });
        // The mark's own ends are the band's 0 and 1, exactly.
        expect(markLow, label).toBe(0);
        expect(markHigh, label).toBe(1);
        // Every particle is where the mark's own span puts it (strays held to
        // 0 to 1), to Float32's precision.
        expect(worst, label).toBeLessThan(1e-6);
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
      expect(insideHandFill([p.x / STAGE_SCALE, p.y / STAGE_SCALE])).toBe(true);
    }
    expect(new Set(points.map((p) => p.tone))).toEqual(new Set([0, 1]));
  });

  it("gives the same points for the same seed and others for another seed", () => {
    expect(fillTemplateHand(300, 7)).toEqual(fillTemplateHand(300, 7));
    expect(fillTemplateHand(300, 7)).not.toEqual(fillTemplateHand(300, 8));
  });

  it("puts every landmark on the hand and a point far from it off the hand", () => {
    for (const landmark of LANDMARKS_MM)
      expect(insideHandFill(landmark)).toBe(true);
    expect(insideHandFill([5, 5])).toBe(false);
    expect(insideHandFill([200, 280])).toBe(false);
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
    const hand = renderHandSvg(targets.hand);
    expect(hand).not.toContain("var(");
    expect(hand).toMatch(/#CFE0FF/);
    expect(hand).toMatch(/#6E9BF5/);
    expect(renderLogoSvg()).not.toContain("var(");
  });

  it("draws the Palmate mark as the hand's own path, one 1.4-unit stroke in #7FA8FF with round ends and no fill, and the dot as one circle; no background, no halo", () => {
    const svg = renderLogoSvg();
    expect(svg).toContain(`d="${PALMATE_PATH}"`);
    expect(svg.match(/<path/g)).toHaveLength(1);
    const { x, y, width, height } = LOGO_VIEWBOX;
    expect(svg).toContain(`viewBox="${x} ${y} ${width} ${height}"`);
    expect(svg).toContain(`stroke="${LOGO_STROKE.color}"`);
    expect(LOGO_STROKE.color).toBe("#7FA8FF");
    // The official logo's line: 1.4 units (Kirby, 2026-10-10; it was 2).
    expect(LOGO_STROKE.width).toBe(1.4);
    expect(svg).toContain(
      `stroke="${LOGO_STROKE.color}" stroke-width="1.4" stroke-linecap="round"`,
    );
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).not.toMatch(/<rect|<ellipse|<image|<g\b|filter|opacity/);
    // The one fill is the dot's white; the one circle is the dot.
    expect(svg.match(/<circle/g)).toHaveLength(1);
    expect(svg.match(/fill="(?!none)[^"]*"/g)).toEqual(['fill="#CFE0FF"']);
    expect(svg).toContain(
      '<circle cx="45" cy="53.5" r="1.15" fill="#CFE0FF" stroke="#2463EB" stroke-width="0.8"/>',
    );
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
