import { describe, expect, it } from "vitest";
import {
  ANCHOR_PROGRESS,
  planLateSwitch,
  progressAtOffset,
  readingOffset,
  scrollForTarget,
  storyAnchors,
} from "@/lib/particles/late-start";
import { MARKS, sectionProgress } from "@/lib/particles/timeline";

// The static story as the production build lays it out at 1280x800
// (measured: section 2117 px tall; hand at 707 + 749, notes at 1488 + 395,
// mice at 1931 + 185) and the animated one there (400svh, 100svh panel).
const VH = 800;
const STATIC_HEIGHT = 2117;
const ANIMATED_HEIGHT = 4 * VH;
const blocks = {
  hand: { top: 707, height: 749 },
  notes: { top: 1488, height: 395 },
  mice: { top: 1931, height: 185 },
};
const anchors = storyAnchors({ staticHeight: STATIC_HEIGHT, ...blocks });
const plan = (staticTop: number) =>
  planLateSwitch({
    staticTop,
    staticHeight: STATIC_HEIGHT,
    animatedHeight: ANIMATED_HEIGHT,
    panelHeight: VH,
    viewportHeight: VH,
    anchors,
  });

describe("storyAnchors", () => {
  it("matches the top, the hand, the notes, the mice and the end of the static story to the story's marks", () => {
    expect(anchors).toEqual([
      { offset: 0, progress: 0 },
      { offset: 707, progress: MARKS.handFormed },
      { offset: 1488, progress: ANCHOR_PROGRESS.notesTop },
      { offset: 1931, progress: ANCHOR_PROGRESS.miceTop },
      { offset: 1931 + 185, progress: MARKS.miceSettled },
      { offset: STATIC_HEIGHT, progress: 1 },
    ]);
  });

  it("leaves out a missing block, and one that does not come after the anchor before it", () => {
    const got = storyAnchors({
      staticHeight: 1000,
      hand: null,
      notes: { top: 400, height: 100 },
      mice: { top: 300, height: 100 }, // top 300: before the notes; bottom 400: the same
    });
    expect(got).toEqual([
      { offset: 0, progress: 0 },
      { offset: 400, progress: ANCHOR_PROGRESS.notesTop },
      { offset: 1000, progress: 1 },
    ]);
  });

  it("anchors always go forward in offset and in progress", () => {
    for (let i = 1; i < anchors.length; i += 1) {
      expect(anchors[i]!.offset).toBeGreaterThan(anchors[i - 1]!.offset);
      expect(anchors[i]!.progress).toBeGreaterThan(anchors[i - 1]!.progress);
    }
  });
});

describe("progressAtOffset", () => {
  it("is linear between the anchors and clamped outside them", () => {
    const two = [
      { offset: 100, progress: 0.2 },
      { offset: 300, progress: 0.6 },
    ];
    expect(progressAtOffset(0, two)).toBe(0.2);
    expect(progressAtOffset(100, two)).toBe(0.2);
    expect(progressAtOffset(200, two)).toBeCloseTo(0.4, 10);
    expect(progressAtOffset(300, two)).toBe(0.6);
    expect(progressAtOffset(900, two)).toBe(0.6);
  });

  it("is 0 with no anchors or a non-finite offset", () => {
    expect(progressAtOffset(500, [])).toBe(0);
    expect(progressAtOffset(Number.NaN, anchors)).toBe(0);
  });

  it("puts the hand's top edge at the formed hand and the mice's bottom edge at the settled mice", () => {
    expect(progressAtOffset(707, anchors)).toBeCloseTo(MARKS.handFormed, 10);
    expect(progressAtOffset(1931 + 185, anchors)).toBeCloseTo(
      MARKS.miceSettled,
      10,
    );
  });
});

