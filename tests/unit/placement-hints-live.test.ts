/**
 * V3.3 WP3a (candidate 未拍板): the live hand hints. `pickCue`'s order with a
 * hand (one case per layer), the per-reading hysteresis, staleness, the
 * switches, the §4.3 bottom-edge rule, and that the ring never waits on a
 * hand hint. Design: F20 DESIGN-placement-guidance §4.1, §4.3, §4.4.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  pickCue,
  handSheetWidthFraction,
  cueMessage,
  type CueCode,
  type CueInput,
} from "../../src/client/camera/cues";
import type { Quad } from "../../src/client/camera/quad";
import {
  INITIAL_PLACEMENT_HYSTERESIS_STATE,
  PLACEMENT_CUE_CODES,
  PLACEMENT_LIVE_THRESHOLDS,
  advancePlacementHysteresis,
  isPlacementCueCode,
  placementCueInput,
  placementHintsOn,
  placementVerdict,
  type PlacementCueCode,
  type PlacementCueInput,
  type PlacementHysteresisState,
  type PlacementLiveThresholds,
  type PlacementObservation,
} from "../../src/client/camera/placementHysteresis";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import { sheetFoundByCue } from "../../src/client/camera/noSheetCapture";
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
} from "../../src/client/camera/autoCapture";
import {
  INITIAL_CUE_DEBOUNCE_STATE,
  advanceCueDebounce,
} from "../../src/client/camera/cueDebounce";
import { cameraCuesCopy } from "../../src/lib/copy/camera-cues";

const GOOD_QUAD: Quad = {
  topLeft: { x: 100, y: 100 },
  topRight: { x: 500, y: 100 },
  bottomRight: { x: 500, y: 500 },
  bottomLeft: { x: 100, y: 500 },
};

function baseInput(overrides: Partial<CueInput> = {}): CueInput {
  return {
    cornersSeen: 4,
    quad: GOOD_QUAD,
    frameWidth: 640,
    meanLuma: 120,
    clippedFraction: 0,
    steady: true,
    sharpEnough: true,
    msSinceLastDetection: 0,
    ...overrides,
  };
}

const hint = (
  code: PlacementCueCode | null,
  wristNearBottomEdge = false,
): PlacementCueInput => ({ hint: code, wristNearBottomEdge, handSeen: true });

const code = (input: CueInput) => pickCue(input, "paper-edge", "en").code;

/** Every check switched on, for the tests of the checks that are off by default. */
const ALL_ON: PlacementLiveThresholds = {
  ...PLACEMENT_LIVE_THRESHOLDS,
  live: {
    handMissing: true,
    wristAlign: true,
    handInside: true,
    handStraight: true,
    handFlat: true,
    fingerCurl: true,
  },
};

function obs(over: Partial<PlacementObservation> = {}): PlacementObservation {
  return {
    atMs: 0,
    handSeen: true,
    wristToEdgeMm: 8,
    wristEdge: "near-bottom",
    handAxisDeg: 0,
    minSideMarginMm: 20,
    palmOverHand: 0.5,
    ...over,
  };
}

/** Feeds readings 500 ms apart; returns the states after each. */
function feed(
  readings: readonly Partial<PlacementObservation>[],
  t: PlacementLiveThresholds = PLACEMENT_LIVE_THRESHOLDS,
  start: PlacementHysteresisState = INITIAL_PLACEMENT_HYSTERESIS_STATE,
): PlacementHysteresisState[] {
  const out: PlacementHysteresisState[] = [];
  let state = start;
  readings.forEach((r, i) => {
    state = advancePlacementHysteresis(state, obs({ atMs: i * 500, ...r }), t);
    out.push(state);
  });
  return out;
}

const shownHint = (
  state: PlacementHysteresisState,
  t: PlacementLiveThresholds = PLACEMENT_LIVE_THRESHOLDS,
) =>
  placementCueInput(
    state,
    { nowMs: state.lastAtMs ?? 0, detectorReady: true },
    t,
  )?.hint ?? null;

