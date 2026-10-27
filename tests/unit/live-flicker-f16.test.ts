/**
 * V3.2 F16 (candidate, 未拍板): conflicting side lines must not make the live
 * outline or the cue flicker (Kirby, preview 6: "If the side lines conflict, it
 * may cause flickers"), and a phone held too high gets a steady "move closer".
 * Display only: the detector, the paper gate, the ring and the cue CODE of
 * each sample are not touched (the last describe block checks that).
 */
import { describe, expect, it } from "vitest";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import {
  advanceCorners,
  cornerDrawPoints,
  INITIAL_CORNER_STATES,
  type CornerStates,
} from "../../src/client/camera/cornerSmoother";
import {
  advanceCueDebounce,
  INITIAL_CUE_DEBOUNCE_STATE,
  type CueDebounceState,
} from "../../src/client/camera/cueDebounce";
import {
  pickCue,
  type CueCode,
  type CueInput,
} from "../../src/client/camera/cues";
import {
  advanceOutline,
  continuesMotion,
  INITIAL_OUTLINE_HYSTERESIS_STATE,
  largestCornerGap,
  oneStepBack,
  predictOutline,
  type OutlineHysteresisState,
  type OutlineObservation,
} from "../../src/client/camera/outlineHysteresis";
import type { Point } from "../../src/client/camera/quad";

const STEP = 125; // 8 samples a second
const DIAGONAL = Math.hypot(400, 711); // a phone stage, px

const quad = (dx: number, dy = 0): OutlineObservation => [
  { x: 60 + dx, y: 120 + dy },
  { x: 340 + dx, y: 120 + dy },
  { x: 340 + dx, y: 520 + dy },
  { x: 60 + dx, y: 520 + dy },
];
/** The paper's quad, and the same sheet with one side on a line 40 px out (a shadow, the desk's edge). */
const A = quad(0);
const B: OutlineObservation = [
  A[0],
  { x: 380, y: 120 },
  { x: 380, y: 520 },
  A[3],
];
const TWO_CORNERS: OutlineObservation = [A[0], null, null, A[3]];

function feed(observations: readonly OutlineObservation[]) {
  let state: OutlineHysteresisState = INITIAL_OUTLINE_HYSTERESIS_STATE;
  let corners: CornerStates = INITIAL_CORNER_STATES;
  let raw: CornerStates = INITIAL_CORNER_STATES;
  const drawn: Point[][] = [];
  const rawDrawn: Point[][] = [];
  const found: boolean[][] = [];
  const rawFound: boolean[][] = [];
  for (const o of observations) {
    const step = advanceOutline(state, o, DIAGONAL);
    state = step.state;
    corners = advanceCorners(corners, step.shown, STEP);
    raw = advanceCorners(raw, o, STEP);
    drawn.push([...cornerDrawPoints(corners, A as never)]);
    rawDrawn.push([...cornerDrawPoints(raw, A as never)]);
    found.push(corners.map((c) => c.found));
    rawFound.push(raw.map((c) => c.found));
  }
  return { drawn, rawDrawn, found, rawFound, state };
}

/** The largest move of any dot between consecutive samples, after `from` samples. */
function largestStep(frames: readonly Point[][], from: number): number {
  let worst = 0;
  for (let i = Math.max(1, from); i < frames.length; i++)
    for (let c = 0; c < 4; c++)
      worst = Math.max(
        worst,
        Math.hypot(
          frames[i][c].x - frames[i - 1][c].x,
          frames[i][c].y - frames[i - 1][c].y,
        ),
      );
  return worst;
}

const alternate = <T>(a: T, b: T, n: number): T[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b));

