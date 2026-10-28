import { describe, expect, it } from "vitest";
import {
  INITIAL_CORNER_STATE,
  INITIAL_CORNER_STATES,
  advanceCorner,
  advanceCorners,
  cornerDrawPoint,
  smoothingWeight,
  cornerDrawPoints,
  isCornerReturning,
  type CornerState,
} from "../../src/client/camera/cornerSmoother";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";

const STEP = 125;
const GUIDE = { x: 30, y: 166 };

function found(state: CornerState, x: number, y: number, dt = STEP) {
  return advanceCorner(state, { x, y }, dt);
}
function lost(state: CornerState, dt = STEP) {
  return advanceCorner(state, null, dt);
}

describe("advanceCorner — found", () => {
  it("uses the constants: 0.6 Hz at rest, 12 Hz per diagonal a second, 1 Hz on the velocity, back to the guide after 1 s", () => {
    expect(CAMERA_CONSTANTS.corners).toEqual({
      minCutoffHz: 0.6,
      speedCutoffGain: 12,
      velocityCutoffHz: 1,
      returnToGuideAfterMs: 1000,
      repopAfterLostMs: 500,
    });
  });

  it("at rest it filters as hard as the old fixed weight: 0.35 at 141 ms (7.1 samples a second)", () => {
    expect(
      smoothingWeight(CAMERA_CONSTANTS.corners.minCutoffHz, 141),
    ).toBeCloseTo(0.35, 2);
    expect(smoothingWeight(1, 0)).toBe(0);
    expect(smoothingWeight(0, 141)).toBe(0);
  });

  it("the first sighting is taken as it is: there is nothing to filter against", () => {
    const state = found(INITIAL_CORNER_STATE, 100, 200);
    expect(state.point).toEqual({ x: 100, y: 200 });
    expect(state.found).toBe(true);
    expect(state.lostMs).toBe(0);
    expect(state.foundCount).toBe(1);
  });

  it("filters later samples part of the way, the weight from the time step and the corner's speed", () => {
    let state = found(INITIAL_CORNER_STATE, 100, 100);
    state = found(state, 200, 100);
    // A 100 px move in one step is fast: more than the old 0.35, short of all of it.
    expect(state.point!.x).toBeGreaterThan(135);
    expect(state.point!.x).toBeLessThan(200);
    expect(state.point!.y).toBeCloseTo(100, 10);
    const before = state.point!.x;
    state = found(state, 200, 100);
    expect(state.point!.x).toBeGreaterThan(before);
    expect(state.point!.x).toBeLessThanOrEqual(200);
  });

  it("a sheet panned at 300 px/s is trailed by under a third of a sample (the old filter: 1.86 samples, 261 ms)", () => {
    const DT = 141;
    let state = found(INITIAL_CORNER_STATE, 0, 0, DT);
    let truth = 0;
    for (let k = 0; k < 30; k++) {
      truth += (300 * DT) / 1000;
      state = found(state, truth, 0, DT);
    }
    const lagMs = ((truth - state.point!.x) / 300) * 1000;
    expect(lagMs).toBeLessThan(DT / 3);
    expect(lagMs).toBeGreaterThan(0);
  });

  it("a sudden 60 px move is 90 % covered within two samples (the old filter: six)", () => {
    let state = found(INITIAL_CORNER_STATE, 0, 0, 141);
    for (let k = 0; k < 5; k++) state = found(state, 0, 0, 141);
    state = found(state, 60, 0, 141);
    state = found(state, 60, 0, 141);
    expect(state.point!.x).toBeGreaterThan(54);
  });

  it("an uneven sample rate: a longer step moves the dot further toward the sample", () => {
    const start = found(found(INITIAL_CORNER_STATE, 0, 0), 0, 0);
    const short = advanceCorner(start, { x: 3, y: 0 }, 80).point!.x;
    const long = advanceCorner(start, { x: 3, y: 0 }, 200).point!.x;
    expect(long).toBeGreaterThan(short);
  });

  it("converges on a fixed target and never overshoots it", () => {
    let state = found(INITIAL_CORNER_STATE, 0, 0);
    let previous = 0;
    for (let i = 0; i < 40; i++) {
      state = found(state, 100, 0);
      expect(state.point!.x).toBeGreaterThan(previous);
      expect(state.point!.x).toBeLessThanOrEqual(100);
      previous = state.point!.x;
    }
    expect(state.point!.x).toBeCloseTo(100, 3);
  });

  it("damps jitter: samples alternating ±4 px move the dot by well under 4 px", () => {
    let state = found(INITIAL_CORNER_STATE, 100, 100);
    let maxStep = 0;
    for (let i = 0; i < 40; i++) {
      const before = state.point!.x;
      state = found(state, 100 + (i % 2 === 0 ? 4 : -4), 100);
      maxStep = Math.max(maxStep, Math.abs(state.point!.x - before));
    }
    expect(maxStep).toBeLessThan(0.35 * 8 + 1e-9); // one full swing, times alpha
    expect(maxStep).toBeLessThan(4);
  });

  it("does not count a corner that stays found as new", () => {
    let state = found(INITIAL_CORNER_STATE, 10, 10);
    for (let i = 0; i < 10; i++) state = found(state, 10, 10);
    expect(state.foundCount).toBe(1);
  });
});