describe("the switch: hints only with ?debug=1 (CAMERA_CONSTANTS.placement.enabled)", () => {
  it("is 'debug-only' by default", () => {
    expect(CAMERA_CONSTANTS.placement.enabled).toBe("debug-only");
    expect(placementHintsOn(false)).toBe(false);
    expect(placementHintsOn(true)).toBe(true);
  });
  it("'off' is off for everyone, 'on' is on for everyone", () => {
    expect(placementHintsOn(true, "off")).toBe(false);
    expect(placementHintsOn(false, "on")).toBe(true);
  });
  it("by default hand-missing, wrist-align, hand-inside and the finger-curl half of hand-flat are on (WP1a ruling; curl added after Kirby's S25 test 2026-10-26)", () => {
    expect(CAMERA_CONSTANTS.placement.live).toEqual({
      handMissing: true,
      wristAlign: true,
      handInside: true,
      handStraight: false,
      handFlat: false,
      fingerCurl: true,
    });
  });
});

describe("pickCue with a hand — §4.1 order, one case per layer", () => {
  it("without `placement` (the hints off) it is exactly the cue of before", () => {
    const cases: Partial<CueInput>[] = [
      {},
      { steady: false },
      { sharpEnough: false },
      { cornersSeen: 2, quad: null },
      { meanLuma: 10 },
      { paperGate: { kind: "edge-covered", side: "bottom" } },
    ];
    for (const c of cases) {
      const a = pickCue(baseInput(c), "paper-edge", "en");
      const b = pickCue(
        baseInput({ ...c, placement: null }),
        "paper-edge",
        "en",
      );
      expect(b).toEqual(a);
    }
  });

  it("1 no paper: no hand hint (the paper is not passed)", () => {
    expect(
      code(
        baseInput({
          cornersSeen: 0,
          quad: null,
          placement: hint("hand-missing"),
        }),
      ),
    ).toBe("no-corners");
  });
  it("2 some corners: no hand hint", () => {
    expect(
      code(
        baseInput({
          cornersSeen: 3,
          quad: null,
          placement: hint("wrist-align"),
        }),
      ),
    ).toBe("some-corners");
  });
  it("3 tilted: no hand hint", () => {
    const skewed: Quad = {
      ...GOOD_QUAD,
      topRight: { x: 620, y: 100 },
    };
    expect(
      code(baseInput({ quad: skewed, placement: hint("hand-inside") })),
    ).toBe("tilted");
  });
  it("4 distance: no hand hint", () => {
    const small: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    expect(
      code(baseInput({ quad: small, placement: hint("hand-missing") })),
    ).toBe("too-far");
  });
  it("5 light: no hand hint", () => {
    expect(
      code(baseInput({ meanLuma: 10, placement: hint("hand-missing") })),
    ).toBe("dark");
  });
  it("6 a paper edge (not the bottom with the wrist on it): no hand hint", () => {
    expect(
      code(
        baseInput({
          paperGate: { kind: "edge-covered", side: "left" },
          placement: hint("hand-missing", true),
        }),
      ),
    ).toBe("edge-covered-left");
    expect(
      code(
        baseInput({
          paperGate: { kind: "curled" },
          placement: hint("hand-missing"),
        }),
      ),
    ).toBe("paper-curled");
  });
  it("7 hand on the paper: after the edges", () => {
    expect(code(baseInput({ placement: hint("hand-missing") }))).toBe(
      "hand-missing",
    );
  });
  it("8 the hand's position: wrist, inside, direction", () => {
    for (const c of ["wrist-align", "hand-inside", "hand-straight"] as const)
      expect(code(baseInput({ placement: hint(c) }))).toBe(c);
  });
  it("9 hand flat", () => {
    expect(code(baseInput({ placement: hint("hand-flat") }))).toBe("hand-flat");
  });
  it("10 a hand hint goes before hold still and focus", () => {
    expect(
      code(baseInput({ steady: false, placement: hint("wrist-align") })),
    ).toBe("wrist-align");
    expect(
      code(baseInput({ sharpEnough: false, placement: hint("hand-inside") })),
    ).toBe("hand-inside");
  });
  it("11 no hand hint: hold still, focus, perfect as before", () => {
    expect(code(baseInput({ steady: false, placement: hint(null) }))).toBe(
      "hold-still",
    );
    expect(code(baseInput({ sharpEnough: false, placement: hint(null) }))).toBe(
      "out-of-focus",
    );
    const perfect = pickCue(
      baseInput({ placement: hint(null) }),
      "paper-edge",
      "en",
    );
    expect(perfect.code).toBe("perfect");
    expect(perfect.allPass).toBe(true);
  });
  it("a hand hint is never 'perfect'", () => {
    const c = pickCue(
      baseInput({ placement: hint("wrist-align") }),
      "paper-edge",
      "en",
    );
    expect(c.allPass).toBe(false);
  });
  it("the order of PLACEMENT_CUE_CODES is §4.1's", () => {
    expect(PLACEMENT_CUE_CODES).toEqual([
      "hand-missing",
      "wrist-onto-paper",
      "wrist-align",
      "hand-inside",
      "hand-straight",
      "hand-flat",
    ]);
  });
});

