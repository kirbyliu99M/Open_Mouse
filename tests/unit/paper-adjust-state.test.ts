/**
 * V3.2 F2 (candidate): the rules of the 手動調整邊框 screen
 * (src/client/camera/paperAdjustState.ts): when it is offered, relative drag,
 * the keyboard steps, the magnifier's place, the hidden-corner marks and when
 * the frame may be used. Scenes are SIMULATED (模擬).
 */
import { describe, expect, it } from "vitest";
import {
  PAPER_ADJUST_LAYOUT,
  dragSlopScreenPx,
  adjustConfirmAction,
  adjustEntryFor,
  adjustOpensDirectly,
  adjustWarningFor,
  confirmCornerCheck,
  frameMoved,
  isHandIssue,
  isPaperIssue,
  adjustReadiness,
  adjustReducer,
  cornerCheckDistances,
  cornerPositions,
  KEY_DIRECTIONS,
  edgeStepOf,
  fitPhoto,
  isGuessedCorner,
  openingPlaced,
  magnifierLayout,
  magnifierPlacement,
  MAGNIFIER_EDGE,
  nudgeForKey,
  pipelinePaperInput,
  pointerMoveFor,
  startAdjust,
  toImage,
  toScreen,
  type AdjustAction,
  type AdjustState,
  type MagnifierPlacement,
} from "../../src/client/camera/paperAdjustState";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import {
  MANUAL_QUAD_LIMITS,
  type Quad4,
} from "../../src/client/paper/manualQuad";
import { buildR5Scene } from "./helpers/r5-corner-scene";

const IMAGE = { width: 1024, height: 1920 };
const RECT: Quad4 = [
  { x: 200, y: 300 },
  { x: 800, y: 300 },
  { x: 800, y: 1150 },
  { x: 200, y: 1150 },
];
const overlay = (extra: Partial<PhotoOverlay> = {}): PhotoOverlay => ({
  imageWidth: IMAGE.width,
  imageHeight: IMAGE.height,
  markers: [],
  card: null,
  landmarksPx: null,
  ...extra,
});
const issue = (code: string) => ({ code, message: "m" });
const submission = (calibration: Record<string, unknown>): ScanSubmission =>
  scanSubmissionSchema.parse({
    hand: "right",
    measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
    calibration,
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  });
const AUTO = submission({
  method: "paper-edge",
  paperSize: "a4",
  edgeFitResidualMm: 0.4,
  minSideCoverage: 0.9,
  parallaxCorrected: true,
});

const run = (state: AdjustState, ...actions: AdjustAction[]) =>
  actions.reduce(adjustReducer, state);

describe("adjustEntryFor (F7, Kirby's phone test 2026-10-21): like Adobe Scan, every paper failure can have its frame fixed", () => {
  const PAPER_CODES = [
    "PAPER_NOT_FOUND",
    "PAPER_EDGE_HIDDEN",
    "PAPER_CORNER_HIDDEN",
    "PAPER_CURLED",
    // Any other paper gate, present or future (tilt, aspect): the prefix decides.
    "PAPER_TILTED",
    "PAPER_ASPECT_MISMATCH",
  ];
  const HAND_CODES = [
    "HAND_NOT_DETECTED",
    "HAND_OUT_OF_BOUNDS",
    "HANDEDNESS_MISMATCH",
    "LOW_LANDMARK_CONFIDENCE",
  ];
  const PLACED = { corners: RECT, source: "adjusted" as const };

  it("isPaperIssue: every PAPER_* code, nothing else", () => {
    for (const code of PAPER_CODES) expect(isPaperIssue(code)).toBe(true);
    for (const code of [...HAND_CODES, "LOW_SHARPNESS", "DECODE_FAILED"])
      expect(isPaperIssue(code)).toBe(false);
    expect(isPaperIssue(undefined)).toBe(false);
  });

  it("offers the rescue after every paper failure on a decoded photo, wherever it is listed", () => {
    for (const code of PAPER_CODES) {
      expect(
        adjustEntryFor({
          kind: "gateFailure",
          errors: [issue(code)],
          overlay: overlay(),
        }),
        code,
      ).toBe("rescue");
      // Listed after a hand reason, or together with another paper reason.
      expect(
        adjustEntryFor({
          kind: "gateFailure",
          errors: [issue("HAND_OUT_OF_BOUNDS"), issue(code)],
          overlay: overlay(),
        }),
        code,
      ).toBe("rescue");
      expect(
        adjustEntryFor({
          kind: "gateFailure",
          errors: [issue("PAPER_EDGE_HIDDEN"), issue(code)],
          overlay: overlay({ paperCorners: RECT }),
        }),
        code,
      ).toBe("rescue");
    }
  });

  it("not after a hand failure on the detector's own frame: moving it cannot help, and the sheet keeps its explanation", () => {
    for (const code of [
      ...HAND_CODES,
      "LOW_SHARPNESS",
      "MEASUREMENT_OUT_OF_RANGE",
    ])
      for (const placedFrame of [undefined, null])
        expect(
          adjustEntryFor({
            kind: "gateFailure",
            errors: [issue(code)],
            overlay: overlay({ paperCorners: RECT }),
            placedFrame,
          }),
          code,
        ).toBeNull();
  });

  it("after a hand gate turned back a frame the person placed, the rescue is offered again", () => {
    for (const code of HAND_CODES)
      for (const source of ["adjusted", "manual"] as const)
        expect(
          adjustEntryFor({
            kind: "gateFailure",
            errors: [issue(code)],
            overlay: overlay(),
            placedFrame: { corners: RECT, source },
          }),
          code,
        ).toBe("rescue");
  });

  it("never without a decoded photo to adjust on", () => {
    for (const code of [
      "PAPER_EDGE_HIDDEN",
      "DECODE_FAILED",
      "PROCESSING_FAILED",
    ]) {
      expect(
        adjustEntryFor({
          kind: "gateFailure",
          errors: [issue(code)],
          overlay: null,
        }),
      ).toBeNull();
      expect(
        adjustEntryFor({
          kind: "gateFailure",
          errors: [issue(code)],
          overlay: overlay({ imageWidth: 0, imageHeight: 0 }),
          placedFrame: PLACED,
        }),
      ).toBeNull();
    }
    expect(adjustEntryFor({ kind: "none" })).toBeNull();
    expect(adjustEntryFor({ kind: "processing" })).toBeNull();
  });

  it("on a photo measured from the detector's own corners: review (F15: opened by itself, never a button; no ?debug=1 corner check any more)", () => {
    const measured = {
      kind: "measured" as const,
      overlay: overlay({ paperCorners: RECT }),
      submission: AUTO,
    };
    expect(adjustEntryFor(measured)).toBe("review");
    // No corners to review.
    expect(adjustEntryFor({ ...measured, overlay: overlay() })).toBeNull();
  });

  it("not on a photo measured from a frame placed by hand, nor with a typed length", () => {
    const adjusted = submission({
      method: "paper-edge",
      paperSize: "a4",
      cornersSource: "adjusted",
      parallaxCorrected: true,
    });
    expect(
      adjustEntryFor({
        kind: "measured",
        overlay: overlay({ paperCorners: RECT }),
        submission: adjusted,
      }),
    ).toBeNull();
    const typed = submission({
      method: "user-length",
      referenceMeasurement: "handLengthMm",
      referenceMm: 186,
      parallaxCorrected: false,
    });
    expect(
      adjustEntryFor({
        kind: "measured",
        overlay: overlay(),
        submission: typed,
      }),
    ).toBeNull();
  });
});

