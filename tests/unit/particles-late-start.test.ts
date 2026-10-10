import { describe, expect, it } from "vitest";
import {
  ANCHOR_PROGRESS,
  type LateSwitchInput,
  LATE_CONFIRM_FRAMES,
  LATE_CONFIRM_MS,
  LATE_TRANSPARENT,
  fadeCheck,
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
      { offset: 1931 + 185, progress: ANCHOR_PROGRESS.miceBottom },
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

  it("keeps the story's end (p = 1) when the finale is the static section's last block: its bottom edge gives way", () => {
    // The finale's bottom edge is the section's bottom edge (the review of
    // 5ab9d86 found the end anchor dropped there, so the in-story branch
    // never got past 0.9).
    const got = storyAnchors({
      staticHeight: 2117,
      hand: blocks.hand,
      notes: blocks.notes,
      mice: { top: 1931, height: 2117 - 1931 },
    });
    expect(got.at(-1)).toEqual({ offset: 2117, progress: 1 });
    expect(got.at(-2)).toEqual({
      offset: 1931,
      progress: ANCHOR_PROGRESS.miceTop,
    });
    expect(progressAtOffset(2117, got)).toBe(1);
    // A finale that ends past the section's bottom (rounding) gives way too.
    const over = storyAnchors({
      staticHeight: 2117,
      hand: null,
      notes: null,
      mice: { top: 1931, height: 200 },
    });
    expect(over.at(-1)).toEqual({ offset: 2117, progress: 1 });
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

  it("puts the hand's top edge at the formed hand and the finale's bottom edge at p = 0.9 (where the three mice settled; the finale's figure is formed earlier, at 0.80)", () => {
    expect(progressAtOffset(707, anchors)).toBeCloseTo(MARKS.handFormed, 10);
    expect(ANCHOR_PROGRESS.miceBottom).toBe(0.9);
    expect(progressAtOffset(1931 + 185, anchors)).toBeCloseTo(0.9, 10);
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

describe("planLateSwitch is continuous and only goes forward, whatever the sizes", () => {
  type Sizes = Omit<LateSwitchInput, "staticTop">;

  /**
   * The steepest the target top can change per px of the reader's scroll
   * (|d targetTop / d staticTop|), from the formulas in late-start.ts:
   * - at the top, and with the story's end in view (the bottom edge kept): 1;
   * - inside the story: the share is read off the anchors, so its slope per
   *   px of reading offset is at most the steepest anchor segment's; the
   *   reading offset moves H / (H - V) px per px of scroll; and the share is
   *   multiplied by the scroll range A - V (0 when that is negative);
   * - a static story no taller than the viewport is mapped in proportion:
   *   A / H.
   * A jump would be a change larger than this slope times the step.
   */
  function slopeBound(sizes: Sizes): number {
    const { staticHeight: h, animatedHeight: a, viewportHeight: v } = sizes;
    let steepest = 0;
    for (let i = 1; i < sizes.anchors.length; i += 1) {
      const from = sizes.anchors[i - 1]!;
      const to = sizes.anchors[i]!;
      steepest = Math.max(
        steepest,
        (to.progress - from.progress) / (to.offset - from.offset),
      );
    }
    const inside = h > v ? Math.max(0, a - v) * steepest * (h / (h - v)) : 0;
    const proportional = h <= v ? a / h : 0;
    return Math.max(1, inside, proportional);
  }

  /** Every border between the branches: the top, the story's end at the viewport's bottom, the story's end at the viewport's top. */
  const borders = (sizes: Sizes) => [
    0,
    sizes.viewportHeight - sizes.staticHeight,
    -sizes.staticHeight,
  ];

  /**
   * Sweep the reader down the page: a coarse grid, and around each border
   * steps of 0.001 px. Between any two neighbouring positions the target may
   * move by at most the slope bound times the distance (plus 1e-6 for
   * rounding); and the target never comes back down the page, nor p back.
   */
  function expectContinuousAndForward(sizes: Sizes) {
    const bound = slopeBound(sizes);
    const travel = Math.max(0, sizes.animatedHeight - sizes.panelHeight);
    const tops: number[] = [];
    for (let top = 60; top >= -sizes.staticHeight - 200; top -= 0.5) {
      tops.push(top);
    }
    for (const border of borders(sizes)) {
      for (let k = -10; k <= 10; k += 1) tops.push(border + k * 0.001);
    }
    tops.sort((x, y) => y - x);
    let last: { top: number; targetTop: number; progress: number } | null =
      null;
    for (const top of tops) {
      const { targetTop, progress } = planLateSwitch({
        ...sizes,
        staticTop: top,
      });
      if (last) {
        const step = last.top - top;
        if (step <= 0) continue;
        const allowed = bound * step + 1e-6;
        expect(Math.abs(targetTop - last.targetTop)).toBeLessThanOrEqual(
          allowed,
        );
        if (travel > 0) {
          expect(Math.abs(progress - last.progress)).toBeLessThanOrEqual(
            allowed / travel,
          );
        }
        expect(targetTop).toBeLessThanOrEqual(last.targetTop + 1e-9);
        expect(progress).toBeGreaterThanOrEqual(last.progress - 1e-12);
      }
      last = { top, targetTop, progress };
    }
  }

  // window.innerHeight differs from the panel's 100svh when a phone's address
  // bar has collapsed (taller) or, in some browsers, the other way round.
  for (const viewportHeight of [700, 760, 800, 860, 900]) {
    it(`a ${viewportHeight} px viewport over an 800 px panel`, () => {
      const sizes: Sizes = {
        staticHeight: STATIC_HEIGHT,
        animatedHeight: ANIMATED_HEIGHT,
        panelHeight: VH,
        viewportHeight,
        anchors,
      };
      expectContinuousAndForward(sizes);
      // The end branch keeps the bottom edge where it was.
      const edge = planLateSwitch({
        ...sizes,
        staticTop: viewportHeight - STATIC_HEIGHT,
      });
      expect(edge.targetTop + ANIMATED_HEIGHT).toBeCloseTo(viewportHeight, 6);
    });
  }

  it("Codex's example (900 px viewport, 800 px panel): -1216.99 and -1217 give the same step", () => {
    const sizes: Sizes = {
      staticHeight: STATIC_HEIGHT,
      animatedHeight: ANIMATED_HEIGHT,
      panelHeight: VH,
      viewportHeight: 900,
      anchors,
    };
    const a = planLateSwitch({ ...sizes, staticTop: -1216.99 });
    const b = planLateSwitch({ ...sizes, staticTop: -1217 });
    const allowed = slopeBound(sizes) * 0.01 + 1e-6;
    expect(Math.abs(a.targetTop - b.targetTop)).toBeLessThanOrEqual(allowed);
  });

  it("an animated section shorter than the viewport (Codex: H 4000, A 3200, panel 800, viewport 3600)", () => {
    const sizes: Sizes = {
      staticHeight: 4000,
      animatedHeight: 3200,
      panelHeight: 800,
      viewportHeight: 3600,
      anchors: storyAnchors({
        staticHeight: 4000,
        hand: { top: 1000, height: 800 },
        notes: { top: 2000, height: 600 },
        mice: { top: 3000, height: 400 },
      }),
    };
    expectContinuousAndForward(sizes);
    const a = planLateSwitch({ ...sizes, staticTop: -399.99 });
    const b = planLateSwitch({ ...sizes, staticTop: -400 });
    expect(Math.abs(a.targetTop - b.targetTop)).toBeLessThanOrEqual(
      slopeBound(sizes) * 0.01 + 1e-6,
    );
    // The section is never put below the viewport's top once the reader was
    // past it.
    expect(b.targetTop).toBeLessThanOrEqual(0);
  });

  it("a viewport taller than the whole static story (Codex: a portrait 4K screen: H 2117, panel and viewport 2400, A 9600)", () => {
    const sizes: Sizes = {
      staticHeight: STATIC_HEIGHT,
      animatedHeight: 9600,
      panelHeight: 2400,
      viewportHeight: 2400,
      anchors,
    };
    expectContinuousAndForward(sizes);
    // Just off the top lands just off the top, not at the story's end.
    const a = planLateSwitch({ ...sizes, staticTop: 0 });
    const b = planLateSwitch({ ...sizes, staticTop: -0.01 });
    expect(a.progress).toBe(0);
    expect(b.progress).toBeLessThan(0.001);
    // With the story wholly above the viewport, its bottom edge is kept.
    const c = planLateSwitch({ ...sizes, staticTop: -STATIC_HEIGHT - 30 });
    expect(c.targetTop + 9600).toBeCloseTo(-30, 6);
    expect(c.progress).toBe(1);
  });
});

describe("planLateSwitch keeps the final section in place when its gap to the story differs between the layouts (finalShift)", () => {
  // 3rem below the static story; 20svh up over the animated one on a desktop.
  const SHIFT = 48 + 0.2 * VH;
  const withShift = (staticTop: number) =>
    planLateSwitch({
      staticTop,
      staticHeight: STATIC_HEIGHT,
      animatedHeight: ANIMATED_HEIGHT,
      panelHeight: VH,
      viewportHeight: VH,
      anchors,
      finalShift: SHIFT,
    });

  it("with the story's end in view, the final section's top edge is where it was (static: bottom + 48; animated: bottom - overlap)", () => {
    for (const staticTop of [-1400, -1600, -2000, -2117, -2500]) {
      const bottom = staticTop + STATIC_HEIGHT;
      const finalBefore = bottom + 48;
      const { targetTop } = withShift(staticTop);
      const finalAfter = targetTop + ANIMATED_HEIGHT - 0.2 * VH;
      // Exact unless the plan had to clamp at the section's top.
      if (targetTop < 0) expect(finalAfter).toBeCloseTo(finalBefore, 9);
    }
  });

  it("is continuous where the story's end comes into view, and only goes forward", () => {
    const edge = VH - STATIC_HEIGHT;
    const inside = withShift(edge + 0.01);
    const atEdge = withShift(edge);
    expect(Math.abs(inside.targetTop - atEdge.targetTop)).toBeLessThan(5);
    expect(Math.abs(inside.progress - atEdge.progress)).toBeLessThan(0.002);
    let lastTop = Infinity;
    for (let top = 0; top >= -STATIC_HEIGHT - 50; top -= 0.5) {
      const { targetTop } = withShift(top);
      expect(targetTop).toBeLessThanOrEqual(lastTop + 1e-9);
      lastTop = targetTop;
    }
  });

  it("without a shift (or with a non-number) it is the plan it always was", () => {
    for (const staticTop of [-300, -1400, -2000, -2500]) {
      const base = plan(staticTop);
      expect(
        planLateSwitch({
          staticTop,
          staticHeight: STATIC_HEIGHT,
          animatedHeight: ANIMATED_HEIGHT,
          panelHeight: VH,
          viewportHeight: VH,
          anchors,
          finalShift: Number.NaN,
        }),
      ).toEqual(base);
    }
  });
});

describe("fadeCheck", () => {
  const at = (over: Partial<Parameters<typeof fadeCheck>[0]>) =>
    fadeCheck({ hidden: false, opacity: 0, frames: 0, elapsedMs: 0, ...over });

  it("switches only with the panel transparent, in a shown tab", () => {
    expect(at({ opacity: 0 })).toBe("switch");
    expect(at({ opacity: LATE_TRANSPARENT })).toBe("switch");
    expect(at({ opacity: 0.021 })).toBe("next-frame");
    expect(at({ opacity: 1 })).toBe("next-frame");
  });

  it("a hidden tab never switches, transparent or not", () => {
    expect(at({ hidden: true, opacity: 0 })).toBe("hidden");
    expect(at({ hidden: true, opacity: 1 })).toBe("hidden");
  });

  it("gives up after a bounded number of frames or ms, never switching while visible", () => {
    expect(at({ opacity: 0.5, frames: LATE_CONFIRM_FRAMES - 1 })).toBe(
      "next-frame",
    );
    expect(at({ opacity: 0.5, frames: LATE_CONFIRM_FRAMES })).toBe("give-up");
    expect(at({ opacity: 0.5, elapsedMs: LATE_CONFIRM_MS })).toBe("give-up");
    expect(at({ opacity: 0.5, elapsedMs: Number.NaN })).toBe("give-up");
    // Transparent on the last frame still switches.
    expect(at({ opacity: 0, frames: LATE_CONFIRM_FRAMES })).toBe("switch");
    for (let frames = 0; frames < 20; frames += 1) {
      expect(at({ opacity: 0.9, frames, elapsedMs: frames * 16 })).not.toBe(
        "switch",
      );
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