describe("§4.3: the wrist on the bottom edge", () => {
  const coveredBottom = { kind: "edge-covered", side: "bottom" } as const;

  it("with the wrist within 20 mm of the bottom edge, 'the bottom edge is covered' is not said", () => {
    const c = pickCue(
      baseInput({
        paperGate: coveredBottom,
        placement: hint(null, true),
      }),
      "paper-edge",
      "zh-TW",
    );
    expect(c.code).not.toBe("edge-covered-bottom");
    // Where the rest would read perfect, it says hold still (the edge still
    // fails, so the ring is not filling).
    expect(
      code(
        baseInput({ paperGate: coveredBottom, placement: hint(null, true) }),
      ),
    ).toBe("hold-still");
    expect(
      code(
        baseInput({
          paperGate: coveredBottom,
          sharpEnough: false,
          placement: hint(null, true),
        }),
      ),
    ).toBe("out-of-focus");
    expect(
      code(
        baseInput({
          paperGate: coveredBottom,
          placement: hint("hand-inside", true),
        }),
      ),
    ).toBe("hand-inside");
  });

  it("without the wrist there (or with the hints off), it is said as before", () => {
    expect(
      code(
        baseInput({ paperGate: coveredBottom, placement: hint(null, false) }),
      ),
    ).toBe("edge-covered-bottom");
    expect(code(baseInput({ paperGate: coveredBottom }))).toBe(
      "edge-covered-bottom",
    );
  });

  it("the synthetic case: wrist on the bottom edge, its middle covered → no bottom-edge words, from the reading up", () => {
    // Two readings with the wrist 6 mm inside the bottom edge.
    const states = feed([{ wristToEdgeMm: 6 }, { wristToEdgeMm: 6 }]);
    const p = placementCueInput(states[1], {
      nowMs: 600,
      detectorReady: true,
    });
    expect(p).toEqual({
      hint: null,
      wristNearBottomEdge: true,
      handSeen: true,
    });
    const c = pickCue(
      baseInput({ paperGate: coveredBottom, placement: p }),
      "paper-edge",
      "zh-TW",
    );
    expect(c.message).not.toContain("下緣被擋住");
    // The wrist just past the edge counts too (±20 mm), the top edge does not.
    const past = feed([{ wristToEdgeMm: -12 }]);
    expect(
      placementCueInput(past[0], { nowMs: 0, detectorReady: true })
        ?.wristNearBottomEdge,
    ).toBe(true);
    const top = feed([{ wristToEdgeMm: 6, wristEdge: "near-top" }]);
    expect(
      placementCueInput(top[0], { nowMs: 0, detectorReady: true })
        ?.wristNearBottomEdge,
    ).toBe(false);
    const far = feed([{ wristToEdgeMm: 21 }]);
    expect(
      placementCueInput(far[0], { nowMs: 0, detectorReady: true })
        ?.wristNearBottomEdge,
    ).toBe(false);
  });
});

describe("placementCueInput: no hand data → no hand hint, today's behaviour", () => {
  const up = feed([{ handSeen: false }, { handSeen: false }])[1];

  it("the hint is up with fresh readings and the detector loaded", () => {
    expect(
      placementCueInput(up, { nowMs: 500, detectorReady: true })?.hint,
    ).toBe("hand-missing");
  });
  it("detector not loaded: nothing", () => {
    expect(placementCueInput(up, { nowMs: 500, detectorReady: false })).toBe(
      null,
    );
  });
  it("newest reading older than handStaleMs: nothing", () => {
    const stale = CAMERA_CONSTANTS.noSheetCapture.handStaleMs;
    expect(stale).toBe(1200);
    expect(
      placementCueInput(up, { nowMs: 500 + stale, detectorReady: true })?.hint,
    ).toBe("hand-missing");
    expect(
      placementCueInput(up, { nowMs: 500 + stale + 1, detectorReady: true }),
    ).toBe(null);
  });
  it("no reading yet: nothing", () => {
    expect(
      placementCueInput(INITIAL_PLACEMENT_HYSTERESIS_STATE, {
        nowMs: 0,
        detectorReady: true,
      }),
    ).toBe(null);
  });
  it("pickCue with `null` placement (what stale data gives) is the paper's cue", () => {
    expect(code(baseInput({ placement: null }))).toBe("perfect");
  });
});