describe("adjustOpensDirectly (F14, Kirby's phone test of preview 5, 2026-10-22): a paper failure opens the adjustment by itself", () => {
  const PLACED = { corners: RECT, source: "adjusted" as const };
  const failure = (
    codes: string[],
    extra: { overlay?: PhotoOverlay | null; placed?: typeof PLACED } = {},
  ) => ({
    kind: "gateFailure" as const,
    errors: codes.map(issue),
    overlay: extra.overlay === undefined ? overlay() : extra.overlay,
    placedFrame: extra.placed ?? null,
  });

  it("isHandIssue: a failure of the hand itself (HAND_*, FINGER_*, LOW_LANDMARK_CONFIDENCE), not the hand button's HANDEDNESS_MISMATCH nor a paper code", () => {
    for (const code of [
      "HAND_NOT_DETECTED",
      "LOW_LANDMARK_CONFIDENCE",
      "HAND_OUT_OF_BOUNDS",
      "HAND_TILTED",
      "FINGER_NOT_STRAIGHT",
    ])
      expect(isHandIssue(code)).toBe(true);
    for (const code of [
      "HANDEDNESS_MISMATCH",
      "PAPER_NOT_FOUND",
      "MEASUREMENT_OUT_OF_RANGE",
      undefined,
    ])
      expect(isHandIssue(code)).toBe(false);
  });

  it("every PAPER_* failure on the detector's own frame, on a decoded photo: opens directly (and is a rescue)", () => {
    for (const code of [
      "PAPER_NOT_FOUND",
      "PAPER_EDGE_HIDDEN",
      "PAPER_CORNER_HIDDEN",
      "PAPER_CURLED",
      "PAPER_TILTED",
    ]) {
      const result = failure([code]);
      expect(adjustOpensDirectly(result)).toBe(true);
      expect(adjustEntryFor(result)).toBe("rescue");
    }
  });

  it("a hand failure on the detector's frame keeps the failure sheet and its reason (a frame cannot fix it)", () => {
    for (const code of [
      "HAND_NOT_DETECTED",
      "HAND_OUT_OF_BOUNDS",
      "HAND_TILTED",
      "FINGER_NOT_STRAIGHT",
    ]) {
      expect(adjustOpensDirectly(failure([code]))).toBe(false);
      expect(adjustOpensDirectly(failure(["PAPER_CURLED", code]))).toBe(false);
    }
  });

  it("a hand read unclearly beside a paper failure keeps the failure sheet (F14 review): the hand detection is the photo's, whatever the frame", () => {
    // Four corners found but the paper gate turned them back: the paper-edge
    // finish runs the hand gates as well and returns both errors.
    expect(
      adjustOpensDirectly(
        failure(["PAPER_EDGE_HIDDEN", "LOW_LANDMARK_CONFIDENCE"]),
      ),
    ).toBe(false);
    expect(adjustOpensDirectly(failure(["LOW_LANDMARK_CONFIDENCE"]))).toBe(
      false,
    );
  });

  it("nothing about the paper, no decoded photo, or a frame already placed by hand: the failure sheet", () => {
    expect(adjustOpensDirectly(failure(["MEASUREMENT_OUT_OF_RANGE"]))).toBe(
      false,
    );
    expect(adjustOpensDirectly(failure(["HANDEDNESS_MISMATCH"]))).toBe(false);
    expect(
      adjustOpensDirectly(failure(["PAPER_NOT_FOUND"], { overlay: null })),
    ).toBe(false);
    expect(
      adjustOpensDirectly(
        failure(["PAPER_NOT_FOUND"], {
          overlay: overlay({ imageWidth: 0, imageHeight: 0 }),
        }),
      ),
    ).toBe(false);
    // A placed frame turned back again: the sheet says why, with the
    // adjustment as its secondary way on (no reopening loop).
    const again = failure(["PAPER_CURLED"], { placed: PLACED });
    expect(adjustOpensDirectly(again)).toBe(false);
    expect(adjustEntryFor(again)).toBe("rescue");
  });

  it("never while processing or with nothing on screen", () => {
    expect(adjustOpensDirectly({ kind: "processing" })).toBe(false);
    expect(adjustOpensDirectly({ kind: "none" })).toBe(false);
  });

  it("F15 (Kirby, 2026-10-23): a photo measured from the detector's own four corners opens it by itself, as review, before any length is shown", () => {
    const measured = {
      kind: "measured" as const,
      overlay: overlay({ paperCorners: RECT }),
      submission: AUTO,
    };
    expect(adjustOpensDirectly(measured)).toBe(true);
    expect(adjustEntryFor(measured)).toBe("review");
    // cornersSource auto spelled out, as the pipeline writes it.
    expect(
      adjustOpensDirectly({
        ...measured,
        submission: submission({
          method: "paper-edge",
          paperSize: "a4",
          cornersSource: "auto",
          edgeFitResidualMm: 0.4,
          minSideCoverage: 0.9,
          parallaxCorrected: true,
        }),
      }),
    ).toBe(true);
  });

  it("F15: a photo measured with a frame placed or moved by hand, with a typed length, or with no corners shows its sheet at once (no reopening loop)", () => {
    for (const cornersSource of ["adjusted", "manual"] as const)
      expect(
        adjustOpensDirectly({
          kind: "measured",
          overlay: overlay({ paperCorners: RECT }),
          submission: submission({
            method: "paper-edge",
            paperSize: "a4",
            cornersSource,
            parallaxCorrected: true,
          }),
        }),
        cornersSource,
      ).toBe(false);
    expect(
      adjustOpensDirectly({
        kind: "measured",
        overlay: overlay(),
        submission: submission({
          method: "user-length",
          referenceMeasurement: "handLengthMm",
          referenceMm: 186,
          parallaxCorrected: false,
        }),
      }),
    ).toBe(false);
    expect(
      adjustOpensDirectly({
        kind: "measured",
        overlay: overlay(),
        submission: AUTO,
      }),
    ).toBe(false);
  });
});

describe("adjustWarningFor: PAPER_CURLED is said before confirming (F7)", () => {
  it("curled when the sheet was measured as curled, wherever it is listed; nothing otherwise", () => {
    expect(
      adjustWarningFor({
        kind: "gateFailure",
        errors: [issue("PAPER_CURLED")],
        overlay: overlay(),
      }),
    ).toBe("curled");
    expect(
      adjustWarningFor({
        kind: "gateFailure",
        errors: [issue("PAPER_EDGE_HIDDEN"), issue("PAPER_CURLED")],
        overlay: overlay(),
      }),
    ).toBe("curled");
    expect(
      adjustWarningFor({
        kind: "gateFailure",
        errors: [issue("PAPER_EDGE_HIDDEN")],
        overlay: overlay(),
      }),
    ).toBeNull();
    expect(
      adjustWarningFor({
        kind: "measured",
        overlay: overlay({ paperCorners: RECT }),
        submission: AUTO,
      }),
    ).toBeNull();
  });

  it("a curled sheet can still be confirmed: the warning does not stop the frame", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperPartialCorners: [...RECT] }),
      paperSize: "a4",
    });
    const ready = adjustReadiness(state);
    expect(ready.ok).toBe(true);
    expect(
      adjustConfirmAction({
        entry: "rescue",
        result: {
          kind: "gateFailure",
          errors: [issue("PAPER_CURLED")],
          overlay: overlay(),
        },
        hasFile: true,
      }),
    ).toEqual({ kind: "rerun" });
  });
});

