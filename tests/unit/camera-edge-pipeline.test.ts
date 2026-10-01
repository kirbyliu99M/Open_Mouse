/**
 * The outline that joins the four dots, driven through the REAL paper
 * detector. `detectPaperQuad` relabels its corners (a cyclic shift) when the
 * paper is held sideways, so the labels that reach the screen are not always
 * TL, TR, BR, BL. A drawing that assumed they were spun a full turn at about
 * 90 and 270 degrees (found by review; a fixed upright sheet cannot show it).
 *
 * Here a synthetic A4 is rotated through 0 to 360 degrees in 1 degree steps,
 * each photo goes through `detectPaperQuad`, about +-1.5 px of noise is added
 * to each corner, and the corners go through the same smoother and the same
 * edge placement the screen uses. What is asserted is the angle the screen
 * would be told to draw, sample after sample.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { detectPaperQuad } from "../../src/client/paper/detect";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import { computeMaxCornerMovement } from "../../src/client/camera/steadiness";
import {
  INITIAL_CORNER_STATES,
  advanceCorner,
  advanceCorners,
  alignObservation,
  cornerDrawPoint,
  cornerDrawPoints,
  type CornerStates,
  type Observed,
} from "../../src/client/camera/cornerSmoother";
import { placeEdges } from "../../src/client/camera/edgeGeometry";
import type { Point, Quad } from "../../src/client/camera/quad";
import { generateSyntheticPaper } from "./helpers/synthetic-paper";

const WIDTH = 640;
const HEIGHT = 480;
const SEED = 424242;
const NOISE_PX = 1.5;
const NO_GUIDE: readonly [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample {
  readonly deg: number;
  /** As `detectPaperQuad` labelled them (TL, TR, BR, BL), plus noise. */
  readonly corners: readonly [Point, Point, Point, Point];
  /** Which of the paper's true corners label 0 landed on (0 to 3). */
  readonly shift: number;
}

/** One detector run per degree; built once for every test in this file. */
let cached: { samples: Sample[]; failed: number[] } | null = null;
function sweep() {
  if (cached) return cached;
  const noise = mulberry32(SEED);
  const samples: Sample[] = [];
  const failed: number[] = [];
  for (let deg = 0; deg <= 360; deg++) {
    const photo = generateSyntheticPaper({
      width: WIDTH,
      height: HEIGHT,
      seed: SEED,
      rotationDeg: deg,
    });
    const detection = detectPaperQuad(
      {
        width: WIDTH,
        height: HEIGHT,
        data: photo.data,
      } as unknown as ImageData,
      "a4",
    );
    const partial = detection.partialCorners;
    if (
      detection.cornersSeen < 4 ||
      !partial[0] ||
      !partial[1] ||
      !partial[2] ||
      !partial[3]
    ) {
      failed.push(deg);
      continue;
    }
    // Which true corner did label 0 land on? (the cyclic shift the detector applied)
    let shift = 0;
    let best = Infinity;
    for (let s = 0; s < 4; s++) {
      let total = 0;
      for (let i = 0; i < 4; i++) {
        const t = photo.trueCorners[(i + s) % 4];
        total += Math.hypot(partial[i]!.x - t.x, partial[i]!.y - t.y);
      }
      if (total < best) {
        best = total;
        shift = s;
      }
    }
    const jitter = () => (noise() * 2 - 1) * NOISE_PX;
    const corners = partial.map((p) => ({
      x: p!.x + jitter(),
      y: p!.y + jitter(),
    })) as unknown as Sample["corners"];
    samples.push({ deg, corners, shift });
  }
  cached = { samples, failed };
  return cached;
}

/** The angle of each of the four edges, per sample, as the screen draws them now. */
function renderedAngles(samples: readonly Sample[]): number[][] {
  let states: CornerStates = INITIAL_CORNER_STATES;
  let previous: (number | null)[] = [null, null, null, null];
  return samples.map((sample) => {
    states = advanceCorners(states, sample.corners, 125);
    const points = cornerDrawPoints(states, NO_GUIDE);
    const { angles } = placeEdges(points, previous);
    previous = angles;
    return angles;
  });
}