describe("placementHysteresis (§4.4)", () => {
  it("a hint shows only after 2 failing readings in a row", () => {
    const s = feed([{ wristToEdgeMm: 30 }, { wristToEdgeMm: 30 }]);
    expect(shownHint(s[0])).toBe(null);
    expect(shownHint(s[1])).toBe("wrist-align");
  });

  it("and goes only after 2 passing readings in a row", () => {
    const s = feed([
      { wristToEdgeMm: 30 },
      { wristToEdgeMm: 30 },
      { wristToEdgeMm: 8 },
      { wristToEdgeMm: 8 },
    ]);
    expect(shownHint(s[2])).toBe("wrist-align");
    expect(shownHint(s[3])).toBe(null);
  });

  it("readings alternating across the threshold 10 times: the text never changes (down stays down)", () => {
    const readings = Array.from({ length: 10 }, (_, i) => ({
      wristToEdgeMm: i % 2 === 0 ? 16 : 14,
    }));
    const s = feed(readings);
    expect(new Set(s.map((x) => shownHint(x)))).toEqual(new Set([null]));
  });

  it("readings alternating fail / pass 10 times once a hint is up: it stays up", () => {
    const readings = [
      { wristToEdgeMm: 30 },
      { wristToEdgeMm: 30 },
      ...Array.from({ length: 10 }, (_, i) => ({
        wristToEdgeMm: i % 2 === 0 ? 8 : 30,
      })),
    ];
    const s = feed(readings).slice(1);
    expect(new Set(s.map((x) => shownHint(x)))).toEqual(
      new Set(["wrist-align"]),
    );
  });

  it("…and the words on screen, through the cue debounce at 8 Hz, never change either", () => {
    let hyst = INITIAL_PLACEMENT_HYSTERESIS_STATE;
    let debounce = INITIAL_CUE_DEBOUNCE_STATE;
    const shown = new Set<CueCode | null>();
    // 10 readings (500 ms apart) alternating across 15 mm, 4 samples each.
    for (let r = 0; r < 10; r++) {
      hyst = advancePlacementHysteresis(
        hyst,
        obs({ atMs: r * 500, wristToEdgeMm: r % 2 === 0 ? 16 : 14 }),
      );
      for (let k = 0; k < 4; k++) {
        const now = r * 500 + k * 125;
        const c = pickCue(
          baseInput({
            placement: placementCueInput(hyst, {
              nowMs: now,
              detectorReady: true,
            }),
          }),
          "paper-edge",
          "en",
        );
        debounce = advanceCueDebounce(debounce, c.code, now);
        shown.add(debounce.shown);
      }
    }
    expect(shown).toEqual(new Set(["perfect"]));
  });

  it("the same reading is counted once, however many samples see it", () => {
    let s = INITIAL_PLACEMENT_HYSTERESIS_STATE;
    for (let i = 0; i < 5; i++)
      s = advancePlacementHysteresis(s, obs({ atMs: 100, wristToEdgeMm: 30 }));
    expect(s.checks["wrist-align"].failStreak).toBe(1);
    expect(shownHint(s)).toBe(null);
  });

  it("the bands (Kirby's S25 tests 2026-10-26/27): too far up 15 / 12 mm, past the edge -10 / -6 mm", () => {
    const t = PLACEMENT_LIVE_THRESHOLDS;
    const up = (x: number, active: boolean) =>
      placementVerdict("wrist-align", obs({ wristToEdgeMm: x }), active, t);
    expect(up(15, false)).toBe("pass");
    expect(up(15.1, false)).toBe("fail");
    expect(up(-20, false)).toBe("pass");
    expect(up(12.1, true)).toBe("fail");
    expect(up(12, true)).toBe("pass");
    const onto = (x: number, active: boolean) =>
      placementVerdict(
        "wrist-onto-paper",
        obs({ wristToEdgeMm: x }),
        active,
        t,
      );
    expect(onto(-10, false)).toBe("pass");
    expect(onto(-10.1, false)).toBe("fail");
    expect(onto(40, false)).toBe("pass");
    expect(onto(-6.1, true)).toBe("fail");
    expect(onto(-6, true)).toBe("pass");
  });

  it("his scans: on the edge or a little past it (-5 to +5 mm) gets nothing; -12 gets 請把手腕移回紙內一點; slightly above (+10 to +13) nothing; +20 請把手腕移到紙的下緣", () => {
    expect(
      shownHint(feed([{ wristToEdgeMm: 1.2 }, { wristToEdgeMm: 3.2 }])[1]),
    ).toBe(null);
    expect(
      shownHint(feed([{ wristToEdgeMm: -3.1 }, { wristToEdgeMm: -1.7 }])[1]),
    ).toBe(null);
    expect(
      shownHint(
        feed([
          { wristToEdgeMm: -5.3 },
          { wristToEdgeMm: -3.8 },
          { wristToEdgeMm: -4.8 },
        ])[2],
      ),
    ).toBe(null);
    expect(
      shownHint(feed([{ wristToEdgeMm: -12 }, { wristToEdgeMm: -11 }])[1]),
    ).toBe("wrist-onto-paper");
    expect(
      shownHint(feed([{ wristToEdgeMm: 11 }, { wristToEdgeMm: 13.4 }])[1]),
    ).toBe(null);
    expect(
      shownHint(feed([{ wristToEdgeMm: 20 }, { wristToEdgeMm: 22 }])[1]),
    ).toBe("wrist-align");
  });

  it("the bands: side margin 3 / 5 mm, axis 20 / 17°, palm ratio 0.44-0.56 / 0.46-0.54", () => {
    const t = ALL_ON;
    const inside = (x: number, a: boolean) =>
      placementVerdict("hand-inside", obs({ minSideMarginMm: x }), a, t);
    expect(inside(3, false)).toBe("pass");
    expect(inside(2.9, false)).toBe("fail");
    expect(inside(4.9, true)).toBe("fail");
    expect(inside(5, true)).toBe("pass");
    const axis = (x: number, a: boolean) =>
      placementVerdict("hand-straight", obs({ handAxisDeg: x }), a, t);
    expect(axis(20, false)).toBe("pass");
    expect(axis(-20.5, false)).toBe("fail");
    expect(axis(18, true)).toBe("fail");
    expect(axis(-17, true)).toBe("pass");
    const flat = (x: number, a: boolean) =>
      placementVerdict("hand-flat", obs({ palmOverHand: x }), a, t);
    expect(flat(0.44, false)).toBe("pass");
    expect(flat(0.43, false)).toBe("fail");
    expect(flat(0.57, false)).toBe("fail");
    expect(flat(0.45, true)).toBe("fail");
    expect(flat(0.5, true)).toBe("pass");
  });

  it("a reading without the hand cannot judge the position checks (they stay as they were)", () => {
    const s = feed([
      { wristToEdgeMm: 30 },
      { wristToEdgeMm: 30 },
      { handSeen: false, wristToEdgeMm: null },
    ]);
    expect(s[2].checks["wrist-align"].active).toBe(true);
    // ...and hand-missing comes first once it is up.
    const s2 = feed(
      [{ handSeen: false, wristToEdgeMm: null }],
      PLACEMENT_LIVE_THRESHOLDS,
      s[2],
    );
    expect(shownHint(s2[0])).toBe("hand-missing");
  });

  it("a reading with the hand but not the sheet's corners leaves the position checks as they were", () => {
    const s = feed([
      { wristToEdgeMm: null, minSideMarginMm: null, handAxisDeg: null },
      { wristToEdgeMm: null, minSideMarginMm: null, handAxisDeg: null },
    ]);
    expect(shownHint(s[1])).toBe(null);
  });

  it("hand-straight and hand-flat are off by default: they never come up", () => {
    const s = feed([
      { handAxisDeg: 40, palmOverHand: 0.3 },
      { handAxisDeg: 40, palmOverHand: 0.3 },
      { handAxisDeg: 40, palmOverHand: 0.3 },
    ]);
    expect(shownHint(s[2])).toBe(null);
    // Switched on, they do.
    const on = feed(
      [
        { handAxisDeg: 40, palmOverHand: 0.3 },
        { handAxisDeg: 40, palmOverHand: 0.3 },
      ],
      ALL_ON,
    );
    expect(shownHint(on[1], ALL_ON)).toBe("hand-straight");
    const flatOnly = feed(
      [{ palmOverHand: 0.3 }, { palmOverHand: 0.3 }],
      ALL_ON,
    );
    expect(shownHint(flatOnly[1], ALL_ON)).toBe("hand-flat");
  });

  it("the first hint that is up wins, in §4.1 order", () => {
    const s = feed([
      { wristToEdgeMm: 30, minSideMarginMm: 1 },
      { wristToEdgeMm: 30, minSideMarginMm: 1 },
    ]);
    expect(shownHint(s[1])).toBe("wrist-align");
    const inside = feed([{ minSideMarginMm: 1 }, { minSideMarginMm: 1 }]);
    expect(shownHint(inside[1])).toBe("hand-inside");
  });
});