describe("advanceCorner — lost", () => {
  it("keeps its last position and turns hollow: it never snaps to the guide", () => {
    let state = found(INITIAL_CORNER_STATE, 320, 610);
    state = found(state, 320, 610);
    const before = state.point;
    state = lost(state);
    expect(state.point).toEqual(before);
    expect(state.found).toBe(false);
    expect(cornerDrawPoint(state, GUIDE)).toEqual(before);
    expect(cornerDrawPoint(state, GUIDE)).not.toEqual(GUIDE);
  });

  it("stays put for just under a second, however many samples that is", () => {
    let state = found(INITIAL_CORNER_STATE, 320, 610);
    const at = state.point;
    for (let ms = 0; ms + STEP < 1000; ms += STEP) {
      state = lost(state);
      expect(state.point).toEqual(at);
      expect(isCornerReturning(state)).toBe(false);
    }
    expect(state.lostMs).toBe(875);
  });

  it("goes back to the guide once it has been lost for 1 s (inclusive)", () => {
    let state = found(INITIAL_CORNER_STATE, 320, 610);
    state = lost(state, 999);
    expect(state.point).toEqual({ x: 320, y: 610 });
    expect(isCornerReturning(state)).toBe(false);
    state = lost(state, 1);
    expect(state.lostMs).toBe(1000);
    expect(state.point).toBeNull();
    expect(cornerDrawPoint(state, GUIDE)).toEqual(GUIDE);
    expect(isCornerReturning(state)).toBe(true);
  });

  it("a corner that was never seen is drawn at the guide, hollow", () => {
    const state = lost(INITIAL_CORNER_STATE);
    expect(state.found).toBe(false);
    expect(cornerDrawPoint(state, GUIDE)).toEqual(GUIDE);
  });

  it("ignores a negative time step rather than winding the clock back", () => {
    let state = found(INITIAL_CORNER_STATE, 1, 1);
    state = lost(state, 300);
    state = lost(state, -500);
    expect(state.lostMs).toBe(300);
  });
});

describe("advanceCorner — pop-in", () => {
  it("a corner found again after a real absence is new (pops in with a pulse ring)", () => {
    let state = found(INITIAL_CORNER_STATE, 50, 50);
    state = lost(state, 500);
    state = found(state, 52, 50);
    expect(state.foundCount).toBe(2);
  });

  it("a corner that blinks out for less than 500 ms is not new", () => {
    let state = found(INITIAL_CORNER_STATE, 50, 50);
    state = lost(state, 375);
    state = found(state, 52, 50);
    expect(state.foundCount).toBe(1);
  });

  it("the blink boundary: 499 ms is a blink, 500 ms is an absence", () => {
    let blink = found(INITIAL_CORNER_STATE, 50, 50);
    blink = lost(blink, 499);
    expect(found(blink, 50, 50).foundCount).toBe(1);
    let gone = found(INITIAL_CORNER_STATE, 50, 50);
    gone = lost(gone, 500);
    expect(found(gone, 50, 50).foundCount).toBe(2);
  });

  it("a corner that went back to the guide is new when found, and starts from where it is found", () => {
    let state = found(INITIAL_CORNER_STATE, 50, 50);
    state = lost(state, 1000);
    expect(state.point).toBeNull();
    state = found(state, 80, 90);
    expect(state.foundCount).toBe(2);
    expect(state.point).toEqual({ x: 80, y: 90 });
  });

  it("after a short blink the filter carries on from the last position (no snap to the sample, none to the guide)", () => {
    let state = found(INITIAL_CORNER_STATE, 100, 100);
    state = lost(state, 125);
    expect(state.velocity).toEqual({ x: 0, y: 0 });
    state = found(state, 200, 100);
    expect(state.point!.x).toBeGreaterThan(100);
    expect(state.point!.x).toBeLessThan(200);
    // Timed over the blink and the step (250 ms), not the step alone.
    let quick = found(INITIAL_CORNER_STATE, 100, 100);
    quick = found(quick, 200, 100, 250);
    expect(state.point!.x).toBeCloseTo(quick.point!.x, 9);
  });
});