/** What round 1 drew: a directed atan2 per edge, BL to BR for the bottom. */
function oldRenderedAngles(samples: readonly Sample[]): number[][] {
  const OLD_EDGES = [
    [0, 1],
    [1, 2],
    [3, 2],
    [0, 3],
  ] as const;
  let states: CornerStates = INITIAL_CORNER_STATES;
  return samples.map((sample) => {
    states = advanceCorners(states, sample.corners, 125);
    const points = states.map((state, i) =>
      cornerDrawPoint(state, NO_GUIDE[i]),
    );
    return OLD_EDGES.map(([from, to]) =>
      Math.atan2(points[to].y - points[from].y, points[to].x - points[from].x),
    );
  });
}

/** The largest per-edge step between neighbouring degrees, split by whether a relabel is near. */
function maxSteps(samples: readonly Sample[], angles: number[][]) {
  // A relabel (the detector's cyclic shift changing) makes each dot glide to the
  // next corner through the smoother, so its effect on the drawn edges lasts a
  // few samples. 8 covers the smoother to under 5% (0.65^8).
  const WINDOW = 8;
  const swapAt: number[] = [];
  for (let i = 1; i < samples.length; i++)
    if (
      samples[i].shift !== samples[i - 1].shift &&
      samples[i].deg === samples[i - 1].deg + 1
    )
      swapAt.push(i);
  const nearSwap = (i: number) => swapAt.some((s) => i >= s && i < s + WINDOW);
  let steady = 0;
  let atSwap = 0;
  let steadyAt = -1;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].deg !== samples[i - 1].deg + 1) continue; // a detection gap
    for (let e = 0; e < 4; e++) {
      const step = Math.abs(angles[i][e] - angles[i - 1][e]);
      if (nearSwap(i)) atSwap = Math.max(atSwap, step);
      else if (step > steady) {
        steady = step;
        steadyAt = samples[i].deg;
      }
    }
  }
  return { steady, steadyAt, atSwap, swaps: swapAt.map((i) => samples[i].deg) };
}

describe("the outline through the real detector, paper rotated 0 to 360 degrees", () => {
  // 361 detector runs, about 20 s; the tests below share them.
  beforeAll(() => {
    sweep();
  }, 180_000);

  it("the detector finds all four corners at almost every degree, and relabels them when the paper is sideways", () => {
    const { samples, failed } = sweep();
    console.log(
      `sweep: ${samples.length} of 361 degrees detected; missed: ${failed.join(",") || "none"}; label shifts seen: ${[...new Set(samples.map((s) => s.shift))].join(",")}`,
    );
    expect(samples.length).toBeGreaterThanOrEqual(330);
    // The relabelling the review found: more than one cyclic shift occurs.
    expect(new Set(samples.map((s) => s.shift)).size).toBeGreaterThan(1);
  });

  it("the rendered angle never jumps by more than 0.6 rad between neighbouring degrees, except while an edge changes identity (then at most a quarter turn)", () => {
    const { samples } = sweep();
    const steps = maxSteps(samples, renderedAngles(samples));
    console.log(
      `rendered outline: largest step away from a relabel ${steps.steady.toFixed(3)} rad (at ${steps.steadyAt} deg), within ${8} samples of a relabel ${steps.atSwap.toFixed(3)} rad; relabels at ${steps.swaps.join(", ")} deg`,
    );
    expect(steps.steady).toBeLessThanOrEqual(0.6);
    expect(steps.atSwap).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });

  it("the old drawing (a directed atan2 per edge) fails the same sweep with a full-turn spin", () => {
    const { samples } = sweep();
    const steps = maxSteps(samples, oldRenderedAngles(samples));
    console.log(
      `old outline: largest step away from a relabel ${steps.steady.toFixed(3)} rad (at ${steps.steadyAt} deg), near a relabel ${steps.atSwap.toFixed(3)} rad`,
    );
    // A jump of about 2 pi: the 140 ms transition turns the line all the way round.
    expect(Math.max(steps.steady, steps.atSwap)).toBeGreaterThan(5);
  });

  it("every edge keeps lying on its two dots: the segment drawn is the segment between them, whatever the labels", () => {
    const { samples } = sweep();
    let states: CornerStates = INITIAL_CORNER_STATES;
    let previous: (number | null)[] = [null, null, null, null];
    for (const sample of samples) {
      states = advanceCorners(states, sample.corners, 125);
      const points = cornerDrawPoints(states, NO_GUIDE);
      const { placements, angles } = placeEdges(points, previous);
      previous = angles;
      placements.forEach((edge, e) => {
        const a = points[e];
        const b = points[(e + 1) % 4];
        const half = edge.length / 2;
        const one = {
          x: edge.centre.x + Math.cos(edge.angle) * half,
          y: edge.centre.y + Math.sin(edge.angle) * half,
        };
        const other = {
          x: edge.centre.x - Math.cos(edge.angle) * half,
          y: edge.centre.y - Math.sin(edge.angle) * half,
        };
        const straight =
          Math.hypot(one.x - a.x, one.y - a.y) +
          Math.hypot(other.x - b.x, other.y - b.y);
        const crossed =
          Math.hypot(one.x - b.x, one.y - b.y) +
          Math.hypot(other.x - a.x, other.y - a.y);
        expect(
          Math.min(straight, crossed),
          `${sample.deg} deg edge ${e}`,
        ).toBeLessThan(1e-6);
      });
    }
  });
});

