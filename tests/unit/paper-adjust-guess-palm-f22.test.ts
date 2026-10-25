import { describe, expect, it } from "vitest";
import {
  adjustReadiness,
  adjustReducer,
  guessHoldsPalm,
  openingPlaced,
  startAdjust,
} from "../../src/client/camera/paperAdjustState";
import type { PhotoOverlay } from "../../src/client/photo/pipeline";
import type { Quad4 } from "../../src/client/paper/manualQuad";
import type { Point2 } from "../../src/client/geometry/homography";

// V3.2 F22 (final review, candidate): a rough quad around a bright region
// opened placed and could be confirmed at once with no check that it is the
// sheet (a window, a bright desk). It now opens placed only when it holds the
// palm; otherwise every corner has to be moved first.

const IMAGE = { width: 1024, height: 1920 };
const GUESS: Quad4 = [
  { x: 190, y: 310 },
  { x: 815, y: 290 },
  { x: 790, y: 1160 },
  { x: 215, y: 1140 },
];

/** 21 landmarks with the palm (0, 5, 9, 13, 17) around `centre`. */
function hand(centre: Point2): Point2[] {
  const pts: Point2[] = Array.from({ length: 21 }, () => ({ ...centre }));
  pts[0] = { x: centre.x, y: centre.y + 120 };
  pts[5] = { x: centre.x - 60, y: centre.y - 40 };
  pts[9] = { x: centre.x - 20, y: centre.y - 50 };
  pts[13] = { x: centre.x + 20, y: centre.y - 45 };
  pts[17] = { x: centre.x + 60, y: centre.y - 30 };
  return pts;
}

const overlay = (landmarksPx: Point2[] | null): PhotoOverlay => ({
  imageWidth: IMAGE.width,
  imageHeight: IMAGE.height,
  markers: [],
  card: null,
  landmarksPx,
  paperGuessCorners: GUESS,
});

describe("F22: a rough quad opens placed only when it holds the palm", () => {
  it("the palm inside the rough quad: every corner placed, usable at once (unchanged)", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay(hand({ x: 500, y: 800 })),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("guess");
    expect(state.start.withoutPalm).toBeUndefined();
    expect(state.placed).toEqual([true, true, true, true]);
    expect(adjustReadiness(state).ok).toBe(true);
  });

  it("the palm outside it (the quad is a window above the hand): no corner placed, confirm refused until they are moved", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay(hand({ x: 500, y: 1600 })),
      paperSize: "a4",
    });
    expect(state.start.from).toBe("guess");
    expect(state.start.withoutPalm).toBe(true);
    expect(state.placed).toEqual([false, false, false, false]);
    expect(openingPlaced(state.start)).toEqual([false, false, false, false]);
    expect(adjustReadiness(state).ok).toBe(false);
  });

  it("reset goes back to the same opening: still nothing placed", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay(hand({ x: 500, y: 1600 })),
      paperSize: "a4",
    });
    const after = adjustReducer(state, { type: "reset" });
    expect(after.placed).toEqual([false, false, false, false]);
  });

  it("no hand on record: nothing is known, the rough quad keeps its usual opening", () => {
    const state = startAdjust({
      entry: "rescue",
      overlay: overlay(null),
      paperSize: "a4",
    });
    expect(state.placed).toEqual([true, true, true, true]);
  });

  it("guessHoldsPalm: only rough quads are checked; 4 of 5 palm points is enough; non-finite points count as no hand", () => {
    const detected = {
      corners: GUESS,
      detected: [true, true, true, true] as const,
      from: "detected" as const,
    };
    expect(guessHoldsPalm(detected, hand({ x: 500, y: 1700 }))).toBe(true);
    const guess = { ...detected, from: "guess" as const };
    const four = hand({ x: 500, y: 800 });
    four[0] = { x: 500, y: 1800 };
    expect(guessHoldsPalm(guess, four)).toBe(true);
    const three = hand({ x: 500, y: 800 });
    three[0] = { x: 500, y: 1800 };
    three[17] = { x: 1000, y: 800 };
    expect(guessHoldsPalm(guess, three)).toBe(false);
    const broken = hand({ x: 500, y: 1700 });
    broken[9] = { x: Number.NaN, y: 0 };
    expect(guessHoldsPalm(guess, broken)).toBe(true);
  });
});
