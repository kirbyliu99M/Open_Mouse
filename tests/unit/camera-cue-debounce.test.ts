import { describe, expect, it } from "vitest";
import {
  INITIAL_CUE_DEBOUNCE_STATE,
  advanceCueDebounce,
  type CueDebounceState,
} from "../../src/client/camera/cueDebounce";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import type { CueCode } from "../../src/client/camera/cues";

const STEP = 125; // 8 samples per second

/** Feeds `codes` one per sample from `startMs`; returns the state after each. */
function run(
  codes: readonly CueCode[],
  from: CueDebounceState = INITIAL_CUE_DEBOUNCE_STATE,
  startMs = 1000,
): CueDebounceState[] {
  const states: CueDebounceState[] = [];
  let state = from;
  codes.forEach((code, i) => {
    state = advanceCueDebounce(state, code, startMs + i * STEP);
    states.push(state);
  });
  return states;
}

const shownAfter = (codes: readonly CueCode[], from?: CueDebounceState) =>
  run(codes, from).map((s) => s.shown);

describe("advanceCueDebounce", () => {
  it("starts empty and shows the first sample at once", () => {
    expect(INITIAL_CUE_DEBOUNCE_STATE.shown).toBeNull();
    expect(shownAfter(["no-corners"])).toEqual(["no-corners"]);
  });

  it("uses the constants: 2 samples to leave perfect, 500 ms between changes", () => {
    expect(CAMERA_CONSTANTS.cueDebounce).toEqual({
      leavePerfectSamples: 2,
      minTextChangeMs: 500,
    });
  });

  it("a change to 'perfect' shows at once, with no delay of any kind", () => {
    const [first, second] = run(["no-corners", "perfect"]);
    expect(first.shown).toBe("no-corners");
    // Only 125 ms after the first text: well inside the 500 ms lockout.
    expect(second.shown).toBe("perfect");
  });

  it("one non-perfect sample does not replace 'perfect'", () => {
    const states = run(["perfect", "hold-still"]);
    expect(states.map((s) => s.shown)).toEqual(["perfect", "perfect"]);
    expect(states[1].offPerfectStreak).toBe(1);
  });

  it("two consecutive non-perfect samples replace 'perfect' (once 500 ms have passed)", () => {
    // 'perfect' adopted at 1000; leaving needs two samples AND 500 ms.
    const start = run(["perfect"]);
    const at1500 = advanceCueDebounce(start[0], "hold-still", 1500 - STEP);
    expect(at1500.shown).toBe("perfect");
    const leaves = advanceCueDebounce(at1500, "hold-still", 1500);
    expect(leaves.shown).toBe("hold-still");
    expect(leaves.shownAtMs).toBe(1500);
    expect(leaves.offPerfectStreak).toBe(0);
  });

  it("the boundary is inclusive: exactly 500 ms after the last change is allowed, 499 ms is not", () => {
    const base = run(["perfect"])[0]; // shown at 1000
    let held = advanceCueDebounce(base, "dark", 1250);
    held = advanceCueDebounce(held, "dark", 1499);
    expect(held.shown).toBe("perfect");
    expect(advanceCueDebounce(held, "dark", 1500).shown).toBe("dark");
  });

  it("a perfect sample in between resets the count: the failures must be consecutive", () => {
    const states = run(["perfect", "dark", "perfect", "dark", "perfect"]);
    expect(states.map((s) => s.shown)).toEqual([
      "perfect",
      "perfect",
      "perfect",
      "perfect",
      "perfect",
    ]);
    expect(states[2].offPerfectStreak).toBe(0);
  });

  it("different non-perfect codes still count toward leaving 'perfect'", () => {
    // The ring resets on consecutive failures of any kind, so the words follow.
    const perfect = run(["perfect"])[0];
    let state = advanceCueDebounce(perfect, "dark", 1000 + 300);
    state = advanceCueDebounce(state, "hold-still", 1000 + 600);
    expect(state.shown).toBe("hold-still");
  });

  it("the text changes no more often than every 500 ms between non-perfect cues", () => {
    // A sample that flips every 125 ms: at most one change per 500 ms.
    const codes: CueCode[] = [];
    for (let i = 0; i < 24; i++)
      codes.push(i % 2 === 0 ? "hold-still" : "out-of-focus");
    const states = run(codes);
    const changeTimes: number[] = [];
    let previous: CueCode | null = null;
    states.forEach((s, i) => {
      if (s.shown !== previous) changeTimes.push(1000 + i * STEP);
      previous = s.shown;
    });
    for (let i = 1; i < changeTimes.length; i++) {
      expect(changeTimes[i] - changeTimes[i - 1]).toBeGreaterThanOrEqual(500);
    }
    expect(changeTimes.length).toBeGreaterThan(2);
  });

  it("holds a wanted change until the lockout ends, then takes the CURRENT sample", () => {
    let state = advanceCueDebounce(INITIAL_CUE_DEBOUNCE_STATE, "tilted", 1000);
    state = advanceCueDebounce(state, "too-far", 1125);
    expect(state.shown).toBe("tilted");
    state = advanceCueDebounce(state, "dark", 1499);
    expect(state.shown).toBe("tilted");
    state = advanceCueDebounce(state, "bright", 1500);
    expect(state.shown).toBe("bright");
  });

  it("does nothing for the same code, and never moves the change time", () => {
    const first = run(["tilted"])[0];
    const again = advanceCueDebounce(first, "tilted", 9000);
    expect(again).toBe(first);
  });

  it("'perfect' held for a long time still needs the two samples to be left", () => {
    const perfect = run(["perfect"])[0];
    const once = advanceCueDebounce(perfect, "hold-still", 60_000);
    expect(once.shown).toBe("perfect");
    const twice = advanceCueDebounce(once, "hold-still", 60_125);
    expect(twice.shown).toBe("hold-still");
  });

  it("takes options: a single sample can be enough", () => {
    const perfect = run(["perfect"])[0];
    const next = advanceCueDebounce(perfect, "dark", 2000, {
      leavePerfectSamples: 1,
      minTextChangeMs: 0,
    });
    expect(next.shown).toBe("dark");
  });

  it("coming back to 'perfect' after leaving it shows at once even inside the lockout", () => {
    let state = run(["perfect"])[0];
    state = advanceCueDebounce(state, "dark", 1500);
    state = advanceCueDebounce(state, "dark", 1625);
    expect(state.shown).toBe("dark");
    state = advanceCueDebounce(state, "perfect", 1750);
    expect(state.shown).toBe("perfect");
  });
});
