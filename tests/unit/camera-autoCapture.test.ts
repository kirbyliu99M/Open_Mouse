import { describe, expect, it } from "vitest";
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  autoCaptureRingFraction,
  resetAutoCapture,
} from "../../src/client/camera/autoCapture";

describe("advanceAutoCapture", () => {
  it("starts at zero elapsed, no failures and not fired", () => {
    expect(INITIAL_AUTO_CAPTURE_STATE).toEqual({
      elapsedMs: 0,
      failStreak: 0,
      fired: false,
    });
  });

  it("accumulates elapsed time while every check passes", () => {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    state = advanceAutoCapture(state, true, 300);
    expect(state).toEqual({ elapsedMs: 300, failStreak: 0, fired: false });
    state = advanceAutoCapture(state, true, 300);
    expect(state).toEqual({ elapsedMs: 600, failStreak: 0, fired: false });
  });

  it("fires at exactly 800ms of passing samples", () => {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    state = advanceAutoCapture(state, true, 799);
    expect(state.fired).toBe(false);
    state = advanceAutoCapture(state, true, 1);
    expect(state).toEqual({ elapsedMs: 800, failStreak: 0, fired: true });
  });

  it("fires when a single sample crosses the 800ms duration", () => {
    const state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 1000);
    expect(state).toEqual({ elapsedMs: 800, failStreak: 0, fired: true });
  });

  it("one failing sample only pauses the ring: nothing is added, nothing is lost", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 700);
    state = advanceAutoCapture(state, false, 125);
    expect(state).toEqual({ elapsedMs: 700, failStreak: 1, fired: false });
    expect(autoCaptureRingFraction(state)).toBeCloseTo(0.875, 5);
  });

  it("two failing samples in a row still only pause it", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 500);
    state = advanceAutoCapture(state, false, 125);
    state = advanceAutoCapture(state, false, 125);
    expect(state).toEqual({ elapsedMs: 500, failStreak: 2, fired: false });
  });

  it("the third failing sample in a row empties the ring", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 700);
    state = advanceAutoCapture(state, false, 125);
    state = advanceAutoCapture(state, false, 125);
    state = advanceAutoCapture(state, false, 125);
    expect(state).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });

  it("a passing sample clears the streak, so failures must be consecutive to count", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 300);
    for (let round = 0; round < 5; round++) {
      state = advanceAutoCapture(state, false, 125);
      state = advanceAutoCapture(state, false, 125);
      state = advanceAutoCapture(state, true, 0);
      expect(state.failStreak).toBe(0);
    }
    // Ten failures in all, never three in a row: still holding its 300 ms.
    expect(state.elapsedMs).toBe(300);
  });

  it("the fill is still 800 ms of PASSING samples: paused samples add no time", () => {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    for (let i = 0; i < 4; i++) state = advanceAutoCapture(state, true, 125);
    state = advanceAutoCapture(state, false, 125);
    state = advanceAutoCapture(state, false, 125);
    for (let i = 0; i < 2; i++) state = advanceAutoCapture(state, true, 125);
    expect(state.fired).toBe(false);
    expect(state.elapsedMs).toBe(750);
    state = advanceAutoCapture(state, true, 125);
    expect(state.fired).toBe(true);
  });

  it("takes the tolerance as a parameter: 1 is the old reset-on-any-failure", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 799);
    state = advanceAutoCapture(state, false, 1, 800, 1);
    expect(state).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });

  it("a failure one sample before firing pauses, then the next pass fires", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 799);
    state = advanceAutoCapture(state, false, 1);
    expect(state.elapsedMs).toBe(799);
    expect(state.fired).toBe(false);
    state = advanceAutoCapture(state, true, 1);
    expect(state.fired).toBe(true);
  });

  it("stays fired and ignores further advances until explicitly reset", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 800);
    expect(state.fired).toBe(true);
    for (let i = 0; i < 5; i++) state = advanceAutoCapture(state, false, 500);
    expect(state.fired).toBe(true);
    expect(state.elapsedMs).toBe(800);
  });

  it("rejects a negative dt", () => {
    expect(() =>
      advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, -1),
    ).toThrow(RangeError);
  });
});

describe("resetAutoCapture", () => {
  it("returns the initial state", () => {
    expect(resetAutoCapture()).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });
});

describe("autoCaptureRingFraction", () => {
  it("is 0 at the start", () => {
    expect(autoCaptureRingFraction(INITIAL_AUTO_CAPTURE_STATE)).toBe(0);
  });

  it("is 0.5 halfway through", () => {
    const state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 400);
    expect(autoCaptureRingFraction(state)).toBeCloseTo(0.5, 5);
  });

  it("is capped at 1", () => {
    const state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 800);
    expect(autoCaptureRingFraction(state)).toBe(1);
  });
});