describe("the live outline's hysteresis (pure)", () => {
  it("uses the named constants", () => {
    expect(CAMERA_CONSTANTS.outlineHysteresis).toEqual({
      jumpFraction: 0.03,
      switchSamples: 2,
      lostSamples: 3,
      continueFraction: 0.025,
    });
    // A still outline predicts itself, so no jump may fit it.
    expect(CAMERA_CONSTANTS.outlineHysteresis.continueFraction).toBeLessThan(
      CAMERA_CONSTANTS.outlineHysteresis.jumpFraction,
    );
  });

  it("the problem: two quads 40 px apart that alternate make the dots swing every sample (without the hysteresis)", () => {
    const { rawDrawn } = feed(alternate(A, B, 40));
    // The filter settles into a swing of 0.35 / 1.65 of the gap: about 8.5 px each sample.
    expect(largestStep(rawDrawn, 20)).toBeGreaterThan(8);
  });

  it("with it: the same alternation leaves the dots still (no move over 0.01 px after the first sample)", () => {
    const { drawn } = feed(alternate(A, B, 40));
    expect(largestStep(drawn, 1)).toBeLessThan(0.01);
  });

  it("four corners / two corners alternating: the dots stay found, the edges stay on (without it they blink)", () => {
    const { found, rawFound } = feed(alternate(A, TWO_CORNERS, 40));
    expect(found.slice(1).every((f) => f.every(Boolean))).toBe(true);
    expect(rawFound.slice(1).some((f) => !f.every(Boolean))).toBe(true);
  });

  it("a real move is followed one sample late, then smoothly", () => {
    const moved = quad(60, 40);
    const obs = [A, A, A, moved, moved, moved, moved];
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    const shown: OutlineObservation[] = [];
    for (const o of obs) {
      const s = advanceOutline(state, o, DIAGONAL);
      state = s.state;
      shown.push(s.shown);
    }
    expect(shown[3]).toEqual(A);
    expect(shown[4]).toEqual(moved);
    expect(shown[6]).toEqual(moved);
  });

  it("a phone that keeps moving is followed at EVERY sample after the first (2026-10-28; it was every other one)", () => {
    const step = 0.06 * DIAGONAL; // twice the jump threshold per sample
    const obs = [
      A,
      A,
      ...Array.from({ length: 10 }, (_, k) => quad((k + 1) * step)),
    ];
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    const shown: OutlineObservation[] = [];
    for (const o of obs) {
      const s = advanceOutline(state, o, DIAGONAL);
      state = s.state;
      shown.push(s.shown);
    }
    // The first jump is held (it could be a second quad)...
    expect(shown[2]).toEqual(A);
    // ...the second is followed, and from then on every sample.
    for (let k = 3; k < obs.length; k++) expect(shown[k]).toEqual(obs[k]);
  });

  it("...with the detector's jitter on it too (3 px per corner)", () => {
    const step = 0.05 * DIAGONAL;
    const wobble = (k: number) => (k % 2 === 0 ? 3 : -3);
    const obs = [
      A,
      A,
      ...Array.from({ length: 12 }, (_, k) =>
        quad((k + 1) * step + wobble(k), wobble(k + 1)),
      ),
    ];
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    let followed = 0;
    obs.forEach((o, k) => {
      const s = advanceOutline(state, o, DIAGONAL);
      state = s.state;
      if (k >= 3 && largestCornerGap(s.shown, o) === 0) followed += 1;
    });
    expect(followed).toBe(obs.length - 3);
  });

  it("the old rule, for comparison: following every other sample is what a reset streak did", () => {
    const step = 0.06 * DIAGONAL;
    const obs = [
      A,
      A,
      ...Array.from({ length: 10 }, (_, k) => quad((k + 1) * step)),
    ];
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    let held = 0;
    for (const o of obs) {
      const s = advanceOutline(state, o, DIAGONAL, {
        ...CAMERA_CONSTANTS.outlineHysteresis,
        continueFraction: Infinity, // not under jumpFraction: never continues
      });
      state = s.state;
      if (largestCornerGap(s.shown, o) !== 0) held += 1;
    }
    expect(held).toBe(5);
  });

  it("two quads alternating during a move are still held: a second quad is not where the move was heading", () => {
    const step = 0.06 * DIAGONAL;
    const moving = [A, A, quad(step), quad(2 * step), quad(3 * step)];
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    for (const o of moving) state = advanceOutline(state, o, DIAGONAL).state;
    // The sheet stops at 3 steps; a shadow's quad 40 px wider alternates with it.
    const stop = quad(3 * step);
    const shadow: OutlineObservation = [
      stop[0],
      { x: stop[1]!.x + 40, y: stop[1]!.y },
      { x: stop[2]!.x + 40, y: stop[2]!.y },
      stop[3],
    ];
    const shown: OutlineObservation[] = [];
    for (const o of alternate(shadow, stop, 20)) {
      const s = advanceOutline(state, o, DIAGONAL);
      state = s.state;
      shown.push(s.shown);
    }
    expect(
      shown.every((q) => q === stop || largestCornerGap(q, stop) === 0),
    ).toBe(true);
  });

  it("the A/B alternation from rest is held exactly as before", () => {
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    for (const o of alternate(A, B, 40)) {
      const s = advanceOutline(state, o, DIAGONAL);
      state = s.state;
      expect(largestCornerGap(s.shown, A)).toBe(0);
    }
  });

  it("predictOutline and oneStepBack: the last step made again, per corner both have", () => {
    expect(predictOutline(quad(10), quad(0))).toEqual(quad(20));
    expect(
      predictOutline([A[0], null, A[2], A[3]], [A[0], A[1], null, A[3]]),
    ).toEqual([A[0], null, null, A[3]]);
    expect(oneStepBack(quad(0), quad(30), 3)).toEqual(quad(20));
    expect(oneStepBack(quad(0), quad(30), 0)).toEqual(quad(0));
  });

  it("continuesMotion needs two corners: one is no safe match", () => {
    const state: OutlineHysteresisState = {
      ...INITIAL_OUTLINE_HYSTERESIS_STATE,
      held: quad(10),
      previous: [quad(0)[0], null, null, null],
    };
    expect(continuesMotion(state, quad(20), DIAGONAL)).toBe(false);
    expect(
      continuesMotion({ ...state, previous: quad(0) }, quad(20), DIAGONAL),
    ).toBe(true);
  });

  it("small movement (under 3 % of the diagonal) passes straight through", () => {
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    state = advanceOutline(state, A, DIAGONAL).state;
    const nudged = quad(0.02 * DIAGONAL);
    expect(advanceOutline(state, nudged, DIAGONAL).shown).toEqual(nudged);
  });

  it("a relabel (the detector's cyclic shift) is matched, not taken for a jump", () => {
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    state = advanceOutline(state, A, DIAGONAL).state;
    const relabelled: OutlineObservation = [A[2], A[3], A[0], A[1]];
    const s = advanceOutline(state, relabelled, DIAGONAL);
    expect(s.shown).toEqual(A);
    expect(s.state.jumpStreak).toBe(0);
  });

  it("a corner really lost goes hollow after three samples, not at once", () => {
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    state = advanceOutline(state, A, DIAGONAL).state;
    const shown: OutlineObservation[] = [];
    for (let i = 0; i < 4; i++) {
      const s = advanceOutline(state, TWO_CORNERS, DIAGONAL);
      state = s.state;
      shown.push(s.shown);
    }
    expect(shown[0][1]).toEqual(A[1]);
    expect(shown[1][1]).toEqual(A[1]);
    expect(shown[2][1]).toBeNull();
    expect(shown[3][1]).toBeNull();
  });

  it("after a jump is followed, nothing of the old quad is kept for a missing corner", () => {
    let state = INITIAL_OUTLINE_HYSTERESIS_STATE;
    state = advanceOutline(state, A, DIAGONAL).state;
    const far: OutlineObservation = [
      { x: 160, y: 220 },
      null,
      null,
      { x: 160, y: 620 },
    ];
    state = advanceOutline(state, far, DIAGONAL).state;
    const s = advanceOutline(state, far, DIAGONAL);
    expect(s.shown).toEqual(far);
  });

  it("largestCornerGap reads only the corners both have", () => {
    expect(largestCornerGap(A, TWO_CORNERS)).toBe(0);
    expect(largestCornerGap(A, B)).toBe(40);
    expect(largestCornerGap([null, null, null, null], A)).toBeNull();
  });
});

