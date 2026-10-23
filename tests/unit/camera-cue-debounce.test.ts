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
      confirmSamples: 2,
      switchConfirmSamples: 2,
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

  it("V3.2 F16: two cues that alternate sample by sample no longer swap the text", () => {
    const codes: CueCode[] = [];
    for (let i = 0; i < 24; i++)
      codes.push(i % 2 === 0 ? "hold-still" : "out-of-focus");
    expect(new Set(shownAfter(codes))).toEqual(new Set(["hold-still"]));
    // Two conflicting side lines: one sample's quad is tilted, the next's too small.
    const sides: CueCode[] = [];
    for (let i = 0; i < 24; i++) sides.push(i % 2 === 0 ? "tilted" : "too-far");
    expect(new Set(shownAfter(sides))).toEqual(new Set(["tilted"]));
  });

  it("the text changes no more often than every 500 ms between non-perfect cues", () => {
    // Each cue repeated twice (enough to be confirmed), flipping every 250 ms:
    // at most one change per 500 ms.
    const codes: CueCode[] = [];
    for (let i = 0; i < 24; i++)
      codes.push(Math.floor(i / 2) % 2 === 0 ? "hold-still" : "out-of-focus");
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
    // Confirmed (twice in a row, F16) but inside the lockout.
    state = advanceCueDebounce(state, "bright", 1375);
    state = advanceCueDebounce(state, "bright", 1499);
    expect(state.shown).toBe("tilted");
    state = advanceCueDebounce(state, "bright", 1500);
    expect(state.shown).toBe("bright");
  });

  it("V3.2 F16: an ordinary cue needs two samples in a row to replace another; one sample in between starts the count again", () => {
    let state = advanceCueDebounce(INITIAL_CUE_DEBOUNCE_STATE, "tilted", 1000);
    state = advanceCueDebounce(state, "dark", 2000);
    expect(state.shown).toBe("tilted");
    state = advanceCueDebounce(state, "too-far", 3000);
    expect(state.shown).toBe("tilted");
    state = advanceCueDebounce(state, "too-far", 4000);
    expect(state.shown).toBe("too-far");
    // The cue on screen coming back clears a half-made run.
    state = advanceCueDebounce(state, "dark", 5000);
    state = advanceCueDebounce(state, "too-far", 6000);
    state = advanceCueDebounce(state, "dark", 7000);
    expect(state.shown).toBe("too-far");
  });

  it("V3.2 F16: switchConfirmSamples is an option", () => {
    const base = advanceCueDebounce(INITIAL_CUE_DEBOUNCE_STATE, "tilted", 1000);
    const one = {
      leavePerfectSamples: 2,
      minTextChangeMs: 0,
      switchConfirmSamples: 1,
    };
    expect(advanceCueDebounce(base, "dark", 2000, one).shown).toBe("dark");
    const three = { ...one, switchConfirmSamples: 3 };
    let state = base;
    for (let i = 0; i < 2; i++)
      state = advanceCueDebounce(state, "dark", 2000 + i, three);
    expect(state.shown).toBe("tilted");
    state = advanceCueDebounce(state, "dark", 2003, three);
    expect(state.shown).toBe("dark");
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

describe("advanceCueDebounce: paper-gate cues need the same reason twice in a row (S1)", () => {
  // 1000 ms apart, so the 500 ms lockout never decides these tests.
  const SLOW = 1000;
  function feed(
    codes: readonly CueCode[],
    from: CueDebounceState = INITIAL_CUE_DEBOUNCE_STATE,
  ): CueDebounceState[] {
    const out: CueDebounceState[] = [];
    let state = from;
    codes.forEach((code, i) => {
      state = advanceCueDebounce(state, code, 10_000 + i * SLOW);
      out.push(state);
    });
    return out;
  }
  const shown = (codes: readonly CueCode[], from?: CueDebounceState) =>
    feed(codes, from).map((s) => s.shown);

  it("one sample of a covered edge does not replace the cue on screen; the second identical one does", () => {
    expect(
      shown(["hold-still", "edge-covered-left", "edge-covered-left"]),
    ).toEqual(["hold-still", "hold-still", "edge-covered-left"]);
  });

  it("confirms by REASON: two samples of a covered edge with different sides put up the plain text, not a side", () => {
    expect(
      shown([
        "hold-still",
        "edge-covered-left",
        "edge-covered-right",
        "edge-covered-right",
      ]),
    ).toEqual([
      "hold-still",
      "hold-still",
      "edge-covered",
      "edge-covered", // the one 'right' after it is not yet a second in a row
    ]);
  });

  it("a side that then holds still is named after two more samples", () => {
    expect(
      shown([
        "hold-still",
        "edge-covered-left",
        "edge-covered-right",
        "edge-covered-right",
        "edge-covered-right",
      ]).at(-1),
    ).toBe("edge-covered-right");
  });

  it("the plain 'an edge' sample and a named side count as the same reason; the plain text wins", () => {
    expect(
      shown([
        "hold-still",
        "edge-covered",
        "edge-covered-top",
        "edge-covered-top",
      ]),
    ).toEqual(["hold-still", "hold-still", "edge-covered", "edge-covered"]);
  });

  it("a covered edge and a curled paper are different reasons: each starts its own count", () => {
    expect(
      shown([
        "hold-still",
        "edge-covered-left",
        "paper-curled",
        "paper-curled",
      ]),
    ).toEqual(["hold-still", "hold-still", "hold-still", "paper-curled"]);
  });

  it("a different cue in between breaks the run", () => {
    expect(
      shown([
        "hold-still",
        "paper-curled",
        "out-of-focus",
        "paper-curled",
        "paper-curled",
      ]),
    ).toEqual([
      "hold-still",
      "hold-still",
      // One sample of an ordinary cue is not enough to replace another (F16).
      "hold-still",
      "hold-still",
      "paper-curled",
    ]);
  });

  it("a side that flips while one side is on screen settles on the plain text", () => {
    const base = feed(["edge-covered-left", "edge-covered-left"])[1];
    expect(base.shown).toBe("edge-covered-left");
    let state = base;
    const shownAfter: (CueCode | null)[] = [];
    (
      ["edge-covered-right", "edge-covered-left", "edge-covered-right"] as const
    ).forEach((code, i) => {
      state = advanceCueDebounce(state, code, 20_000 + i * SLOW);
      shownAfter.push(state.shown);
    });
    expect(shownAfter).toEqual([
      "edge-covered-left",
      "edge-covered",
      "edge-covered",
    ]);
  });

  describe("an alternating gate never leaves the screen on 'perfect' while the shutter is blocked", () => {
    const alternating = (a: CueCode, b: CueCode, n: number): CueCode[] =>
      Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b));

    it("left / bottom x8, from perfect: gone within 2 samples (1 s apart)", () => {
      const perfect = feed(["perfect"])[0];
      const states = feed(
        alternating("edge-covered-left", "edge-covered-bottom", 8),
        perfect,
      );
      expect(states[1].shown).toBe("edge-covered");
      for (const s of states.slice(1)) expect(s.shown).not.toBe("perfect");
    });

    it("left / plain x6, from perfect: gone within 2 samples (1 s apart)", () => {
      const perfect = feed(["perfect"])[0];
      const states = feed(
        alternating("edge-covered-left", "edge-covered", 6),
        perfect,
      );
      expect(states[1].shown).toBe("edge-covered");
      for (const s of states.slice(1)) expect(s.shown).not.toBe("perfect");
    });

    it("at the live 8 samples a second it is off 'perfect' as soon as the 500 ms lockout allows", () => {
      for (const pair of [
        ["edge-covered-left", "edge-covered-bottom"],
        ["edge-covered-left", "edge-covered"],
      ] as const) {
        let state = advanceCueDebounce(
          INITIAL_CUE_DEBOUNCE_STATE,
          "perfect",
          1000,
        );
        let leftAt: number | null = null;
        for (let i = 0; i < 8; i++) {
          const now = 1000 + (i + 1) * STEP;
          state = advanceCueDebounce(state, pair[i % 2], now);
          if (leftAt === null && state.shown !== "perfect") leftAt = now;
        }
        expect(leftAt).toBe(1500);
        expect(state.shown).toBe("edge-covered");
      }
    });
  });

  it("leaving 'perfect' for a paper-gate cue takes both rules: two samples, the same one", () => {
    const perfect = feed(["perfect"])[0];
    // Two different non-perfect samples are enough for the old rule, not for this one.
    expect(shown(["dark", "edge-covered-left"], perfect)).toEqual([
      "perfect",
      "perfect",
    ]);
    expect(shown(["edge-covered-left", "edge-covered-left"], perfect)).toEqual([
      "perfect",
      "edge-covered-left",
    ]);
  });

  it("the very first sample is held the same way when nothing is on screen yet", () => {
    const states = feed(["paper-curled", "paper-curled"]);
    expect(states.map((s) => s.shown)).toEqual([null, "paper-curled"]);
  });

  it("ordinary cues show at once on an empty screen; replacing another cue takes two in a row (F16)", () => {
    expect(shown(["no-corners", "tilted", "tilted"])).toEqual([
      "no-corners",
      "no-corners",
      "tilted",
    ]);
  });

  it("the lockout still applies after the second sample", () => {
    let state = advanceCueDebounce(INITIAL_CUE_DEBOUNCE_STATE, "tilted", 1000);
    state = advanceCueDebounce(state, "paper-curled", 1100);
    state = advanceCueDebounce(state, "paper-curled", 1200);
    expect(state.shown).toBe("tilted"); // confirmed, but only 200 ms after the last change
    state = advanceCueDebounce(state, "paper-curled", 1500);
    expect(state.shown).toBe("paper-curled");
  });

  it("confirmSamples is an option: 1 shows at once, 3 needs three", () => {
    const base = feed(["hold-still"])[0];
    expect(
      advanceCueDebounce(base, "paper-curled", 20_000, {
        leavePerfectSamples: 2,
        minTextChangeMs: 0,
        confirmSamples: 1,
      }).shown,
    ).toBe("paper-curled");
    let state = base;
    const three = {
      leavePerfectSamples: 2,
      minTextChangeMs: 0,
      confirmSamples: 3,
    };
    for (let i = 0; i < 2; i++)
      state = advanceCueDebounce(state, "paper-curled", 20_000 + i, three);
    expect(state.shown).toBe("hold-still");
    state = advanceCueDebounce(state, "paper-curled", 20_003, three);
    expect(state.shown).toBe("paper-curled");
  });

  it("the cue on screen repeating itself changes nothing (same state back)", () => {
    const on = feed(["edge-covered-left", "edge-covered-left"])[1];
    expect(advanceCueDebounce(on, "edge-covered-left", 99_000)).toBe(on);
  });
});