describe("the dots and the steadiness check across the detector's relabels", () => {
  // The detector relabels the corners when the paper is sideways (134 and 314
  // degrees in this sweep). A dot has to stay with its corner across that.
  const DIAGONAL = Math.hypot(WIDTH, HEIGHT);

  /** Where each of the four dots is drawn after every sample (the real smoother). */
  function drawnDots(samples: readonly Sample[]): Point[][] {
    let states: CornerStates = INITIAL_CORNER_STATES;
    return samples.map((sample) => {
      states = advanceCorners(states, sample.corners, 125);
      return states.map((state, i) => cornerDrawPoint(state, NO_GUIDE[i]));
    });
  }

  /** What the smoother did before the remap: each label its own dot. */
  function drawnDotsByLabel(samples: readonly Sample[]): Point[][] {
    let states: CornerStates = INITIAL_CORNER_STATES;
    return samples.map((sample) => {
      states = [
        advanceCorner(states[0], sample.corners[0], 125),
        advanceCorner(states[1], sample.corners[1], 125),
        advanceCorner(states[2], sample.corners[2], 125),
        advanceCorner(states[3], sample.corners[3], 125),
      ];
      return states.map((state, i) => cornerDrawPoint(state, NO_GUIDE[i]));
    });
  }

  /** The largest distance any dot moves between neighbouring degrees. */
  function largestDotStep(samples: readonly Sample[], dots: Point[][]) {
    let largest = 0;
    let at = -1;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].deg !== samples[i - 1].deg + 1) continue;
      for (let d = 0; d < 4; d++) {
        const step = Math.hypot(
          dots[i][d].x - dots[i - 1][d].x,
          dots[i][d].y - dots[i - 1][d].y,
        );
        if (step > largest) {
          largest = step;
          at = samples[i].deg;
        }
      }
    }
    return { largest, at };
  }

  it("no dot moves more than a few px between neighbouring degrees, the relabels at 134 and 314 included", () => {
    const { samples } = sweep();
    const { largest, at } = largestDotStep(samples, drawnDots(samples));
    const swaps = samples
      .filter((s, i) => i > 0 && s.shift !== samples[i - 1].shift)
      .map((s) => s.deg);
    console.log(
      `dots: largest step ${largest.toFixed(2)} px (at ${at} degrees); the detector relabelled at ${swaps.join(", ")} degrees`,
    );
    expect(swaps.length).toBeGreaterThanOrEqual(2);
    // One degree of paper rotation moves a corner about 3 px (half the
    // diagonal of the paper, a little over 150 px, times 0.0175), and the
    // +-1.5 px of noise adds to it; after the smoother it is less. A dot that
    // went to the opposite corner would move 300 px or more.
    expect(largest).toBeLessThan(8);
  });

  it("without the remap the dots cross the paper at the relabels (a control that reads the labels as identities)", () => {
    const { samples } = sweep();
    const { largest, at } = largestDotStep(samples, drawnDotsByLabel(samples));
    console.log(
      `dots without the remap: largest step ${largest.toFixed(1)} px (at ${at} degrees)`,
    );
    expect(largest).toBeGreaterThan(60);
  });

  it("the outline keeps its size across the whole sweep (it does not collapse while the labels settle)", () => {
    const { samples } = sweep();
    const dots = drawnDots(samples);
    const sides = dots.map((quad) =>
      [0, 1, 2, 3].map((i) =>
        Math.hypot(
          quad[(i + 1) % 4].x - quad[i].x,
          quad[(i + 1) % 4].y - quad[i].y,
        ),
      ),
    );
    const shortest = Math.min(...sides.flat().slice(40)); // past the first sightings
    console.log(
      `outline: shortest side over the sweep ${shortest.toFixed(1)} px`,
    );
    expect(shortest).toBeGreaterThan(100);
  });

  it("steadiness: the corner movement stays under the 1.5% threshold at every step, the relabels included", () => {
    const { samples } = sweep();
    const quadOf = (s: Sample): Quad => ({
      topLeft: s.corners[0],
      topRight: s.corners[1],
      bottomRight: s.corners[2],
      bottomLeft: s.corners[3],
    });
    const labelByLabel = (a: Quad, b: Quad) =>
      Math.max(
        Math.hypot(a.topLeft.x - b.topLeft.x, a.topLeft.y - b.topLeft.y),
        Math.hypot(a.topRight.x - b.topRight.x, a.topRight.y - b.topRight.y),
        Math.hypot(
          a.bottomRight.x - b.bottomRight.x,
          a.bottomRight.y - b.bottomRight.y,
        ),
        Math.hypot(
          a.bottomLeft.x - b.bottomLeft.x,
          a.bottomLeft.y - b.bottomLeft.y,
        ),
      );
    let fixed = 0;
    let old = 0;
    let oldAt = -1;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].deg !== samples[i - 1].deg + 1) continue;
      const a = quadOf(samples[i - 1]);
      const b = quadOf(samples[i]);
      fixed = Math.max(fixed, computeMaxCornerMovement(a, b));
      const before = labelByLabel(a, b);
      if (before > old) {
        old = before;
        oldAt = samples[i].deg;
      }
    }
    const limit =
      CAMERA_CONSTANTS.steadiness.maxCornerMovementFraction * DIAGONAL;
    console.log(
      `steadiness: largest movement ${fixed.toFixed(1)} px now (${((fixed / DIAGONAL) * 100).toFixed(2)}% of the diagonal), ${old.toFixed(1)} px label by label (at ${oldAt} degrees); limit ${limit.toFixed(1)} px`,
    );
    expect(fixed).toBeLessThan(limit);
    // The old reading did call the relabel movement: a jump of the paper's own size.
    expect(old).toBeGreaterThan(limit * 5);
  });
});