describe("where the frame opens (F7; F10: always a best guess)", () => {
  // F10 (Kirby's second phone test 2026-10-21/22): 「即便沒有掃描成功，還是
  // 需要先幫用戶大致拉出框線」. F7 opened PAPER_NOT_FOUND on the centred sheet
  // (its adjustFirstCodeFor wiring is gone); now the frame opens on the best
  // guess there is, whatever the code.
  const GUESS: Quad4 = [
    { x: 190, y: 310 },
    { x: 815, y: 290 },
    { x: 790, y: 1160 },
    { x: 215, y: 1140 },
  ];

  // F14 (Kirby's phone test of preview 5, 2026-10-22): "its auto fit may be
  // correct, so you don't have to force the user to manually adjust every
  // corner". Every frame with a clue opens placed; only the centred sheet
  // still needs all four corners moved.
  it("no sheet found but a rough quad: opens on it, every corner placed, usable at once (manual)", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperGuessCorners: GUESS }),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("guess");
    expect(state.corners).toEqual(GUESS);
    expect(state.placed).toEqual([true, true, true, true]);
    expect(openingPlaced(state.start)).toEqual([true, true, true, true]);
    const ready = adjustReadiness(state);
    expect(ready.ok).toBe(true);
    if (ready.ok) {
      expect(ready.source).toBe("manual");
      expect(ready.corners).toEqual(GUESS);
    }
  });

  it("only what needs fixing is dragged: one corner of the rough quad moved, the rest as they opened, still usable", () => {
    let s = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperGuessCorners: GUESS }),
      paperSize: "a4",
    });
    s = run(
      s,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 3, y: 0 }, scale: 1 },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(s.placed).toEqual([true, true, true, true]);
    expect(s.corners[1]).toEqual({ x: GUESS[1].x + 3, y: GUESS[1].y });
    expect([s.corners[0], s.corners[2], s.corners[3]]).toEqual([
      GUESS[0],
      GUESS[2],
      GUESS[3],
    ]);
    expect(adjustReadiness(s).ok).toBe(true);
  });

  it("a tap or a press without a move only chooses a corner: nothing moves and nothing is placed or unplaced by it", () => {
    const tap = {
      type: "pointerDown",
      pointerId: 1,
      pointerType: "touch",
      point: { x: 5, y: 5 },
    } as const;
    const guess = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperGuessCorners: GUESS }),
      paperSize: "a4",
    });
    const tapped = run(
      guess,
      { type: "select", index: 0 },
      { ...tap, index: 2 },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(tapped.placed).toEqual(guess.placed);
    expect(tapped.corners).toEqual(guess.corners);
    expect(tapped.selected).toBe(2);
    const centred = run(
      startAdjust({ entry: "rescue", overlay: overlay(), paperSize: "a4" }),
      { type: "select", index: 0 },
      { ...tap, index: 1 },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(centred.start.from).toBe("centred");
    expect(centred.placed).toEqual([false, false, false, false]);
  });

  it("three corners found: the three open placed, the fourth (a guess inside the sheet) does not, so the frame cannot be confirmed until it moved (manual)", () => {
    const partial = startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
        paperGuessCorners: GUESS,
      }),
      paperSize: "a4",
    });
    expect(partial.start.from).toBe("partial");
    expect(partial.start.detected).toEqual([true, false, true, true]);
    // Claude's call on F14 (2026-10-22): the inferred fourth corner is not an
    // automatic fit, so it opens not placed; the other three are placed.
    expect(partial.placed).toEqual([true, false, true, true]);
    expect(openingPlaced(partial.start)).toEqual([true, false, true, true]);
    expect(adjustReadiness(partial)).toEqual({ ok: false, notPlaced: 1 });
  });

  it("one or two corners found: those in place, the rest from the rough quad, every corner placed", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, null, RECT[3]],
        paperGuessCorners: GUESS,
      }),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("guess");
    expect(state.corners).toEqual([RECT[0], GUESS[1], GUESS[2], RECT[3]]);
    expect(state.start.detected).toEqual([true, false, false, true]);
    expect(state.placed).toEqual([true, true, true, true]);
  });

  it("the centred sheet: a corner is placed by any move, and only once all four moved is it usable", () => {
    let s = startAdjust({
      entry: "rescue",
      overlay: overlay(),
      paperSize: "a4",
    });
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 0 });
    for (const index of [0, 1, 2] as const)
      s = run(s, {
        type: "nudge",
        index,
        dx: 1,
        dy: 0,
        big: false,
        scale: 1,
      });
    expect(s.placed).toEqual([true, true, true, false]);
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 3 });
    s = run(s, { type: "nudge", index: 3, dx: 0, dy: 1, big: false, scale: 1 });
    const ready = adjustReadiness(s);
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.source).toBe("manual");
  });

  it("nothing known: the centred sheet, 72 % of the photo's width, all four corners not placed", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay(),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("centred");
    expect(state.placed).toEqual([false, false, false, false]);
    const xs = state.corners.map((c) => c.x);
    const ys = state.corners.map((c) => c.y);
    const width = Math.max(...xs) - Math.min(...xs);
    expect(width / IMAGE.width).toBeCloseTo(
      MANUAL_QUAD_LIMITS.defaultWidthFraction,
      6,
    );
    expect(MANUAL_QUAD_LIMITS.defaultWidthFraction).toBe(0.72);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(
      IMAGE.width / 2,
      6,
    );
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(
      IMAGE.height / 2,
      6,
    );
    expect((Math.max(...ys) - Math.min(...ys)) / width).toBeCloseTo(
      297 / 210,
      6,
    );
    expect(adjustReadiness(state)).toEqual({ ok: false, notPlaced: 0 });
  });

  it("a rough quad that is not a usable frame is passed over for the centred sheet", () => {
    const crossed: Quad4 = [GUESS[0], GUESS[2], GUESS[1], GUESS[3]];
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperGuessCorners: crossed }),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("centred");
  });

  it("the rough quad is for the rescue only: a measured photo's review never uses it", () => {
    const review = startAdjust({
      entry: "review",
      overlay: overlay({ paperCorners: RECT, paperGuessCorners: GUESS }),
      paperSize: "a4",
    });
    expect(review.corners).toEqual(RECT);
  });

  it("centre (one tap, rescue only): back to the centred sheet, nothing placed, and reset then returns there", () => {
    let s = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperGuessCorners: GUESS }),
      paperSize: "a4",
    });
    s = run(s, { type: "select", index: 0 }, { type: "centre" });
    expect(s.start.from).toBe("centred");
    expect(s.placed).toEqual([false, false, false, false]);
    const centred = startAdjust({
      entry: "rescue",
      overlay: overlay(),
      paperSize: "a4",
    });
    expect(s.corners).toEqual(centred.corners);
    s = run(
      s,
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 30, y: 0 }, scale: 1 },
      { type: "pointerUp", pointerId: 1 },
      { type: "reset" },
    );
    expect(s.corners).toEqual(centred.corners);
    const review = startAdjust({
      entry: "review",
      overlay: overlay({ paperCorners: RECT }),
      paperSize: "a4",
    });
    expect(run(review, { type: "centre" })).toBe(review);
  });

  it("dragCancel (a second finger came down): the corner goes back to where the drag began, its placed state too", () => {
    const s0 = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperGuessCorners: GUESS }),
      paperSize: "a4",
    });
    const s = run(
      s0,
      {
        type: "pointerDown",
        index: 2,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 40, y: 20 }, scale: 1 },
    );
    expect(s.placed[2]).toBe(true);
    const back = run(s, { type: "dragCancel" });
    expect(back.corners).toEqual(s0.corners);
    expect(back.placed).toEqual(s0.placed);
    expect(back.drag).toBeNull();
  });

  it("a tap on the photo away from every handle moves nothing and leaves every corner as it opened (F14)", () => {
    const s0 = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperGuessCorners: GUESS }),
      paperSize: "a4",
    });
    const s = run(
      s0,
      { type: "select", index: 0 },
      {
        type: "pointerDown",
        index: null,
        pointerId: 2,
        pointerType: "touch",
        point: { x: 500, y: 700 },
      },
      { type: "pointerUp", pointerId: 2 },
    );
    expect(s.placed).toEqual([true, true, true, true]);
    expect(s.corners).toEqual(GUESS);
    expect(frameMoved(s)).toBe(false);
  });
});

describe("where the frame opens (F7), continued", () => {
  it("a paper gate after the four corners were found: starts from them, placed", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperPartialCorners: [...RECT] }),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("detected");
    expect(state.corners).toEqual(RECT);
    expect(state.placed).toEqual([true, true, true, true]);
  });

  it("after a frame placed by hand was turned back: that frame again, every corner placed, its source kept", () => {
    const placed: Quad4 = [
      { x: 210, y: 320 },
      { x: 790, y: 305 },
      { x: 812, y: 1140 },
      { x: 190, y: 1162 },
    ];
    for (const source of ["adjusted", "manual"] as const) {
      const state = startAdjust({
        entry: "rescue",
        overlay: overlay({ paperCorners: RECT }),
        paperSize: "a4",
        previous: { corners: placed, source },
      });
      expect(state.corners).toEqual(placed);
      expect(state.placed).toEqual([true, true, true, true]);
      const ready = adjustReadiness(state);
      expect(ready).toEqual({ ok: true, corners: placed, source });
      // Moving one corner keeps the others where they were.
      const moved = run(
        state,
        {
          type: "pointerDown",
          index: 1,
          pointerId: 1,
          pointerType: "mouse",
          point: { x: 0, y: 0 },
        },
        { type: "pointerMove", pointerId: 1, point: { x: 5, y: 5 }, scale: 1 },
      );
      expect(moved.corners[0]).toEqual(placed[0]);
      expect(moved.corners[1]).toEqual({ x: 795, y: 310 });
      expect(frameMoved(moved)).toBe(true);
    }
  });

  it("a previous frame that is no longer usable falls back to the usual start", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay(),
      paperSize: "a4",
      previous: {
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        source: "manual",
      },
    });
    expect(state.start.from).toBe("centred");
    expect(state.placed).toEqual([false, false, false, false]);
  });
});