describe("the cue line under two conflicting detections", () => {
  function shownOver(codes: readonly CueCode[], from?: CueCode) {
    let s: CueDebounceState = INITIAL_CUE_DEBOUNCE_STATE;
    let t = 0;
    if (from) s = advanceCueDebounce(s, from, t);
    const out: (CueCode | null)[] = [];
    for (const code of codes) {
      t += STEP;
      s = advanceCueDebounce(s, code, t);
      out.push(s.shown);
    }
    return out;
  }
  const changes = (shown: readonly (CueCode | null)[]) =>
    shown.filter((c, i) => i > 0 && c !== shown[i - 1]).length;

  it("tilted / too-far alternating for 5 s: the text never changes", () => {
    const shown = shownOver(
      alternate<CueCode>("tilted", "too-far", 40),
      "tilted",
    );
    expect(changes(shown)).toBe(0);
  });

  it("from 'perfect', an alternating pair still leaves 'perfect' (the shutter is blocked), then holds", () => {
    const shown = shownOver(
      alternate<CueCode>("tilted", "too-far", 40),
      "perfect",
    );
    expect(shown.at(-1)).not.toBe("perfect");
    expect(changes(shown)).toBe(1);
  });

  it("a covered side that flips settles on the plain text and stays there (S1, unchanged)", () => {
    const shown = shownOver(
      alternate<CueCode>("edge-covered-left", "edge-covered-right", 40),
    );
    expect(shown.at(-1)).toBe("edge-covered");
    expect(changes(shown.slice(4))).toBe(0);
  });
});

