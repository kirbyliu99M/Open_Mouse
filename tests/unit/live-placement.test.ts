/**
 * V3.3 WP1b: livePlacement.ts, the live viewfinder's placement readings.
 * Synthetic scenes (模擬): a live sample 360 x 640 px, the video frame's
 * nominal focal length scaled to it, a hand at its landmark heights.
 */
import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_TAGS,
  isExperimentTag,
  LIVE_PLACEMENT_KEEP,
  liveNominalFocalPx,
  liveReadingsAtShutter,
  LIVE_READING_MAX_AGE_MS,
  pushLivePlacement,
  readLivePlacement,
  shutterKindOf,
  type LivePlacementReading,
} from "../../src/client/camera/livePlacement";
import { computeQuadWidthFraction } from "../../src/client/camera/quad";
import { landmarkHeightsMm } from "../../src/client/geometry/parallax";
import type { Point2 } from "../../src/client/geometry/homography";
import { PAPER_SIZES_MM } from "../../src/lib/contracts/measurement";
import { syntheticHand } from "./helpers/synthetic-hand";
import {
  buildSyntheticCamera,
  projectSheetMm,
} from "./helpers/synthetic-camera";

const SAMPLE_W = 360;
const SAMPLE_H = 640;
const L = 190;

function handScale(): number {
  const u = syntheticHand({ spread: false });
  return L / Math.hypot(u[12].x - u[0].x, u[12].y - u[0].y);
}

function liveScene(wrist: Point2, rotationDeg = 0) {
  const fPx = liveNominalFocalPx(
    { width: 1080, height: 1920 },
    1080,
    SAMPLE_W,
  )!;
  const { width: W, height: H } = PAPER_SIZES_MM.a4;
  const cam = buildSyntheticCamera({
    tiltDeg: 3,
    distanceMm: 360,
    fPx,
    widthPx: SAMPLE_W,
    heightPx: SAMPLE_H,
  });
  const toPx = (p: Point2, h = 0) =>
    projectSheetMm(cam, { x: p.x - W / 2, y: p.y - H / 2 }, h);
  const corners: [Point2, Point2, Point2, Point2] = [
    toPx({ x: 0, y: 0 }),
    toPx({ x: W, y: 0 }),
    toPx({ x: W, y: H }),
    toPx({ x: 0, y: H }),
  ];
  const truth = syntheticHand(
    { spread: false },
    { scale: handScale(), rotationDeg, offset: wrist },
  );
  const heights = landmarkHeightsMm(L);
  const points = truth.map((p, i) => toPx(p, heights[i]));
  return { fPx, corners, points };
}

describe("liveNominalFocalPx", () => {
  it("is the 18 mm prior on the stream's long edge (998 px at 1920), scaled to the sample", () => {
    const full = liveNominalFocalPx({ width: 1080, height: 1920 }, 1080, 1080)!;
    expect(full).toBeCloseTo(998.4, 0);
    const sample = liveNominalFocalPx(
      { width: 1080, height: 1920 },
      1080,
      360,
    )!;
    expect(sample).toBeCloseTo(full / 3, 9);
  });
  it("null for sizes that are not positive", () => {
    expect(liveNominalFocalPx({ width: 0, height: 0 }, 1080, 360)).toBeNull();
    expect(
      liveNominalFocalPx({ width: 1080, height: 1920 }, 0, 360),
    ).toBeNull();
    expect(
      liveNominalFocalPx({ width: 1080, height: 1920 }, 1080, 0),
    ).toBeNull();
  });
});

describe("readLivePlacement — synthetic (模擬, no noise)", () => {
  it("wrist within 0.5 mm and axis within 0.5° on the live sample", () => {
    const s = liveScene({ x: 105, y: 297 - 8 }, 6);
    const r = readLivePlacement({
      atMs: 1234,
      points: s.points,
      corners: s.corners,
      paperSize: "a4",
      focalPx: s.fPx,
      width: SAMPLE_W,
      height: SAMPLE_H,
    })!;
    expect(r.atMs).toBe(1234);
    expect(Math.abs(r.wristToEdgeMm! - 8)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.handAxisDeg! - 6)).toBeLessThanOrEqual(0.5);
    expect(r.palmOverHand).not.toBeNull();
    expect(r.fill).toBeCloseTo(
      computeQuadWidthFraction(
        {
          topLeft: s.corners[0],
          topRight: s.corners[1],
          bottomRight: s.corners[2],
          bottomLeft: s.corners[3],
        },
        SAMPLE_W,
      ),
      12,
    );
  });

  it("null without a hand, corners or a focal length; never throws", () => {
    const s = liveScene({ x: 105, y: 290 });
    const base = {
      atMs: 0,
      points: s.points,
      corners: s.corners,
      paperSize: "a4" as const,
      focalPx: s.fPx,
      width: SAMPLE_W,
      height: SAMPLE_H,
    };
    expect(readLivePlacement({ ...base, points: null })).toBeNull();
    expect(readLivePlacement({ ...base, corners: null })).toBeNull();
    expect(
      readLivePlacement({
        ...base,
        corners: [s.corners[0], null, s.corners[2], s.corners[3]],
      }),
    ).toBeNull();
    expect(readLivePlacement({ ...base, focalPx: null })).toBeNull();
    expect(readLivePlacement({ ...base, width: 0 })).toBeNull();
    expect(
      readLivePlacement({ ...base, points: s.points.slice(0, 20) }),
    ).toBeNull();
    // Collinear corners: the homography cannot be built.
    expect(
      readLivePlacement({
        ...base,
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
      }),
    ).toBeNull();
  });
});

