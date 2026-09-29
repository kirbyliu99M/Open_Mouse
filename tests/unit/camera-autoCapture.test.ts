import { describe, expect, it } from "vitest";
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  autoCaptureRingFraction,
  resetAutoCapture,
} from "../../src/client/camera/autoCapture";

describe("advanceAutoCapture", () => {
  it("starts at zero elapsed and not fired", () => {
    expect(INITIAL_AUTO_CAPTURE_STATE).toEqual({ elapsedMs: 0, fired: false });
  });

  it("accumulates elapsed time while every check passes", () => {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    state = advanceAutoCapture(state, true, 300);
    expect(state).toEqual({ elapsedMs: 300, fired: false });
    state = advanceAutoCapture(state, true, 300);
    expect(state).toEqual({ elapsedMs: 600, fired: false });
  });

  it("fires at exactly 800ms of continuous passing", () => {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    state = advanceAutoCapture(state, true, 799);
    expect(state.fired).toBe(false);
    state = advanceAutoCapture(state, true, 1);
    expect(state).toEqual({ elapsedMs: 800, fired: true });
  });

  it("fires when a single sample crosses the 800ms duration", () => {
    const state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 1000);
    expect(state).toEqual({ elapsedMs: 800, fired: true });
  });

  it("resets to zero on any failing sample", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 700);
    expect(state.elapsedMs).toBe(700);
    state = advanceAutoCapture(state, false, 100);
    expect(state).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });

  it("resets even one sample before firing", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 799);
    state = advanceAutoCapture(state, false, 1);
    expect(state.elapsedMs).toBe(0);
    expect(state.fired).toBe(false);
  });

  it("stays fired and ignores further advances until explicitly reset", () => {
    let state = advanceAutoCapture(INITIAL_AUTO_CAPTURE_STATE, true, 800);
    expect(state.fired).toBe(true);
    state = advanceAutoCapture(state, false, 500);
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
