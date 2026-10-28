import { describe, expect, it } from "vitest";
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  autoCaptureRingFraction,
  resetAutoCapture,
} from "../../src/client/camera/autoCapture";
import { pickCue, type CueInput } from "../../src/client/camera/cues";
import type { LivePaperGate } from "../../src/client/camera/paperGate";

/**
 * The ring's mechanics at an 800 ms fill (its length until 2026-10-26): the
 * pause, the emptying and the firing do not depend on the length. The fill
 * the camera uses (2.5 s since Kirby's S25 test) is checked in
 * best-frame.test.ts.
 */
const RING_MS = 800;
const adv = (
  state: Parameters<typeof advanceAutoCapture>[0],
  passing: boolean,
  dtMs: number,
) => advanceAutoCapture(state, passing, dtMs, RING_MS);
const frac = (state: Parameters<typeof autoCaptureRingFraction>[0]) =>
  autoCaptureRingFraction(state, RING_MS);

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
    state = adv(state, true, 300);
    expect(state).toEqual({ elapsedMs: 300, failStreak: 0, fired: false });
    state = adv(state, true, 300);
    expect(state).toEqual({ elapsedMs: 600, failStreak: 0, fired: false });
  });

  it("fires at exactly 800ms of passing samples", () => {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    state = adv(state, true, 799);
    expect(state.fired).toBe(false);
    state = adv(state, true, 1);
    expect(state).toEqual({ elapsedMs: 800, failStreak: 0, fired: true });
  });

  it("fires when a single sample crosses the 800ms duration", () => {
    const state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 1000);
    expect(state).toEqual({ elapsedMs: 800, failStreak: 0, fired: true });
  });

  it("one failing sample only pauses the ring: nothing is added, nothing is lost", () => {
    let state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 700);
    state = adv(state, false, 125);
    expect(state).toEqual({ elapsedMs: 700, failStreak: 1, fired: false });
    expect(frac(state)).toBeCloseTo(0.875, 5);
  });

  it("two failing samples in a row still only pause it", () => {
    let state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 500);
    state = adv(state, false, 125);
    state = adv(state, false, 125);
    expect(state).toEqual({ elapsedMs: 500, failStreak: 2, fired: false });
  });

  it("the third failing sample in a row empties the ring", () => {
    let state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 700);
    state = adv(state, false, 125);
    state = adv(state, false, 125);
    state = adv(state, false, 125);
    expect(state).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });

  it("a passing sample clears the streak, so failures must be consecutive to count", () => {
    let state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 300);
    for (let round = 0; round < 5; round++) {
      state = adv(state, false, 125);
      state = adv(state, false, 125);
      state = adv(state, true, 0);
      expect(state.failStreak).toBe(0);
    }
    // Ten failures in all, never three in a row: still holding its 300 ms.
    expect(state.elapsedMs).toBe(300);
  });

  it("the fill is still 800 ms of PASSING samples: paused samples add no time", () => {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    for (let i = 0; i < 4; i++) state = adv(state, true, 125);
    state = adv(state, false, 125);
    state = adv(state, false, 125);
    for (let i = 0; i < 2; i++) state = adv(state, true, 125);
    expect(state.fired).toBe(false);
    expect(state.elapsedMs).toBe(750);
    state = adv(state, true, 125);
    expect(state.fired).toBe(true);
  });

  it("takes the tolerance as a parameter: 1 is the old reset-on-any-failure", () => {
    let state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 799);
    state = advanceAutoCapture(state, false, 1, 800, 1);
    expect(state).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });

  it("a failure one sample before firing pauses, then the next pass fires", () => {
    let state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 799);
    state = adv(state, false, 1);
    expect(state.elapsedMs).toBe(799);
    expect(state.fired).toBe(false);
    state = adv(state, true, 1);
    expect(state.fired).toBe(true);
  });

  it("stays fired and ignores further advances until explicitly reset", () => {
    let state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 800);
    expect(state.fired).toBe(true);
    for (let i = 0; i < 5; i++) state = adv(state, false, 500);
    expect(state.fired).toBe(true);
    expect(state.elapsedMs).toBe(800);
  });

  it("rejects a negative dt", () => {
    expect(() => adv(INITIAL_AUTO_CAPTURE_STATE, true, -1)).toThrow(RangeError);
  });
});

describe("resetAutoCapture", () => {
  it("returns the initial state", () => {
    expect(resetAutoCapture()).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });
});

describe("autoCaptureRingFraction", () => {
  it("is 0 at the start", () => {
    expect(frac(INITIAL_AUTO_CAPTURE_STATE)).toBe(0);
  });

  it("is 0.5 halfway through", () => {
    const state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 400);
    expect(frac(state)).toBeCloseTo(0.5, 5);
  });

  it("is capped at 1", () => {
    const state = adv(INITIAL_AUTO_CAPTURE_STATE, true, 800);
    expect(frac(state)).toBe(1);
  });
});

describe("the shutter reads the raw paper gate (S1)", () => {
  const input = (paperGate?: LivePaperGate): CueInput => ({
    cornersSeen: 4,
    quad: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 500 },
      bottomLeft: { x: 100, y: 500 },
    },
    frameWidth: 640,
    meanLuma: 120,
    clippedFraction: 0,
    steady: true,
    sharpEnough: true,
    paperGate,
    msSinceLastDetection: 0,
  });
  /** What the live loop does per sample: the cue's own verdict feeds the ring. */
  function ring(gates: readonly (LivePaperGate | undefined)[], dtMs = 125) {
    let state = INITIAL_AUTO_CAPTURE_STATE;
    for (const gate of gates) {
      const cue = pickCue(input(gate), "paper-edge", "en");
      state = adv(state, cue.allPass, dtMs);
    }
    return state;
  }
  const PASS: LivePaperGate = { kind: "pass" };

  it("does not fire while the gate keeps failing, however long the preview waits", () => {
    const failing: LivePaperGate[] = [
      { kind: "edge-covered", side: "left" },
      { kind: "edge-covered", side: null },
      { kind: "curled" },
    ];
    for (const bad of failing) {
      const state = ring(Array.from({ length: 80 }, () => bad)); // 10 s of samples
      expect(state.fired, bad.kind).toBe(false);
      expect(state.elapsedMs).toBe(0);
    }
  });

  it("fires on a passing gate, and on a flow without the field", () => {
    expect(ring(Array.from({ length: 8 }, () => PASS)).fired).toBe(true);
    expect(ring(Array.from({ length: 8 }, () => undefined)).fired).toBe(true);
  });

  it("a gate that fails on the way to the fill pauses it, and three failures in a row empty it", () => {
    const bad: LivePaperGate = { kind: "edge-covered", side: "top" };
    // 4 passes (500 ms), 2 failures (paused), 3 passes: 875 ms of passing time.
    const paused = ring([PASS, PASS, PASS, PASS, bad, bad, PASS, PASS, PASS]);
    expect(paused.fired).toBe(true);
    // 4 passes, then 3 failures in a row: back to empty, not fired.
    const emptied = ring([PASS, PASS, PASS, PASS, bad, bad, bad]);
    expect(emptied).toEqual(INITIAL_AUTO_CAPTURE_STATE);
  });
});