describe("檢查邊框 on a measured photo (review, F7)", () => {
  const measured = {
    kind: "measured" as const,
    overlay: overlay({ paperCorners: RECT }),
    submission: AUTO,
  };
  const open = () =>
    startAdjust({
      entry: "review",
      overlay: measured.overlay,
      paperSize: "a4",
    });

  it("opens on the detector's own corners, all placed", () => {
    const state = open();
    expect(state.corners).toEqual(RECT);
    expect(state.placed).toEqual([true, true, true, true]);
    expect(frameMoved(state)).toBe(false);
  });

  it("confirmed without moving: the action is none, so nothing runs (that none leaves the result and its submission untouched is checked on EasyScanCamera's confirmAdjust in paper-adjust-screen.test.ts)", () => {
    const state = open();
    // A tap that selects a corner, and a press that never moves, move nothing.
    const tapped = run(
      state,
      { type: "select", index: 2 },
      {
        type: "pointerDown",
        index: 2,
        pointerId: 3,
        pointerType: "touch",
        point: { x: 40, y: 40 },
      },
      {
        type: "pointerMove",
        pointerId: 3,
        point: { x: 40, y: 40 },
        scale: 0.4,
      },
      { type: "pointerUp", pointerId: 3 },
    );
    expect(frameMoved(tapped)).toBe(false);
    expect(adjustReadiness(tapped).ok).toBe(true);
    const action = adjustConfirmAction({
      entry: "review",
      result: measured,
      hasFile: true,
      moved: frameMoved(tapped),
    });
    expect(action).toEqual({ kind: "none" });
    // The same frame, moved, is the only way to a rerun.
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: true,
        moved: true,
      }),
    ).toEqual({ kind: "rerun" });
  });

  it("a corner moved and back to exactly where it was is not a move", () => {
    const back = run(
      open(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 10, y: 10 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 30, y: 10 }, scale: 1 },
      { type: "pointerMove", pointerId: 1, point: { x: 10, y: 10 }, scale: 1 },
    );
    expect(frameMoved(back)).toBe(false);
  });

  it("F15: a finger that wobbles 1 screen px on a handle is a tap, not a move: confirmed, nothing runs again", () => {
    const state = open();
    const wobbled = run(
      state,
      {
        type: "pointerDown",
        index: 2,
        pointerId: 3,
        pointerType: "touch",
        point: { x: 40, y: 40 },
      },
      // Sub-pixel and 1 px wobble, as a touch screen reports a tap.
      {
        type: "pointerMove",
        pointerId: 3,
        point: { x: 40.4, y: 40.6 },
        scale: 0.4,
      },
      {
        type: "pointerMove",
        pointerId: 3,
        point: { x: 41, y: 40 },
        scale: 0.4,
      },
      { type: "pointerUp", pointerId: 3 },
    );
    expect(wobbled.corners).toEqual(state.corners);
    expect(frameMoved(wobbled)).toBe(false);
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: true,
        moved: frameMoved(wobbled),
      }),
    ).toEqual({ kind: "none" });
  });

  it("F15: the drag slop (candidate): touch 8 screen px, mouse and pen 2; at it nothing moves, past it the corner follows the whole way", () => {
    expect(PAPER_ADJUST_LAYOUT.dragSlopTouchScreenPx).toBe(8);
    expect(PAPER_ADJUST_LAYOUT.dragSlopFineScreenPx).toBe(2);
    for (const [pointerType, slop] of [
      ["touch", 8],
      ["mouse", 2],
      ["pen", 2],
    ] as const) {
      expect(dragSlopScreenPx(pointerType)).toBe(slop);
      const press = {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType,
        point: { x: 100, y: 100 },
      } as const;
      const at = (dx: number): AdjustAction => ({
        type: "pointerMove",
        pointerId: 1,
        point: { x: 100 + dx, y: 100 },
        scale: 0.5,
      });
      const state = open();
      expect(frameMoved(run(state, press, at(slop)))).toBe(false);
      const past = run(state, press, at(slop + 1));
      expect(past.corners[0].x - state.corners[0].x).toBeCloseTo(
        (slop + 1) / 0.5,
        9,
      );
      expect(frameMoved(past)).toBe(true);
      // Once past it, a small way back still moves the corner (no new slop).
      const back = run(state, press, at(slop + 1), at(1));
      expect(back.corners[0].x - state.corners[0].x).toBeCloseTo(1 / 0.5, 9);
      expect(frameMoved(back)).toBe(true);
    }
  });

  it("moved: measured again from the moved frame, as adjusted (the pipeline's input and the event's paper say so)", () => {
    const moved = run(open(), {
      type: "nudge",
      index: 3,
      dx: 1,
      dy: 0,
      big: true,
      scale: 1,
    });
    expect(frameMoved(moved)).toBe(true);
    const ready = adjustReadiness(moved);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.source).toBe("adjusted");
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: true,
        moved: true,
      }),
    ).toEqual({ kind: "rerun" });
    const input = pipelinePaperInput({
      typedLengthMm: null,
      paperSize: "a4",
      manualPaperCorners: { corners: ready.corners, source: ready.source },
    });
    expect(input.paper).toBe("adjusted");
    expect(input.pipeline.manualPaperCorners?.source).toBe("adjusted");
  });

  it("does nothing without the file, or once the result is no longer the measurement", () => {
    expect(
      adjustConfirmAction({
        entry: "review",
        result: measured,
        hasFile: false,
        moved: true,
      }),
    ).toEqual({ kind: "none" });
    expect(
      adjustConfirmAction({
        entry: "review",
        result: { kind: "processing" },
        hasFile: true,
        moved: true,
      }),
    ).toEqual({ kind: "none" });
  });

  it("F15: no entry ever records instead of measuring: confirm is rerun or none, nothing else", () => {
    for (const entry of ["rescue", "review", null] as const)
      for (const moved of [false, true])
        for (const hasFile of [false, true])
          for (const result of [
            measured,
            {
              kind: "gateFailure" as const,
              errors: [issue("PAPER_CURLED")],
              overlay: overlay({ paperCorners: RECT }),
            },
          ])
            expect(["rerun", "none"]).toContain(
              adjustConfirmAction({ entry, result, hasFile, moved }).kind,
            );
  });
});

describe("confirmCornerCheck (F15: the corner record written on every confirm of review, in place of the ?debug=1 check)", () => {
  const measured = {
    kind: "measured" as const,
    overlay: overlay({ paperCorners: RECT }),
    submission: AUTO,
  };

  it("confirmed as it opened: four zero distances, the photo's long edge, the magnifier on", () => {
    expect(
      confirmCornerCheck({ entry: "review", result: measured, corners: RECT }),
    ).toEqual({
      magnifier: true,
      distancesPx: [0, 0, 0, 0],
      imageLongEdgePx: 1920,
    });
  });

  it("moved: how far each corner is from the detector's, corner to corner (simulated, 模擬)", () => {
    const moved: Quad4 = [
      { x: 203, y: 304 },
      RECT[1],
      RECT[2],
      { x: 200, y: 1162 },
    ];
    const check = confirmCornerCheck({
      entry: "review",
      result: measured,
      corners: moved,
    });
    expect(check?.distancesPx).toEqual([5, 0, 0, 12]);
    // A frame given starting from another corner is still compared corner to corner.
    const rotated: Quad4 = [moved[2], moved[3], moved[0], moved[1]];
    expect(
      confirmCornerCheck({
        entry: "review",
        result: measured,
        corners: rotated,
      })?.distancesPx,
    ).toEqual([5, 0, 0, 12]);
  });

  it("nothing for a rescue, for no entry, for a result that is not a measurement, or with no detector corners", () => {
    expect(
      confirmCornerCheck({ entry: "rescue", result: measured, corners: RECT }),
    ).toBeNull();
    expect(
      confirmCornerCheck({ entry: null, result: measured, corners: RECT }),
    ).toBeNull();
    expect(
      confirmCornerCheck({
        entry: "review",
        result: {
          kind: "gateFailure",
          errors: [issue("PAPER_CURLED")],
          overlay: overlay({ paperCorners: RECT }),
        },
        corners: RECT,
      }),
    ).toBeNull();
    expect(
      confirmCornerCheck({
        entry: "review",
        result: { ...measured, overlay: overlay() },
        corners: RECT,
      }),
    ).toBeNull();
  });

  it("an undecoded photo's long edge is recorded as unknown", () => {
    expect(
      confirmCornerCheck({
        entry: "review",
        result: {
          ...measured,
          overlay: overlay({
            paperCorners: RECT,
            imageWidth: 0,
            imageHeight: 0,
          }),
        },
        corners: RECT,
      })?.imageLongEdgePx,
    ).toBeNull();
  });
});

describe("fitPhoto", () => {
  it("fits the whole photo inside the stage less the inset, centred, and converts both ways", () => {
    const fit = fitPhoto(IMAGE, { width: 390, height: 600 }, 24);
    expect(fit.height).toBeCloseTo(552, 6);
    expect(fit.width).toBeCloseTo((552 * 1024) / 1920, 6);
    expect(fit.offsetY).toBeCloseTo(24, 6);
    expect(fit.offsetX).toBeCloseTo((390 - fit.width) / 2, 6);
    const p = { x: 333, y: 777 };
    const back = toImage(toScreen(p, fit), fit);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("is empty for a stage with no room", () => {
    expect(fitPhoto(IMAGE, { width: 40, height: 40 }, 24).width).toBe(0);
    expect(
      fitPhoto({ width: 0, height: 0 }, { width: 400, height: 400 }).width,
    ).toBe(0);
  });
});

describe("startAdjust", () => {
  it("rescue: starts from the detector's corners, all placed", () => {
    const s = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperCorners: RECT }),
      paperSize: "a4",
    });
    expect(s.start.from).toBe("detected");
    expect(s.corners).toEqual(RECT);
    expect(s.placed).toEqual([true, true, true, true]);
  });

  it("rescue after a hidden corner: three corners placed, the guess inside the sheet not (F14)", () => {
    const s = startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
    });
    expect(s.start.from).toBe("partial");
    expect(s.start.detected).toEqual([true, false, true, true]);
    expect(s.placed).toEqual([true, false, true, true]);
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 1 });
  });

  it("F15: review opens on the detector's own corners, all placed, so it may be confirmed at once", () => {
    const s = startAdjust({
      entry: "review",
      overlay: overlay({ paperCorners: RECT }),
      paperSize: "a4",
    });
    expect(s.start.from).toBe("detected");
    expect(s.placed).toEqual([true, true, true, true]);
    expect(s.corners).toEqual(RECT);
    expect(adjustReadiness(s)).toMatchObject({ ok: true, source: "adjusted" });
  });
});