describe("a hand hint on screen holds the auto-capture (Kirby 2026-10-27)", () => {
  it("the ring, fed as the live loop does (the paper passing AND no hand hint), does not fire while a hand hint is on screen", () => {
    let ring = INITIAL_AUTO_CAPTURE_STATE;
    let hyst = INITIAL_PLACEMENT_HYSTERESIS_STATE;
    const shown: CueCode[] = [];
    // 2.5 s of samples at 8 Hz (the ring's 2026-10-26 fill), and some spare.
    for (let i = 0; i < 40 && !ring.fired; i++) {
      const now = i * 125;
      if (i % 4 === 0)
        hyst = advancePlacementHysteresis(
          hyst,
          obs({ atMs: now, wristToEdgeMm: 40 }),
        );
      const input = baseInput();
      const paper = pickCue(input, "paper-edge", "en");
      const display = pickCue(
        {
          ...input,
          placement: placementCueInput(hyst, {
            nowMs: now,
            detectorReady: true,
          }),
        },
        "paper-edge",
        "en",
      );
      shown.push(display.code);
      const hint =
        placementCueInput(hyst, { nowMs: now, detectorReady: true })?.hint ??
        null;
      ring = advanceAutoCapture(ring, paper.allPass && hint === null, 125);
    }
    expect(ring.fired).toBe(false);
    expect(shown).toContain("wrist-align");
  });

  it("every hand hint counts as the sheet found for the F14 wait", () => {
    for (const c of PLACEMENT_CUE_CODES) expect(sheetFoundByCue(c)).toBe(true);
  });
});