describe("readingOffset", () => {
  it("moves from the viewport's top edge to its bottom edge as the reader goes through the section", () => {
    expect(readingOffset(0, STATIC_HEIGHT, VH)).toBe(0);
    expect(readingOffset(56, STATIC_HEIGHT, VH)).toBe(0);
    expect(readingOffset(VH - STATIC_HEIGHT, STATIC_HEIGHT, VH)).toBe(
      STATIC_HEIGHT,
    );
    const range = STATIC_HEIGHT - VH;
    expect(readingOffset(-range / 2, STATIC_HEIGHT, VH)).toBeCloseTo(
      range / 2 + VH / 2,
      10,
    );
  });

  it("a section no taller than the viewport is read at its bottom edge once scrolled", () => {
    expect(readingOffset(-10, 600, 800)).toBe(10 + 800);
  });
});

describe("planLateSwitch", () => {
  it("at the top (or below the nav) keeps the page where it is, with no fade", () => {
    expect(plan(56)).toEqual({ targetTop: 56, progress: 0, fade: false });
    expect(plan(0)).toEqual({ targetTop: 0, progress: 0, fade: false });
  });

  it("inside the story fades, and lands on the progress for the part being read", () => {
    // A reload at scrollY 500: the section's top is at -444.
    const got = plan(-444);
    expect(got.fade).toBe(true);
    // The point being read is 714 px in, just past the hand's top edge (707):
    // the reader is shown the formed hand.
    const offset = 444 + (444 / (STATIC_HEIGHT - VH)) * VH;
    expect(offset).toBeCloseTo(713.7, 1);
    const want =
      MARKS.handFormed +
      ((offset - 707) / (1488 - 707)) *
        (ANCHOR_PROGRESS.notesTop - MARKS.handFormed);
    expect(got.progress).toBeCloseTo(want, 10);
    expect(got.progress).toBeGreaterThan(MARKS.handFormed);
    expect(got.progress).toBeLessThan(0.4);
    // And the target top gives that progress back.
    expect(sectionProgress(got.targetTop, ANIMATED_HEIGHT, VH)).toBeCloseTo(
      got.progress,
      10,
    );
  });

  it("just off the top lands close to the top: a few px of scroll give a small progress", () => {
    const got = plan(-10);
    expect(got.fade).toBe(true);
    expect(got.progress).toBeGreaterThan(0);
    expect(got.progress).toBeLessThan(0.01);
  });

  it("with the story's end in view keeps its bottom edge, and so the final section, exactly where it was", () => {
    // The page scrolled to its end: the static section's bottom at 497.
    const staticTop = 497 - STATIC_HEIGHT;
    const got = plan(staticTop);
    expect(got.targetTop + ANIMATED_HEIGHT).toBe(497);
    expect(got.progress).toBe(1);
    expect(got.fade).toBe(true);
  });

  it("with the story wholly above the viewport keeps its bottom edge and does not fade", () => {
    const got = plan(-STATIC_HEIGHT - 20);
    expect(got.targetTop + ANIMATED_HEIGHT).toBe(-20);
    expect(got.fade).toBe(false);
    expect(got.progress).toBe(1);
  });

  it("is continuous where the story's end comes into view", () => {
    const edge = VH - STATIC_HEIGHT; // the bottom edge at the viewport's bottom
    // (The last anchor segment here is the 1 px from the mice's bottom edge to
    // the section's, so the slope is steep, but there is no step.)
    expect(plan(edge + 0.01).progress).toBeCloseTo(1, 2);
    expect(plan(edge).progress).toBe(1);
  });

  it("the progress never goes back as the reader is further down", () => {
    let last = -1;
    for (let top = 0; top >= -STATIC_HEIGHT - 50; top -= 7) {
      const { progress } = plan(top);
      expect(progress).toBeGreaterThanOrEqual(last);
      last = progress;
    }
  });
});

describe("scrollForTarget", () => {
  it("scrolls by how far the section's top is from where it should be", () => {
    // After the switch the section's top is at -444; it should be at -900.
    expect(scrollForTarget(500, -444, -900)).toBe(956);
    expect(scrollForTarget(500, -444, -444)).toBe(500);
  });

  it("never asks for a negative scroll position", () => {
    expect(scrollForTarget(10, 0, 100)).toBe(0);
  });
});