const rescue = () =>
  startAdjust({
    entry: "rescue",
    overlay: overlay({ paperCorners: RECT }),
    paperSize: "a4",
  });

describe("relative drag", () => {
  const scale = 0.5; // screen px per photo px

  it("a corner does not jump to the finger: it moves by the finger's movement", () => {
    let s = run(rescue(), {
      type: "pointerDown",
      index: 0,
      pointerId: 7,
      pointerType: "touch",
      // 20 screen px away from the corner's own place on screen
      point: { x: 120, y: 170 },
    });
    expect(s.corners[0]).toEqual(RECT[0]);
    expect(s.selected).toBe(0);
    s = run(s, {
      type: "pointerMove",
      pointerId: 7,
      point: { x: 150, y: 158 },
      scale,
    });
    expect(s.corners[0]).toEqual({ x: 200 + 30 / scale, y: 300 - 12 / scale });
    // The other corners do not move.
    expect(s.corners.slice(1)).toEqual(RECT.slice(1));
  });

  it("once a corner is chosen, a press anywhere on the photo drags it (trackpad)", () => {
    let s = run(rescue(), { type: "select", index: 2 });
    s = run(
      s,
      {
        type: "pointerDown",
        index: null,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 10, y: 10 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 14, y: 7 }, scale },
    );
    expect(s.corners[2]).toEqual({ x: 808, y: 1144 });
  });

  it("a press on the photo with no corner chosen moves nothing and says to choose one", () => {
    const s = run(rescue(), {
      type: "pointerDown",
      index: null,
      pointerId: 1,
      pointerType: "mouse",
      point: { x: 10, y: 10 },
    });
    expect(s.drag).toBeNull();
    expect(s.notice).toEqual({ kind: "chooseCorner" });
  });

  it("follows one pointer only, stops on release, and keeps the corner within 10 % beyond the photo (F10, R6 F2)", () => {
    let s = run(rescue(), {
      type: "pointerDown",
      index: 1,
      pointerId: 1,
      pointerType: "touch",
      point: { x: 0, y: 0 },
    });
    s = run(
      s,
      // A second finger: ignored.
      {
        type: "pointerDown",
        index: 3,
        pointerId: 2,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 2, point: { x: 50, y: 50 }, scale },
    );
    expect(s.corners).toEqual(RECT);
    s = run(s, {
      type: "pointerMove",
      pointerId: 1,
      point: { x: 1000, y: -1000 },
      scale,
    });
    // Not clamped to the photo's edge any more: as far out as
    // checkManualQuad allows (maxOutsideFraction), no further.
    const OUT = {
      x: IMAGE.width * (1 + MANUAL_QUAD_LIMITS.maxOutsideFraction),
      y: -IMAGE.height * MANUAL_QUAD_LIMITS.maxOutsideFraction,
    };
    expect(s.corners[1]).toEqual(OUT);
    s = run(
      s,
      { type: "pointerUp", pointerId: 1 },
      { type: "pointerMove", pointerId: 1, point: { x: 0, y: 0 }, scale },
    );
    expect(s.drag).toBeNull();
    expect(s.corners[1]).toEqual(OUT);
  });

  it("the guessed fourth corner: a tap leaves it not placed; a drag onto the sheet's corner moves it there and places it", () => {
    const start = startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
    });
    let s = run(
      start,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 5, y: 5 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 5, y: 5 }, scale },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(s.placed[1]).toBe(false);
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 1 });
    expect(s.corners).toEqual(start.corners);
    s = run(
      s,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 2,
        pointerType: "touch",
        point: { x: 5, y: 5 },
      },
      // The guess starts inside the sheet: dragged the whole way to TR.
      {
        type: "pointerMove",
        pointerId: 2,
        point: {
          x: 5 + (RECT[1].x - s.corners[1].x) * scale,
          y: 5 + (RECT[1].y - s.corners[1].y) * scale,
        },
        scale,
      },
    );
    expect(s.placed[1]).toBe(true);
    expect(s.corners[1].x).toBeCloseTo(RECT[1].x, 9);
    expect(s.corners[1].y).toBeCloseTo(RECT[1].y, 9);
  });

  it("a pointer back where the press began puts the corner back where it started", () => {
    // The review's case: out 3 screen px and back to the very same point.
    let s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 100, y: 100 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 103, y: 100 }, scale },
    );
    expect(s.corners[0]).toEqual({ x: 200 + 3 / scale, y: 300 });
    expect(s.drag?.moved).toBe(true);
    s = run(
      s,
      { type: "pointerMove", pointerId: 1, point: { x: 100, y: 100 }, scale },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(s.corners[0]).toEqual(RECT[0]);
    expect(s.placed[0]).toBe(true);
  });

  it("a press that never moves leaves the drag unmoved", () => {
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 100, y: 100 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 100, y: 100 }, scale },
    );
    expect(s.drag?.moved).toBe(false);
    expect(s.corners).toEqual(RECT);
  });
});

describe("the corner the detector did not find (F14): opens not placed, any move places it, the other three open placed", () => {
  const partial = () =>
    startAdjust({
      entry: "rescue",
      overlay: overlay({
        paperPartialCorners: [RECT[0], null, RECT[2], RECT[3]],
      }),
      paperSize: "a4",
    });

  it("names the guessed corner, only in a partial start", () => {
    const s = partial();
    expect([0, 1, 2, 3].map((i) => isGuessedCorner(s, i as 0))).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect([0, 1, 2, 3].map((i) => isGuessedCorner(rescue(), i as 0))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("as it opened: not usable, the guessed corner is the one still to place", () => {
    const s = partial();
    expect(s.placed).toEqual([true, false, true, true]);
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 1 });
  });

  it("a tap or a press without a move, on the guessed corner or the photo, places nothing", () => {
    const tapped = run(
      partial(),
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 5, y: 5 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 5, y: 5 }, scale: 1 },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(tapped.placed).toEqual([true, false, true, true]);
    expect(adjustReadiness(tapped)).toEqual({ ok: false, notPlaced: 1 });
    const selected = run(partial(), { type: "select", index: 1 });
    expect(selected.placed).toEqual([true, false, true, true]);
  });

  it("dragging only the guessed corner, the other three untouched, makes the frame usable (manual)", () => {
    const start = partial();
    const scale = 0.5;
    const s = run(
      start,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      },
      {
        type: "pointerMove",
        pointerId: 1,
        point: {
          x: (RECT[1].x - start.corners[1].x) * scale,
          y: (RECT[1].y - start.corners[1].y) * scale,
        },
        scale,
      },
      { type: "pointerUp", pointerId: 1 },
    );
    expect(s.placed).toEqual([true, true, true, true]);
    expect([s.corners[0], s.corners[2], s.corners[3]]).toEqual([
      RECT[0],
      RECT[2],
      RECT[3],
    ]);
    const ready = adjustReadiness(s);
    expect(ready.ok).toBe(true);
    if (ready.ok) {
      expect(ready.source).toBe("manual");
      expect(ready.corners[1].x).toBeCloseTo(RECT[1].x, 9);
      expect(ready.corners[1].y).toBeCloseTo(RECT[1].y, 9);
    }
  });

  it("one arrow press, ten with Shift, or a short drag past the tap slop: any move places the guessed corner", () => {
    const k = 0.4;
    for (const big of [false, true]) {
      const nudged = run(partial(), {
        type: "nudge",
        index: 1,
        dx: 1,
        dy: 0,
        big,
        scale: k,
      });
      expect(nudged.placed[1]).toBe(true);
    }
    const dragged = run(
      partial(),
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 9, y: 0 }, scale: 1 },
    );
    expect(dragged.placed[1]).toBe(true);
    expect(adjustReadiness(dragged).ok).toBe(true);
  });

  it("a second finger cancels the drag: the guessed corner is not placed again", () => {
    const s = run(
      partial(),
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "touch",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 1, point: { x: 30, y: 0 }, scale: 1 },
      { type: "dragCancel" },
    );
    expect(s.placed).toEqual([true, false, true, true]);
  });

  it("reset puts it back to not placed", () => {
    const s = run(
      partial(),
      { type: "nudge", index: 1, dx: 1, dy: 0, big: false, scale: 1 },
      { type: "reset" },
    );
    expect(s.placed).toEqual([true, false, true, true]);
  });

  it("a corner the detector found is placed by any move, however small", () => {
    const s = run(partial(), {
      type: "nudge",
      index: 0,
      dx: 1,
      dy: 0,
      big: false,
      scale: 1,
    });
    expect(s.placed[0]).toBe(true);
  });
});