describe("copy: both locales, live hints start with 請", () => {
  it("every hand hint has words in zh-TW and English, paper and printed sheet", () => {
    const expected: Record<PlacementCueCode, [string, string]> = {
      "hand-missing": ["請把手放在紙上", "Place your hand on the paper"],
      "wrist-onto-paper": [
        "請把手腕移回紙內一點",
        "Move your wrist back onto the paper",
      ],
      "wrist-align": [
        "請把手腕移到紙的下緣",
        "Move your wrist to the bottom edge",
      ],
      "hand-inside": ["請把整隻手放進紙內", "Keep your hand inside the paper"],
      "hand-straight": [
        "請讓手指朝向紙的上緣",
        "Point your fingers to the top edge",
      ],
      "hand-flat": ["請把手掌壓平", "Lay your hand flat"],
    };
    for (const c of PLACEMENT_CUE_CODES) {
      expect(isPlacementCueCode(c)).toBe(true);
      expect(cueMessage(c, "paper-edge", "zh-TW")).toBe(expected[c][0]);
      expect(cueMessage(c, "paper-edge", "en")).toBe(expected[c][1]);
      expect(cueMessage(c, "printed-sheet", "zh-TW").startsWith("請")).toBe(
        true,
      );
      expect(cueMessage(c, "printed-sheet", "en").length).toBeGreaterThan(0);
    }
    expect(isPlacementCueCode("perfect")).toBe(false);
  });

  it("the existing live lines changed to start with 請 (zh only; English unchanged)", () => {
    const zh = cameraCuesCopy("zh-TW");
    const en = cameraCuesCopy("en");
    expect(zh.paper.tooFar).toBe("請再靠近一點");
    expect(zh.paper.tooClose).toBe("請再退後一點");
    expect(zh.paper.someCorners).toBe("請再退後一點，讓紙張四角都入鏡");
    expect(zh.sheet.someCorners).toBe("請再退後一點，讓校正表四角都入鏡");
    expect(zh.paper.edgeCoveredBottom).toBe("紙的下緣被擋住，請把手往內移");
    expect(zh.sheet.edgeCoveredTop).toBe("校正表的上緣被擋住，請把手往內移");
    expect(zh.paper.edgeCovered).toBe("紙邊被擋住，請把手往內移");
    expect(en.paper.tooFar).toBe("Move closer");
    expect(en.paper.tooClose).toBe("Move back a little");
    expect(en.paper.edgeCoveredBottom).toBe(
      "The bottom edge is covered. Move your hand in.",
    );
  });
});