describe("pushLivePlacement", () => {
  const r = (atMs: number): LivePlacementReading => ({
    atMs,
    fill: 0.6,
    wristToEdgeMm: 5,
    handAxisDeg: 0,
    palmOverHand: 0.5,
    minSideMarginMm: 20,
    wristEdge: "near-bottom",
    fingerRatioMean: null,
  });
  it("keeps the newest three, oldest first", () => {
    let list: LivePlacementReading[] = [];
    for (let i = 1; i <= 5; i++) list = pushLivePlacement(list, r(i));
    expect(LIVE_PLACEMENT_KEEP).toBe(3);
    expect(list.map((x) => x.atMs)).toEqual([3, 4, 5]);
  });
});

describe("shutterKindOf", () => {
  it("ring → auto, hand held still → no-sheet, otherwise manual", () => {
    expect(shutterKindOf({ autoCapture: true, noSheet: false })).toBe("auto");
    expect(shutterKindOf({ autoCapture: true, noSheet: true })).toBe("auto");
    expect(shutterKindOf({ autoCapture: false, noSheet: true })).toBe(
      "no-sheet",
    );
    expect(shutterKindOf({ autoCapture: false, noSheet: false })).toBe(
      "manual",
    );
  });
});

describe("experiment tags", () => {
  it("are the design §5.2 grid plus the four extra scans", () => {
    expect(EXPERIMENT_TAGS).toHaveLength(12);
    expect(EXPERIMENT_TAGS).toContain("aligned/0.65");
    expect(EXPERIMENT_TAGS).toContain("up4/0.80");
    expect(EXPERIMENT_TAGS).toContain("tilt10/0.65");
    expect(isExperimentTag("pencil/0.65")).toBe(true);
    expect(isExperimentTag("pencil/0.66")).toBe(false);
    expect(isExperimentTag(3)).toBe(false);
  });
});

describe("liveReadingsAtShutter (stale readings never reach the log)", () => {
  const at = (atMs: number) => ({
    atMs,
    fill: 0.65,
    wristToEdgeMm: 7,
    handAxisDeg: 1,
    palmOverHand: 0.5,
    // V3.3 WP3a: live-hint fields the log does not copy (toStrictEqual below).
    minSideMarginMm: 12,
    wristEdge: "near-bottom" as const,
    fingerRatioMean: null,
  });

  it("ages each reading at the shutter, oldest first, values unchanged", () => {
    expect(liveReadingsAtShutter([at(1000), at(1500)], 2000)).toStrictEqual([
      {
        ageMs: 1000,
        fill: 0.65,
        wristToEdgeMm: 7,
        handAxisDeg: 1,
        palmOverHand: 0.5,
        fingerRatioMean: null,
      },
      {
        ageMs: 500,
        fill: 0.65,
        wristToEdgeMm: 7,
        handAxisDeg: 1,
        palmOverHand: 0.5,
        fingerRatioMean: null,
      },
    ]);
  });

  it("a reading 70 s old is left out whole, not kept with its values and no age", () => {
    expect(LIVE_READING_MAX_AGE_MS).toBe(60000);
    const out = liveReadingsAtShutter([at(0), at(10000), at(69000)], 70000);
    expect(out.map((r) => r.ageMs)).toEqual([60000, 1000]);
    expect(liveReadingsAtShutter([at(0)], 70000)).toEqual([]);
  });

  it("a reading stamped after the shutter is age 0; a non-finite age is left out", () => {
    expect(liveReadingsAtShutter([at(2100)], 2000)[0].ageMs).toBe(0);
    expect(liveReadingsAtShutter([at(Number.NaN)], 2000)).toEqual([]);
  });
});

describe("cost per live hand reading (desktop, 實測 on this machine)", () => {
  it("readLivePlacement on the 360×640 sample: mean < 1 ms (brief WP1b acceptance 5)", () => {
    const s = liveScene({ x: 105, y: 290 }, 4);
    const input = {
      atMs: 0,
      points: s.points,
      corners: s.corners,
      paperSize: "a4" as const,
      focalPx: s.fPx,
      width: SAMPLE_W,
      height: SAMPLE_H,
    };
    for (let i = 0; i < 200; i++) readLivePlacement(input); // warm-up
    const N = 2000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) readLivePlacement(input);
    const meanMs = (performance.now() - t0) / N;
    console.log(
      `[WP1b bench] readLivePlacement ${meanMs.toFixed(4)} ms per reading (mean of ${N}, 360×640)`,
    );
    expect(readLivePlacement(input)).not.toBeNull();
    expect(meanMs).toBeLessThan(1);
  });
});
