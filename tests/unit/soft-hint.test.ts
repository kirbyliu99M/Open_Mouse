/**
 * V3.3 WP1a: softHint.ts — at most one post-shot reminder, priority order,
 * throttle, and both sides of every decision point (all thresholds candidate).
 */
import { describe, expect, it } from "vitest";
import {
  appendSoftHintHistory,
  firedSoftHints,
  pickSoftHint,
  SOFT_HINT_CODES,
  SOFT_HINT_THRESHOLDS,
  type SoftHintCode,
  type SoftHintInput,
  type SoftHintThresholds,
} from "../../src/client/photo/softHint";

/** A photo where nothing fires with the default thresholds. */
const CLEAN: SoftHintInput = {
  wristToEdgeMm: 8,
  handAxisDeg: 2,
  minSideMarginMm: 20,
  palmOverHand: 0.495,
  reachMean: 0.92,
  palmTiltDeg: 3,
  fingerFlexDeg: [5, 4, 6, 7],
  sharpness: 40,
  paperWidthFraction: 0.65,
};

/** Every check switched on (the 3D and blur ones are off by default). */
const ALL_ON: SoftHintThresholds = {
  ...SOFT_HINT_THRESHOLDS,
  palmTiltMaxDeg: 15,
  fingerFlexMaxDeg: 40,
  minSharpness: 25,
};

/** One input that fires every check. */
const ALL_BAD: SoftHintInput = {
  wristToEdgeMm: 40,
  handAxisDeg: 35,
  minSideMarginMm: -4,
  palmOverHand: 0.4,
  reachMean: 1.3,
  palmTiltDeg: 30,
  fingerFlexDeg: [80, 80, 80, 80],
  sharpness: 10,
  paperWidthFraction: 0.4,
};

describe("defaults", () => {
  it("are the design's candidate values", () => {
    expect(SOFT_HINT_THRESHOLDS).toMatchObject({
      wristToEdgeMinMm: -3,
      wristToEdgeMaxMm: 18,
      handAxisMaxDeg: 20,
      minSideMarginMm: 3,
      palmOverHandMin: 0.44,
      palmOverHandMax: 0.56,
      reachMeanMin: 0.75,
      reachMeanMax: 1.1,
      palmTiltMaxDeg: null,
      fingerFlexMaxDeg: null,
      minPaperWidthFraction: 0.55,
      minSharpness: null,
      repeatLimit: 3,
    });
  });

  it("a clean photo gets no hint", () => {
    expect(pickSoftHint(CLEAN)).toEqual({
      code: null,
      candidate: null,
      suppressed: false,
      fired: [],
    });
    expect(pickSoftHint(CLEAN, [], ALL_ON).code).toBeNull();
  });

  it("all-null readings never fire", () => {
    const empty: SoftHintInput = {
      wristToEdgeMm: null,
      handAxisDeg: null,
      minSideMarginMm: null,
      palmOverHand: null,
      reachMean: null,
      palmTiltDeg: null,
      fingerFlexDeg: null,
      sharpness: null,
      paperWidthFraction: null,
    };
    expect(firedSoftHints(empty, ALL_ON)).toEqual([]);
  });

  it("non-finite readings never fire", () => {
    expect(
      firedSoftHints(
        { ...CLEAN, wristToEdgeMm: Number.NaN, paperWidthFraction: -Infinity },
        ALL_ON,
      ),
    ).toEqual([]);
  });

  it("3D and blur checks are off by default", () => {
    expect(
      firedSoftHints({
        ...CLEAN,
        palmTiltDeg: 80,
        fingerFlexDeg: [170, 170, 170, 170],
        sharpness: 1,
      }),
    ).toEqual([]);
  });
});

describe("priority: one hint only, highest first", () => {
  it("all checks fire → order is paper-small, hand-inside, wrist-align, hand-straight, hand-flat, blurry", () => {
    const r = pickSoftHint(ALL_BAD, [], ALL_ON);
    expect(r.fired).toEqual([...SOFT_HINT_CODES]);
    expect(r.code).toBe("paper-small");
  });

  it("removing the top cause each time walks down the list", () => {
    const fixes: Partial<SoftHintInput>[] = [
      { paperWidthFraction: 0.65 },
      { minSideMarginMm: 20 },
      { wristToEdgeMm: 8 },
      { handAxisDeg: 0 },
      {
        palmOverHand: 0.5,
        reachMean: 0.9,
        palmTiltDeg: 0,
        fingerFlexDeg: [0, 0, 0, 0],
      },
      { sharpness: 60 },
    ];
    let input: SoftHintInput = ALL_BAD;
    const seen: (SoftHintCode | null)[] = [];
    for (const fix of fixes) {
      seen.push(pickSoftHint(input, [], ALL_ON).code);
      input = { ...input, ...fix };
    }
    seen.push(pickSoftHint(input, [], ALL_ON).code);
    expect(seen).toEqual([...SOFT_HINT_CODES, null]);
  });
});