describe("keyboard", () => {
  it("an arrow moves the corner one screen px (in photo px), Shift ten, and chooses it", () => {
    const scale = 0.25;
    let s = run(rescue(), {
      type: "nudge",
      index: 3,
      dx: 1,
      dy: 0,
      big: false,
      scale,
    });
    expect(s.corners[3]).toEqual({ x: 204, y: 1150 });
    expect(s.selected).toBe(3);
    s = run(s, { type: "nudge", index: 3, dx: 0, dy: -1, big: true, scale });
    expect(s.corners[3]).toEqual({ x: 204, y: 1110 });
    expect(PAPER_ADJUST_LAYOUT.keyStepScreenPx).toBe(1);
    expect(PAPER_ADJUST_LAYOUT.keyBigStepFactor).toBe(10);
  });
});

describe("keys and pointer moves become actions at the photo's scale (PaperAdjust.tsx)", () => {
  // A 390 px phone stage, the photo fitted with the handle inset (simulated).
  const fit = fitPhoto(
    IMAGE,
    { width: 390, height: 700 },
    PAPER_ADJUST_LAYOUT.handleTargetPx / 2,
  );

  it("each arrow key nudges its own way, Shift is the big step, other keys do nothing", () => {
    expect(Object.keys(KEY_DIRECTIONS).sort()).toEqual([
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
    ]);
    const cases = [
      ["ArrowLeft", -1, 0],
      ["ArrowRight", 1, 0],
      ["ArrowUp", 0, -1],
      ["ArrowDown", 0, 1],
    ] as const;
    for (const [key, dx, dy] of cases)
      for (const shiftKey of [false, true])
        expect(nudgeForKey({ key, shiftKey, index: 2, fit })).toEqual({
          type: "nudge",
          index: 2,
          dx,
          dy,
          big: shiftKey,
          scale: fit.scale,
        });
    for (const key of ["Enter", " ", "a", "Tab", "toString", "constructor"])
      expect(nudgeForKey({ key, shiftKey: false, index: 0, fit })).toBeNull();
  });

  it("an arrow on screen moves the corner the same way in the photo", () => {
    const up = nudgeForKey({ key: "ArrowUp", shiftKey: false, index: 0, fit })!;
    const s = run(rescue(), up);
    expect(s.corners[0].x).toBe(RECT[0].x);
    expect(s.corners[0].y).toBeCloseTo(RECT[0].y - 1 / fit.scale, 9);
    expect(s.corners[0].y).toBeLessThan(RECT[0].y);
  });

  it("a pointer move carries the fitted scale, so 1 screen px is about 3 photo px on a phone (not 1)", () => {
    const move = pointerMoveFor({ pointerId: 3, point: { x: 11, y: 7 }, fit });
    expect(move).toEqual({
      type: "pointerMove",
      pointerId: 3,
      point: { x: 11, y: 7 },
      scale: fit.scale,
    });
    expect(fit.scale).toBeLessThan(0.35);
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 3,
        pointerType: "touch",
        point: { x: 10, y: 7 },
      },
      // Past the tap slop first; from then on the corner follows exactly.
      { ...move, point: { x: 30, y: 7 } },
      move,
    );
    expect(s.corners[0].x - RECT[0].x).toBeCloseTo(1 / fit.scale, 9);
    expect(s.corners[0].x - RECT[0].x).toBeGreaterThan(2.5);
  });
});

describe("what the pipeline is told about the paper (pipelinePaperInput)", () => {
  const corners = { corners: RECT, source: "manual" as const };

  it("with paper and a placed frame: the frame goes in and the event says adjusted", () => {
    expect(
      pipelinePaperInput({
        typedLengthMm: null,
        paperSize: "letter",
        manualPaperCorners: corners,
      }),
    ).toEqual({
      pipeline: {
        calibration: { method: "paper-edge", paperSize: "letter" },
        manualPaperCorners: corners,
      },
      paper: "adjusted",
    });
  });

  it("with a typed length: no frame, whatever was placed, and no sheet", () => {
    const r = pipelinePaperInput({
      typedLengthMm: 190,
      paperSize: "a4",
      manualPaperCorners: corners,
    });
    expect(r).toEqual({
      pipeline: { calibration: { method: "user-length", handLengthMm: 190 } },
      paper: "none",
    });
    expect("manualPaperCorners" in r.pipeline).toBe(false);
  });

  it("with paper and no frame: the detector's run, detected", () => {
    const r = pipelinePaperInput({ typedLengthMm: null, paperSize: "a4" });
    expect(r).toEqual({
      pipeline: { calibration: { method: "paper-edge", paperSize: "a4" } },
      paper: "detected",
    });
    expect("manualPaperCorners" in r.pipeline).toBe(false);
  });
});