describe("a phone held too high: the too-small cue (F16 item 3.2)", () => {
  const farInput = (paperStage: CueInput["paperStage"]): CueInput => ({
    cornersSeen: 0,
    quad: null,
    frameWidth: 360,
    meanLuma: 140,
    clippedFraction: 0,
    steady: true,
    sharpEnough: true,
    paperStage,
    sheetSeenYet: true,
    msSinceLastDetection: 3000,
  });

  it("the detector's too_small stage gives the 'move closer' cue (the gate's threshold is not touched)", () => {
    expect(pickCue(farInput("too_small"), "paper-edge", "zh-TW").code).toBe(
      "stage-too-small",
    );
  });

  it("held for 5 s it goes up after two samples and stays", () => {
    let s: CueDebounceState = INITIAL_CUE_DEBOUNCE_STATE;
    s = advanceCueDebounce(s, "no-corners", 0);
    const shown: (CueCode | null)[] = [];
    for (let i = 1; i <= 40; i++) {
      s = advanceCueDebounce(
        s,
        pickCue(farInput("too_small"), "paper-edge", "zh-TW").code,
        i * STEP,
      );
      shown.push(s.shown);
    }
    expect(shown.slice(4).every((c) => c === "stage-too-small")).toBe(true);
  });

  it("one stray split sample among too_small ones does not flip the words to the plain text and back", () => {
    let s: CueDebounceState = INITIAL_CUE_DEBOUNCE_STATE;
    s = advanceCueDebounce(s, "stage-too-small", 0);
    s = advanceCueDebounce(s, "stage-too-small", STEP);
    expect(s.shown).toBe("stage-too-small");
    const stream: CueCode[] = [];
    for (let i = 0; i < 40; i++)
      stream.push(i % 5 === 2 ? "stage-region-split" : "stage-too-small");
    const shown: (CueCode | null)[] = [];
    stream.forEach((code, i) => {
      s = advanceCueDebounce(s, code, (i + 2) * STEP);
      shown.push(s.shown);
    });
    expect(new Set(shown)).toEqual(new Set(["stage-too-small"]));
  });

  it("before any sheet was seen there is no stage cue (S2's rule, kept: a white mug also reads too_small)", () => {
    expect(
      pickCue(
        { ...farInput("too_small"), sheetSeenYet: false },
        "paper-edge",
        "zh-TW",
      ).code,
    ).toBe("place-paper");
  });
});