describe("advanceCorners", () => {
  it("moves the four corners independently", () => {
    let states = advanceCorners(
      INITIAL_CORNER_STATES,
      [{ x: 30, y: 166 }, { x: 362, y: 166 }, null, null],
      STEP,
    );
    expect(states.map((s) => s.found)).toEqual([true, true, false, false]);
    expect(states.map((s) => s.foundCount)).toEqual([1, 1, 0, 0]);
    states = advanceCorners(
      states,
      [{ x: 30, y: 166 }, null, { x: 362, y: 640 }, null],
      STEP,
    );
    expect(states.map((s) => s.found)).toEqual([true, false, true, false]);
    // The top right keeps where it was while it is lost.
    expect(states[1].point).toEqual({ x: 362, y: 166 });
    expect(states[2].foundCount).toBe(1);
  });
});

describe("cornerDrawPoints: where the four dots are drawn", () => {
  const GUIDE_POINTS = [
    { x: 30, y: 166 },
    { x: 362, y: 166 },
    { x: 362, y: 640 },
    { x: 30, y: 640 },
  ] as const;
  const SEEN = [
    { x: 100, y: 200 },
    { x: 300, y: 210 },
    { x: 310, y: 600 },
    { x: 90, y: 590 },
  ] as const;

  it("every dot, the FIRST included, is drawn where its corner was seen, not at its guide", () => {
    const states = advanceCorners(INITIAL_CORNER_STATES, SEEN, STEP);
    const drawn = cornerDrawPoints(states, GUIDE_POINTS);
    expect(drawn).toEqual([...SEEN]);
    for (let i = 0; i < 4; i++) expect(drawn[i]).not.toEqual(GUIDE_POINTS[i]);
  });

  it("a dot with no position yet is drawn at its own guide point, and only that one", () => {
    const states = advanceCorners(
      INITIAL_CORNER_STATES,
      [null, SEEN[1], null, SEEN[3]],
      STEP,
    );
    expect(cornerDrawPoints(states, GUIDE_POINTS)).toEqual([
      GUIDE_POINTS[0],
      SEEN[1],
      GUIDE_POINTS[2],
      SEEN[3],
    ]);
  });

  it("the order is kept: result[i] belongs to states[i] and guide[i]", () => {
    const states = advanceCorners(
      INITIAL_CORNER_STATES,
      [SEEN[0], null, null, null],
      STEP,
    );
    const drawn = cornerDrawPoints(states, GUIDE_POINTS);
    expect(drawn[0]).toEqual(SEEN[0]);
    expect(drawn[1]).toEqual(GUIDE_POINTS[1]);
    expect(drawn[2]).toEqual(GUIDE_POINTS[2]);
    expect(drawn[3]).toEqual(GUIDE_POINTS[3]);
  });

  it("it agrees with cornerDrawPoint, dot by dot", () => {
    const states = advanceCorners(
      advanceCorners(INITIAL_CORNER_STATES, SEEN, STEP),
      [SEEN[0], null, { x: 305, y: 590 }, null],
      STEP,
    );
    const drawn = cornerDrawPoints(states, GUIDE_POINTS);
    for (let i = 0; i < 4; i++)
      expect(drawn[i]).toEqual(cornerDrawPoint(states[i], GUIDE_POINTS[i]));
  });
});