describe("a corner under the hand: two marks on its edges", () => {
  // A tilted sheet (simulated): its BR corner is hidden; the person marks the
  // bottom edge and the right edge halfway.
  const scene = buildR5Scene({ pitchDeg: 8 });
  const c = scene.corners;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const start = (): AdjustState => {
    const s = startAdjust({
      entry: "rescue",
      overlay: overlay({ paperPartialCorners: [c[0], c[1], null, c[3]] }),
      paperSize: "a4",
    });
    return run(s, { type: "select", index: 2 }, { type: "edgeStart" });
  };

  it("needs a chosen corner first", () => {
    const s = run(rescue(), { type: "edgeStart" });
    expect(s.edge).toBeNull();
    expect(s.notice).toEqual({ kind: "chooseCorner" });
  });

  it("asks for the edge to the previous corner, then the next, and works the corner out", () => {
    let s = start();
    expect(s.edge).toEqual({ index: 2, points: [] });
    expect(edgeStepOf(s.edge!)).toEqual({ step: 1, other: 1 });
    s = run(s, { type: "edgeTap", point: mid(c[1], c[2]) });
    expect(edgeStepOf(s.edge!)).toEqual({ step: 2, other: 3 });
    s = run(s, { type: "edgeTap", point: mid(c[3], c[2]) });
    expect(s.edge).toBeNull();
    expect(s.notice).toEqual({ kind: "edgeSolved", index: 2 });
    expect(
      Math.hypot(s.corners[2].x - c[2].x, s.corners[2].y - c[2].y),
    ).toBeLessThan(0.05);
    expect(s.placed[2]).toBe(true);
    expect(adjustReadiness(s)).toMatchObject({ ok: true, source: "manual" });
  });

  it("refuses to start while a neighbour of the hidden corner is only a starting guess", () => {
    // No corners found: the centred sheet, nothing placed.
    for (const entry of ["rescue"] as const) {
      let s = startAdjust({ entry, overlay: overlay(), paperSize: "a4" });
      expect(s.start.from).toBe("centred");
      s = run(s, { type: "select", index: 1 }, { type: "edgeStart" });
      expect(s.edge).toBeNull();
      expect(s.notice).toEqual({
        kind: "placeNeighboursFirst",
        index: 1,
        missing: 0,
      });
      // Taps outside the edge mode change nothing.
      const before = s;
      s = run(
        s,
        { type: "edgeTap", point: { x: 300, y: 300 } },
        { type: "edgeTap", point: { x: 600, y: 700 } },
      );
      expect(s).toBe(before);
      expect(s.placed[1]).toBe(false);
      // One neighbour placed is not enough.
      s = run(s, {
        type: "nudge",
        index: 0,
        dx: 1,
        dy: 0,
        big: false,
        scale: 1,
      });
      s = run(s, { type: "select", index: 1 }, { type: "edgeStart" });
      expect(s.notice).toEqual({
        kind: "placeNeighboursFirst",
        index: 1,
        missing: 2,
      });
      // Both placed: the marks may begin.
      s = run(
        s,
        { type: "nudge", index: 2, dx: 0, dy: 1, big: false, scale: 1 },
        { type: "select", index: 1 },
        { type: "edgeStart" },
      );
      expect(s.edge).toEqual({ index: 1, points: [] });
      expect(s.notice).toBeNull();
    }
  });

  it("refuses the second tap too when a neighbour stopped being placed meanwhile", () => {
    let s = run(start(), { type: "edgeTap", point: mid(c[1], c[2]) });
    s = { ...s, placed: [true, false, false, true] };
    s = run(s, { type: "edgeTap", point: mid(c[3], c[2]) });
    expect(s.edge).toBeNull();
    expect(s.placed[2]).toBe(false);
    expect(s.notice).toEqual({
      kind: "placeNeighboursFirst",
      index: 2,
      missing: 1,
    });
  });

  const solvedBR = () =>
    run(
      start(),
      { type: "edgeTap", point: mid(c[1], c[2]) },
      { type: "edgeTap", point: mid(c[3], c[2]) },
    );

  it("a worked-out corner goes back to not placed when either neighbour moves (drag or keys)", () => {
    const solved = solvedBR();
    expect(solved.placed[2]).toBe(true);
    expect(solved.solved).toEqual([false, false, true, false]);

    const keyed = run(solved, {
      type: "nudge",
      index: 1,
      dx: 0,
      dy: 1,
      big: true,
      scale: 1,
    });
    expect(keyed.placed).toEqual([true, true, false, true]);
    expect(keyed.solved).toEqual([false, false, false, false]);
    expect(keyed.corners[2]).toEqual(solved.corners[2]);
    expect(keyed.notice).toEqual({ kind: "edgeUndone", index: 2 });
    expect(adjustReadiness(keyed)).toEqual({ ok: false, notPlaced: 2 });

    const dragged = run(
      solved,
      {
        type: "pointerDown",
        index: 3,
        pointerId: 7,
        pointerType: "touch",
        point: { x: 100, y: 100 },
      },
      {
        type: "pointerMove",
        pointerId: 7,
        point: { x: 104, y: 100 },
        scale: 0.5,
      },
      {
        type: "pointerMove",
        pointerId: 7,
        point: { x: 110, y: 100 },
        scale: 0.5,
      },
      { type: "pointerUp", pointerId: 7 },
    );
    expect(dragged.placed[2]).toBe(false);
    expect(dragged.notice).toEqual({ kind: "edgeUndone", index: 2 });
    expect(adjustReadiness(dragged)).toEqual({ ok: false, notPlaced: 2 });

    // The neighbour put back on the paper's corner, the marks again: placed again.
    const again = run(
      keyed,
      { type: "nudge", index: 1, dx: 0, dy: -1, big: true, scale: 1 },
      { type: "select", index: 2 },
      { type: "edgeStart" },
      { type: "edgeTap", point: mid(c[1], c[2]) },
      { type: "edgeTap", point: mid(c[3], c[2]) },
    );
    expect(again.corners[1]).toEqual(c[1]);
    expect(again.notice).toEqual({ kind: "edgeSolved", index: 2 });
    expect(again.placed).toEqual([true, true, true, true]);
    expect(
      Math.hypot(again.corners[2].x - c[2].x, again.corners[2].y - c[2].y),
    ).toBeLessThan(0.05);
  });

  it("a move of a corner that is not a neighbour, or a press without a move, leaves it placed", () => {
    const solved = solvedBR();
    const opposite = run(solved, {
      type: "nudge",
      index: 0,
      dx: 1,
      dy: 1,
      big: false,
      scale: 1,
    });
    expect(opposite.placed[2]).toBe(true);
    expect(opposite.solved[2]).toBe(true);
    const pressed = run(
      solved,
      {
        type: "pointerDown",
        index: 1,
        pointerId: 3,
        pointerType: "mouse",
        point: { x: 50, y: 50 },
      },
      { type: "pointerMove", pointerId: 3, point: { x: 50, y: 50 }, scale: 1 },
      { type: "pointerUp", pointerId: 3 },
    );
    expect(pressed.placed[2]).toBe(true);
  });

  it("once the person drags the worked-out corner itself, it no longer depends on its neighbours", () => {
    let s = run(solvedBR(), {
      type: "nudge",
      index: 2,
      dx: 1,
      dy: 0,
      big: false,
      scale: 1,
    });
    expect(s.solved[2]).toBe(false);
    s = run(s, { type: "nudge", index: 1, dx: 0, dy: 1, big: false, scale: 1 });
    expect(s.placed[2]).toBe(true);
    expect(s.notice).toBeNull();
  });

  it("reset forgets which corners were worked out", () => {
    const s = run(solvedBR(), { type: "reset" });
    expect(s.solved).toEqual([false, false, false, false]);
    // Back to the opening frame, placed as it opened (F14: the three found
    // corners; the hidden one is a guess, not placed).
    expect(s.placed).toEqual([true, true, false, true]);
    expect(s.corners).toEqual(start().corners);
  });

  it("says why when it cannot, leaves the corner where it was, and starts the marks again", () => {
    let s = start();
    const before = s.corners[2];
    // Both marks on the bottom edge's line: the two "edges" are parallel.
    s = run(
      s,
      { type: "edgeTap", point: { x: c[3].x + 50, y: c[3].y } },
      { type: "edgeTap", point: { x: c[3].x + 100, y: c[3].y } },
    );
    expect(s.notice?.kind).toBe("edgeProblem");
    expect(s.corners[2]).toEqual(before);
    // Where it opened, and as it opened (a guess: not placed, F14).
    expect(s.placed[2]).toBe(false);
    expect(s.edge).toEqual({ index: 2, points: [] });
    s = run(s, { type: "edgeCancel" });
    expect(s.edge).toBeNull();
  });
});

describe("adjustReadiness", () => {
  it("the detector's corners may be used as they are: adjusted", () => {
    expect(adjustReadiness(rescue())).toEqual({
      ok: true,
      corners: RECT,
      source: "adjusted",
    });
  });

  it("a corner of the centred sheet not moved yet blocks it, and says which (F14: only that frame asks for it)", () => {
    const s = run(
      startAdjust({ entry: "rescue", overlay: overlay(), paperSize: "a4" }),
      { type: "nudge", index: 0, dx: 1, dy: 0, big: false, scale: 1 },
    );
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 1 });
  });

  it("two corners dragged onto the photo's corner block it as degenerate (no crash later)", () => {
    // TR and BR both dragged far past the photo's top-right: both stop at the
    // same point, 10 % beyond it (F10).
    const far = { x: 5000, y: -5000 };
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 1,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 1, point: far, scale: 1 },
      { type: "pointerUp", pointerId: 1 },
      {
        type: "pointerDown",
        index: 2,
        pointerId: 2,
        pointerType: "mouse",
        point: { x: 0, y: 0 },
      },
      { type: "pointerMove", pointerId: 2, point: far, scale: 1 },
      { type: "pointerUp", pointerId: 2 },
    );
    const out = {
      x: IMAGE.width * (1 + MANUAL_QUAD_LIMITS.maxOutsideFraction),
      y: -IMAGE.height * MANUAL_QUAD_LIMITS.maxOutsideFraction,
    };
    expect(s.corners[1]).toEqual(out);
    expect(s.corners[2]).toEqual(out);
    expect(adjustReadiness(s)).toEqual({ ok: false, problem: "degenerate" });
  });

  it("a crossed frame blocks it with its problem", () => {
    const s = run(
      rescue(),
      {
        type: "pointerDown",
        index: 0,
        pointerId: 1,
        pointerType: "mouse",
        point: { x: 0, y: 0 },
      },
      // TL dragged past TR and below the bottom edge: the frame crosses itself.
      {
        type: "pointerMove",
        pointerId: 1,
        point: { x: 700, y: 1000 },
        scale: 1,
      },
    );
    expect(adjustReadiness(s)).toMatchObject({ ok: false });
    const r = adjustReadiness(s);
    expect("problem" in r && r.problem).toMatch(/self_intersecting|not_convex/);
  });

  it("the centred sheet needs all four corners placed by hand", () => {
    let s = startAdjust({
      entry: "rescue",
      overlay: overlay(),
      paperSize: "a4",
    });
    expect(adjustReadiness(s)).toEqual({ ok: false, notPlaced: 0 });
    for (const index of [0, 1, 2, 3] as const)
      s = run(s, { type: "nudge", index, dx: 1, dy: 0, big: false, scale: 1 });
    expect(adjustReadiness(s).ok).toBe(true);
  });

  it("reset goes back to the start", () => {
    const s = run(
      rescue(),
      { type: "nudge", index: 0, dx: 1, dy: 1, big: true, scale: 1 },
      { type: "reset" },
    );
    expect(s.corners).toEqual(RECT);
    expect(s.selected).toBeNull();
  });
});

describe("cornerPositions: a handle is named for where it is", () => {
  it("follows the corners' places, not their indices", () => {
    expect(cornerPositions(RECT)).toEqual([0, 1, 2, 3]);
    const turned: Quad4 = [RECT[1], RECT[2], RECT[3], RECT[0]];
    expect(cornerPositions(turned)).toEqual([1, 2, 3, 0]);
  });
});