describe("decision points: both sides of every limit (on the limit = no hint)", () => {
  const cases: [
    string,
    Partial<SoftHintInput>,
    Partial<SoftHintInput>,
    Partial<SoftHintInput>,
    SoftHintCode,
  ][] = [
    [
      "paper width 0.55",
      { paperWidthFraction: 0.549 },
      { paperWidthFraction: 0.55 },
      { paperWidthFraction: 0.551 },
      "paper-small",
    ],
    [
      "side margin 3 mm",
      { minSideMarginMm: 2.99 },
      { minSideMarginMm: 3 },
      { minSideMarginMm: 3.01 },
      "hand-inside",
    ],
    [
      "wrist −3 mm",
      { wristToEdgeMm: -3.01 },
      { wristToEdgeMm: -3 },
      { wristToEdgeMm: -2.99 },
      "wrist-align",
    ],
    [
      "wrist +18 mm",
      { wristToEdgeMm: 18.01 },
      { wristToEdgeMm: 18 },
      { wristToEdgeMm: 17.99 },
      "wrist-align",
    ],
    [
      "axis +20°",
      { handAxisDeg: 20.01 },
      { handAxisDeg: 20 },
      { handAxisDeg: 19.99 },
      "hand-straight",
    ],
    [
      "axis −20°",
      { handAxisDeg: -20.01 },
      { handAxisDeg: -20 },
      { handAxisDeg: -19.99 },
      "hand-straight",
    ],
    [
      "palm/hand 0.44",
      { palmOverHand: 0.439 },
      { palmOverHand: 0.44 },
      { palmOverHand: 0.441 },
      "hand-flat",
    ],
    [
      "palm/hand 0.56",
      { palmOverHand: 0.561 },
      { palmOverHand: 0.56 },
      { palmOverHand: 0.559 },
      "hand-flat",
    ],
    [
      "reach 0.75",
      { reachMean: 0.749 },
      { reachMean: 0.75 },
      { reachMean: 0.751 },
      "hand-flat",
    ],
    [
      "reach 1.10",
      { reachMean: 1.101 },
      { reachMean: 1.1 },
      { reachMean: 1.099 },
      "hand-flat",
    ],
    [
      "palm tilt 15° (enabled)",
      { palmTiltDeg: 15.01 },
      { palmTiltDeg: 15 },
      { palmTiltDeg: 14.99 },
      "hand-flat",
    ],
    [
      "finger flex 40° (enabled)",
      { fingerFlexDeg: [0, 40.01, 0, 0] },
      { fingerFlexDeg: [40, 40, 40, 40] },
      { fingerFlexDeg: [39.99, 0, 0, 0] },
      "hand-flat",
    ],
    [
      "sharpness 25 (enabled)",
      { sharpness: 24.99 },
      { sharpness: 25 },
      { sharpness: 25.01 },
      "blurry",
    ],
  ];
  it.each(cases)("%s", (_l, bad, on, good, code) => {
    expect(pickSoftHint({ ...CLEAN, ...bad }, [], ALL_ON).code).toBe(code);
    expect(pickSoftHint({ ...CLEAN, ...on }, [], ALL_ON).code).toBeNull();
    expect(pickSoftHint({ ...CLEAN, ...good }, [], ALL_ON).code).toBeNull();
  });
});

describe("throttle: the same hint 3 times in a row, then not again", () => {
  const wristBad: SoftHintInput = { ...CLEAN, wristToEdgeMm: 40 };

  it("shows 3 times, suppresses the 4th and later while the streak lasts", () => {
    let history: (SoftHintCode | null)[] = [];
    const shown: (SoftHintCode | null)[] = [];
    for (let i = 0; i < 6; i++) {
      const r = pickSoftHint(wristBad, history);
      shown.push(r.code);
      expect(r.candidate).toBe("wrist-align");
      expect(r.suppressed).toBe(i >= 3);
      history = appendSoftHintHistory(history, r.candidate);
    }
    expect(shown).toEqual([
      "wrist-align",
      "wrist-align",
      "wrist-align",
      null,
      null,
      null,
    ]);
  });

  it("a clean photo breaks the streak", () => {
    const history: (SoftHintCode | null)[] = [
      "wrist-align",
      "wrist-align",
      null,
    ];
    expect(pickSoftHint(wristBad, history).code).toBe("wrist-align");
  });

  it("a different hint breaks the streak", () => {
    const history: (SoftHintCode | null)[] = [
      "wrist-align",
      "hand-flat",
      "wrist-align",
      "wrist-align",
    ];
    expect(pickSoftHint(wristBad, history).code).toBe("wrist-align");
  });

  it("a suppressed hint does not hand over to a lower-priority one", () => {
    const both: SoftHintInput = { ...wristBad, palmOverHand: 0.4 };
    const r = pickSoftHint(both, ["wrist-align", "wrist-align", "wrist-align"]);
    expect(r).toEqual({
      code: null,
      candidate: "wrist-align",
      suppressed: true,
      fired: ["wrist-align", "hand-flat"],
    });
  });

  it("only the last repeatLimit entries count, and repeatLimit is configurable", () => {
    const hist: (SoftHintCode | null)[] = ["wrist-align", "wrist-align"];
    expect(pickSoftHint(wristBad, hist).suppressed).toBe(false);
    expect(
      pickSoftHint(wristBad, hist, { ...SOFT_HINT_THRESHOLDS, repeatLimit: 2 })
        .suppressed,
    ).toBe(true);
  });

  it("appendSoftHintHistory keeps the last N entries", () => {
    let h: (SoftHintCode | null)[] = [];
    for (let i = 0; i < 15; i++)
      h = appendSoftHintHistory(h, i % 2 ? "blurry" : null);
    expect(h).toHaveLength(10);
    expect(
      appendSoftHintHistory(["blurry", null, "hand-flat"], "wrist-align", 2),
    ).toEqual(["hand-flat", "wrist-align"]);
  });
});