describe("one edge hidden near the relabels (the detector reports 0, 2 or 4 corners)", () => {
  // One hidden edge hides two adjacent corners. The paper's bottom edge (true
  // corners 2 and 3) is hidden for five degrees round each relabel, so the
  // relabel arrives with only two corners visible, and the frames either side
  // have four again.
  const WINDOWS: readonly (readonly [number, number])[] = [
    [133, 137],
    [313, 317],
  ];
  const HIDDEN_TRUE_CORNERS = [2, 3];
  /** Frames to look at: the windows and two degrees either side of them. */
  const LOOKED_AT = WINDOWS.map(([from, to]) => [from - 2, to + 2] as const);
  const inside = (
    deg: number,
    ranges: readonly (readonly [number, number])[],
  ) => ranges.some(([from, to]) => deg >= from && deg <= to);

  /** The observations the screen would get: label i holds true corner (i + shift) % 4. */
  function observations(samples: readonly Sample[]): Observed[] {
    return samples.map((sample) =>
      sample.corners.map((point, label) =>
        inside(sample.deg, WINDOWS) &&
        HIDDEN_TRUE_CORNERS.includes((label + sample.shift) % 4)
          ? null
          : point,
      ),
    ) as unknown as Observed[];
  }

  /** What the old rule did: a relabel was followed only when all four were seen. */
  const ALL_OR_NOTHING = (
    states: CornerStates,
    observed: Observed,
  ): Observed =>
    observed.some((point) => point === null)
      ? observed
      : alignObservation(states, observed);

  function run(
    samples: readonly Sample[],
    align: (states: CornerStates, observed: Observed) => Observed,
  ) {
    const seen = observations(samples);
    let states: CornerStates = INITIAL_CORNER_STATES;
    const dots: Point[][] = [];
    samples.forEach((_, i) => {
      const matched = align(states, seen[i]);
      states = [
        advanceCorner(states[0], matched[0], 125),
        advanceCorner(states[1], matched[1], 125),
        advanceCorner(states[2], matched[2], 125),
        advanceCorner(states[3], matched[3], 125),
      ];
      dots.push(states.map((state, d) => cornerDrawPoint(state, NO_GUIDE[d])));
    });
    let largestStep = 0;
    let shortestSide = Infinity;
    let bowTies = 0;
    for (let i = 1; i < samples.length; i++) {
      if (!inside(samples[i].deg, LOOKED_AT)) continue;
      if (samples[i].deg === samples[i - 1].deg + 1)
        for (let d = 0; d < 4; d++)
          largestStep = Math.max(
            largestStep,
            Math.hypot(
              dots[i][d].x - dots[i - 1][d].x,
              dots[i][d].y - dots[i - 1][d].y,
            ),
          );
      const quad = dots[i];
      for (let d = 0; d < 4; d++)
        shortestSide = Math.min(
          shortestSide,
          Math.hypot(
            quad[(d + 1) % 4].x - quad[d].x,
            quad[(d + 1) % 4].y - quad[d].y,
          ),
        );
      // A bow-tie: opposite sides cross. The sign of the cross product of
      // consecutive edges must be the same all the way round.
      const signs = [0, 1, 2, 3].map((d) => {
        const a = quad[d];
        const b = quad[(d + 1) % 4];
        const c = quad[(d + 2) % 4];
        return Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
      });
      if (!signs.every((s) => s === signs[0])) bowTies += 1;
    }
    return { largestStep, shortestSide, bowTies };
  }

  it("the hidden edge is really hidden: two corners are missing in the frames inside the windows", () => {
    const { samples } = sweep();
    const seen = observations(samples);
    const inWindow = samples
      .map((sample, i) => ({ sample, i }))
      .filter(({ sample }) => inside(sample.deg, WINDOWS));
    expect(inWindow.length).toBeGreaterThanOrEqual(8);
    for (const { i } of inWindow)
      expect(seen[i].filter((point) => point === null)).toHaveLength(2);
    // ...and a relabel happens inside them (134 and 314 degrees).
    const shifts = new Set(inWindow.map(({ sample }) => sample.shift));
    expect(shifts.size).toBeGreaterThanOrEqual(2);
  });

  it("with two corners visible the dots still follow their corners: small steps, an outline that keeps its size, no bow-tie", () => {
    const { samples } = sweep();
    const { largestStep, shortestSide, bowTies } = run(
      samples,
      alignObservation,
    );
    console.log(
      `hidden edge: largest dot step ${largestStep.toFixed(2)} px, shortest side ${shortestSide.toFixed(1)} px, bow-tie frames ${bowTies}`,
    );
    expect(largestStep).toBeLessThan(10);
    expect(shortestSide).toBeGreaterThan(100);
    expect(bowTies).toBe(0);
  });

  it("control: following a relabel only when all four are seen lets the visible pair glide to the wrong dots", () => {
    const { samples } = sweep();
    const { largestStep, shortestSide, bowTies } = run(samples, ALL_OR_NOTHING);
    console.log(
      `hidden edge, old rule: largest dot step ${largestStep.toFixed(1)} px, shortest side ${shortestSide.toFixed(1)} px, bow-tie frames ${bowTies}`,
    );
    expect(largestStep).toBeGreaterThan(60);
    expect(shortestSide).toBeLessThan(40);
    expect(bowTies).toBeGreaterThan(0);
  });
});