describe("magnifierLayout: at least 4x, never under the finger, on the stage or at most MAGNIFIER_EDGE.overflowPx past it (F10)", () => {
  const L = PAPER_ADJUST_LAYOUT;
  // The stage left on a 320x568 phone, a 390x844 phone, and a desktop window.
  const stages = [
    { width: 320, height: 330 },
    { width: 390, height: 600 },
    { width: 1280, height: 640 },
  ];

  it("enlarges at least four times", () => {
    expect(L.magnifierZoom).toBeGreaterThanOrEqual(4);
  });

  for (const stage of stages) {
    it(`${stage.width}x${stage.height}: clear of the finger's disc and within the overflow everywhere`, () => {
      const fit = fitPhoto(IMAGE, stage, L.handleTargetPx / 2);
      for (let x = 0; x <= stage.width; x += 10)
        for (let y = 0; y <= stage.height; y += 10) {
          const m = magnifierLayout({
            pointer: { x, y },
            corner: { x: 500, y: 900 },
            fit,
            stage,
          });
          const cx = m.left + m.size / 2;
          const cy = m.top + m.size / 2;
          const gap = Math.hypot(cx - x, cy - y) - m.size / 2;
          expect(gap, `at ${x},${y}`).toBeGreaterThanOrEqual(
            L.fingerRadiusPx - 1e-9,
          );
          const o = MAGNIFIER_EDGE.overflowPx;
          expect(m.left).toBeGreaterThanOrEqual(-o - 1e-9);
          expect(m.top).toBeGreaterThanOrEqual(-o - 1e-9);
          expect(m.left + m.size).toBeLessThanOrEqual(stage.width + o + 1e-9);
          expect(m.top + m.size).toBeLessThanOrEqual(stage.height + o + 1e-9);
        }
    });

    it(`${stage.width}x${stage.height}: also while it keeps its side (hysteresis), along every path`, () => {
      const fit = fitPhoto(IMAGE, stage, L.handleTargetPx / 2);
      const o = MAGNIFIER_EDGE.overflowPx;
      for (let y = 0; y <= stage.height; y += 20) {
        let previous: MagnifierPlacement | null = null;
        for (let x = 0; x <= stage.width; x += 4) {
          const m = magnifierLayout({
            pointer: { x, y },
            corner: { x: 500, y: 900 },
            fit,
            stage,
            previous,
          });
          previous = m;
          const gap =
            Math.hypot(m.left + m.size / 2 - x, m.top + m.size / 2 - y) -
            m.size / 2;
          expect(gap, `at ${x},${y}`).toBeGreaterThanOrEqual(
            L.fingerRadiusPx - 1e-9,
          );
          expect(m.left).toBeGreaterThanOrEqual(-o - 1e-9);
          expect(m.left + m.size).toBeLessThanOrEqual(stage.width + o + 1e-9);
          expect(m.top).toBeGreaterThanOrEqual(-o - 1e-9);
          expect(m.top + m.size).toBeLessThanOrEqual(stage.height + o + 1e-9);
        }
      }
    });
  }

  it("the named edge margins (candidates): switch only past 24 px, overflow at most 12 px", () => {
    expect(MAGNIFIER_EDGE.switchPx).toBe(24);
    expect(MAGNIFIER_EDGE.overflowPx).toBe(12);
    // Keeping a side while overflowing never brings it under the finger.
    expect(MAGNIFIER_EDGE.overflowPx).toBeLessThan(L.fingerGapPx);
    expect(MAGNIFIER_EDGE.switchPx).toBeGreaterThan(MAGNIFIER_EDGE.overflowPx);
  });

  it("near the top, moving left and right across the middle: it stays on one side instead of jumping every frame (Kirby 2026-10-21/22)", () => {
    const stage = { width: 390, height: 600 };
    // Too close to the top for "above": beside the finger.
    const y = 60;
    let previous: MagnifierPlacement | null = null;
    const sides: string[] = [];
    for (let i = 0; i < 40; i++) {
      // Back and forth by 6 px around the middle, where the roomier side flips.
      const x = stage.width / 2 + (i % 2 === 0 ? -3 : 3);
      previous = magnifierPlacement({ pointer: { x, y }, stage, previous });
      sides.push(previous.side);
    }
    expect(new Set(sides).size).toBe(1);
    // Without the previous frame, the same two points DO pick opposite sides:
    // the jumping this fixes.
    const a = magnifierPlacement({ pointer: { x: 192, y }, stage });
    const b = magnifierPlacement({ pointer: { x: 198, y }, stage });
    expect(a.side).not.toBe(b.side);
  });

  it("near a side edge it overflows a little rather than switch, and switches only past the margin", () => {
    const stage = { width: 390, height: 600 };
    const y = 60;
    // Start on the right, then walk the finger right toward the edge.
    let previous: MagnifierPlacement | null = magnifierPlacement({
      pointer: { x: 150, y },
      stage,
    });
    expect(previous.side).toBe("right");
    const switchedAt: number[] = [];
    for (let x = 150; x <= 390; x += 2) {
      const next = magnifierPlacement({ pointer: { x, y }, stage, previous });
      if (next.side !== previous.side) switchedAt.push(x);
      // While it stays right it runs at most overflowPx past the edge.
      if (next.side === "right")
        expect(next.left + next.size).toBeLessThanOrEqual(
          stage.width + MAGNIFIER_EDGE.overflowPx + 1e-9,
        );
      previous = next;
    }
    expect(switchedAt).toHaveLength(1);
    // The switch happens only where staying right would overflow by > 24 px.
    const L0 = PAPER_ADJUST_LAYOUT;
    const size = L0.magnifierPx;
    const clear = L0.fingerRadiusPx + L0.fingerGapPx + size / 2;
    const overflowAt = (x: number) => x + clear + size / 2 - stage.width;
    expect(overflowAt(switchedAt[0])).toBeGreaterThan(MAGNIFIER_EDGE.switchPx);
    expect(overflowAt(switchedAt[0] - 2)).toBeLessThanOrEqual(
      MAGNIFIER_EDGE.switchPx,
    );
    // Walking back a little does not switch it back.
    let back = previous!;
    for (let x = 390; x >= 300; x -= 2) {
      back = magnifierPlacement({ pointer: { x, y }, stage, previous: back });
      expect(back.side).toBe("left");
    }
  });

  it("from beside the finger it goes back above only with the margin to spare (no flicker at the top)", () => {
    const stage = { width: 390, height: 600 };
    const L0 = PAPER_ADJUST_LAYOUT;
    const size = L0.magnifierPx;
    const clear = L0.fingerRadiusPx + L0.fingerGapPx + size / 2;
    // The finger's y at which "above" just fits (its top at 0).
    const fitsAt = clear + size / 2;
    let previous: MagnifierPlacement | null = magnifierPlacement({
      pointer: { x: 100, y: fitsAt - 30 },
      stage,
    });
    expect(previous.side).not.toBe("above");
    const sides: string[] = [];
    // Up and down by 10 px around the line where above starts to fit.
    for (let i = 0; i < 30; i++) {
      const y = fitsAt + (i % 2 === 0 ? -5 : 5);
      previous = magnifierPlacement({
        pointer: { x: 100, y },
        stage,
        previous,
      });
      sides.push(previous.side);
    }
    expect(new Set(sides).size).toBe(1);
    // With the margin to spare it does go back above.
    previous = magnifierPlacement({
      pointer: { x: 100, y: fitsAt + MAGNIFIER_EDGE.switchPx },
      stage,
      previous,
    });
    expect(previous.side).toBe("above");
  });

  it("goes above the finger when there is room, beside it near the top", () => {
    const stage = { width: 390, height: 600 };
    const fit = fitPhoto(IMAGE, stage, 24);
    const corner = { x: 500, y: 900 };
    expect(
      magnifierLayout({ pointer: { x: 200, y: 400 }, corner, fit, stage }).side,
    ).toBe("above");
    expect(
      magnifierLayout({ pointer: { x: 60, y: 40 }, corner, fit, stage }).side,
    ).toBe("right");
    expect(
      magnifierLayout({ pointer: { x: 330, y: 40 }, corner, fit, stage }).side,
    ).toBe("left");
  });

  it("shows the corner (not the finger) at its centre, enlarged", () => {
    const stage = { width: 390, height: 600 };
    const fit = fitPhoto(IMAGE, stage, 24);
    const corner = { x: 512, y: 960 };
    const m = magnifierLayout({
      pointer: { x: 200, y: 400 },
      corner,
      fit,
      stage,
    });
    expect(m.backgroundWidth).toBeCloseTo(fit.width * L.magnifierZoom, 9);
    expect(m.backgroundX + corner.x * fit.scale * L.magnifierZoom).toBeCloseTo(
      m.size / 2,
      9,
    );
    expect(m.backgroundY + corner.y * fit.scale * L.magnifierZoom).toBeCloseTo(
      m.size / 2,
      9,
    );
  });
});

describe("cornerCheckDistances", () => {
  it("compares corner to corner whichever corner the placed frame starts from", () => {
    const placed: Quad4 = [
      { x: 803, y: 304 },
      { x: 800, y: 1150 },
      { x: 200, y: 1150 },
      { x: 200, y: 300 },
    ];
    expect(cornerCheckDistances(placed, RECT)).toEqual([0, 5, 0, 0]);
  });
});

describe("the named sizes", () => {
  it("a handle's target is at least 44 px", () => {
    expect(L().handleTargetPx).toBeGreaterThanOrEqual(44);
    expect(L().handleDotPx).toBeLessThan(L().handleTargetPx);
  });
});

function L() {
  return PAPER_ADJUST_LAYOUT;
}