describe("the finger curl (Kirby's S25 test, 2026-10-26)", () => {
  const obs = (atMs: number, fingerRatioMean: number | null) => ({
    atMs,
    handSeen: true,
    wristToEdgeMm: 8,
    wristEdge: "near-bottom" as const,
    handAxisDeg: 0,
    minSideMarginMm: 40,
    palmOverHand: 0.5,
    fingerRatioMean,
  });
  it("a full curl (ratio 0.18) shows 請把手掌壓平 after two readings; flat (0.47) never does; it goes from 0.40", () => {
    let s = INITIAL_PLACEMENT_HYSTERESIS_STATE;
    s = advancePlacementHysteresis(s, obs(1, 0.47));
    s = advancePlacementHysteresis(s, obs(2, 0.47));
    expect(s.checks["hand-flat"].active).toBe(false);
    s = advancePlacementHysteresis(s, obs(3, 0.18));
    expect(s.checks["hand-flat"].active).toBe(false);
    s = advancePlacementHysteresis(s, obs(4, 0.18));
    expect(s.checks["hand-flat"].active).toBe(true);
    // 0.37 is above the show bound but below the clear bound: it stays.
    s = advancePlacementHysteresis(s, obs(5, 0.37));
    s = advancePlacementHysteresis(s, obs(6, 0.37));
    expect(s.checks["hand-flat"].active).toBe(true);
    s = advancePlacementHysteresis(s, obs(7, 0.45));
    s = advancePlacementHysteresis(s, obs(8, 0.45));
    expect(s.checks["hand-flat"].active).toBe(false);
  });
  it("no ratio is no verdict (the palm/hand half is off by default)", () => {
    let s = INITIAL_PLACEMENT_HYSTERESIS_STATE;
    for (let i = 1; i <= 4; i++)
      s = advancePlacementHysteresis(s, obs(i, null));
    expect(s.checks["hand-flat"].active).toBe(false);
  });
});

