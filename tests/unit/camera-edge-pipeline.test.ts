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
import {
  INITIAL_CORNER_STATES,
  advanceCorners,
  cornerDrawPoint,
  type CornerStates,
} from "../../src/client/camera/cornerSmoother";
import { placeEdges } from "../../src/client/camera/edgeGeometry";
import type { Point } from "../../src/client/camera/quad";
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
    const points = states.map((state, i) =>
      cornerDrawPoint(state, NO_GUIDE[i]),
    );
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
      const points = states.map((state, i) =>
        cornerDrawPoint(state, NO_GUIDE[i]),
      );
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