describe("a hand across the sheet (Kirby's S25 test, 2026-10-27)", () => {
  const cut = (overrides: Partial<CueInput>) =>
    baseInput({
      cornersSeen: 0,
      quad: null,
      sheetSeenYet: false,
      msSinceLastDetection: 10_000,
      ...overrides,
    });
  it("the sheet cut in two or the wrong shape, a hand seen → where the wrist goes", () => {
    for (const paperStage of ["region_split", "aspect_mismatch"] as const)
      expect(code(cut({ paperStage, placement: hint(null) }))).toBe(
        "wrist-align",
      );
  });
  it("the same miss while the last sheet found was out of range → the distance (Kirby 2026-10-28)", () => {
    for (const previousSizeStatus of ["too-far", "too-close"] as const)
      expect(
        code(
          cut({
            paperStage: "aspect_mismatch",
            placement: hint(null),
            previousSizeStatus,
          }),
        ),
      ).toBe(previousSizeStatus);
    expect(
      code(
        cut({
          paperStage: "region_split",
          placement: hint(null),
          previousSizeStatus: "ok",
        }),
      ),
    ).toBe("wrist-align");
  });
  it("the miss's own rough quad out of range → the distance, whatever the last sheet said (Kirby 2026-10-28, 68 cm)", () => {
    expect(
      code(
        cut({
          paperStage: "aspect_mismatch",
          placement: hint(null),
          previousSizeStatus: "ok",
          missGuessWidthFraction: 0.3,
        }),
      ),
    ).toBe("too-far");
    expect(
      code(
        cut({
          paperStage: "region_split",
          placement: hint(null),
          missGuessWidthFraction: 0.95,
        }),
      ),
    ).toBe("too-close");
    // In range: the wrist, even if the last sheet found was too far.
    expect(
      code(
        cut({
          paperStage: "region_split",
          placement: hint(null),
          previousSizeStatus: "too-far",
          missGuessWidthFraction: 0.68,
        }),
      ),
    ).toBe("wrist-align");
  });
  it("no rough quad either → the hand's length says the distance, well outside the range only (Kirby 2026-10-28)", () => {
    expect(CAMERA_CONSTANTS.size.assumedHandLengthMm).toBe(185);
    expect(CAMERA_CONSTANTS.size.handEstimateMargin).toBe(0.1);
    // A 185 mm hand 100 px long on a 342 px wide sample: a sheet of 0.33.
    const hand = (lengthPx: number) => {
      const points = Array.from({ length: 21 }, () => ({ x: 171, y: 500 }));
      points[12] = { x: 171, y: 500 - lengthPx };
      return points;
    };
    expect(handSheetWidthFraction(hand(100), 342)).toBeCloseTo(0.332, 2);
    expect(handSheetWidthFraction(null, 342)).toBeNull();
    const at = (handSheetWidthFraction: number) =>
      code(
        cut({
          paperStage: "region_split",
          placement: hint(null),
          previousSizeStatus: "ok",
          missGuessWidthFraction: null,
          handSheetWidthFraction,
        }),
      );
    expect(at(0.33)).toBe("too-far");
    expect(at(0.5)).toBe("wrist-align"); // under 0.55, inside the margin
    expect(at(0.7)).toBe("wrist-align");
    expect(at(0.99)).toBe("too-close");
    // The rough quad, when there is one, goes first.
    expect(
      code(
        cut({
          paperStage: "region_split",
          placement: hint(null),
          missGuessWidthFraction: 0.68,
          handSheetWidthFraction: 0.33,
        }),
      ),
    ).toBe("wrist-align");
  });
  it("any stage without the sheet: out of range by the rough quad or the hand → the distance (Kirby 2026-10-28, 64 cm)", () => {
    for (const paperStage of [
      "unknown",
      "no_bright_region",
      "too_small",
    ] as const) {
      expect(
        code(
          cut({
            paperStage,
            placement: hint(null),
            handSheetWidthFraction: 0.33,
          }),
        ),
      ).toBe("too-far");
      // In range: the stage's own words, as before (no wrist words).
      expect(
        code(
          cut({
            paperStage,
            placement: hint(null),
            handSheetWidthFraction: 0.7,
          }),
        ),
      ).not.toBe("wrist-align");
      // The last sheet found is read for the hand-cut stages only.
      expect(
        code(
          cut({
            paperStage,
            placement: hint(null),
            previousSizeStatus: "too-far",
          }),
        ),
      ).not.toBe("too-far");
    }
  });
  it("the live loop holds the no-sheet shot while a distance cue is up", () => {
    const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(source).toContain('shownCandidate.code === "too-far" ||');
  });
  it("no hand, the hints off, or another stage → the paper's words as before", () => {
    expect(
      code(
        cut({
          paperStage: "region_split",
          placement: { ...hint(null), handSeen: false },
        }),
      ),
    ).toBe("place-paper");
    expect(code(cut({ paperStage: "region_split" }))).toBe("place-paper");
    expect(code(cut({ paperStage: "too_small", placement: hint(null) }))).toBe(
      "place-paper",
    );
  });
  it("placementCueInput says whether the newest reading had a hand", () => {
    const seen = advancePlacementHysteresis(
      INITIAL_PLACEMENT_HYSTERESIS_STATE,
      {
        atMs: 0,
        handSeen: true,
        wristToEdgeMm: null,
        wristEdge: null,
        handAxisDeg: null,
        minSideMarginMm: null,
        palmOverHand: null,
        fingerRatioMean: null,
      },
    );
    expect(
      placementCueInput(seen, { nowMs: 100, detectorReady: true })?.handSeen,
    ).toBe(true);
  });
});
