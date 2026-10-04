import { describe, expect, it } from "vitest";
import {
  HERO_INERT_BELOW,
  MARKS,
  STORY_RANGES,
  clampProgress,
  phaseAt,
  sectionProgress,
  segment,
  storyAt,
} from "@/lib/particles/timeline";

describe("clampProgress", () => {
  it("keeps p in [0, 1] and treats NaN as 0", () => {
    expect(clampProgress(-0.2)).toBe(0);
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(0.4)).toBe(0.4);
    expect(clampProgress(1)).toBe(1);
    expect(clampProgress(3)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("sectionProgress", () => {
  // A 400 svh section of a 800 px viewport: 3200 px, the panel is 800 px tall.
  const section = 3200;
  const panel = 800;

  it("is 0 until the panel pins (the section's top reaches the viewport's top), whatever is above", () => {
    expect(sectionProgress(120, section, panel)).toBe(0);
    expect(sectionProgress(1, section, panel)).toBe(0);
    expect(sectionProgress(0, section, panel)).toBe(0);
  });

  it("is 1 when the section's bottom reaches the panel's bottom, and stays 1 after", () => {
    // The bottom is at top + 3200; it meets the panel's bottom (800) at top = -2400.
    expect(sectionProgress(-2400, section, panel)).toBe(1);
    expect(sectionProgress(-2500, section, panel)).toBe(1);
    expect(sectionProgress(-9000, section, panel)).toBe(1);
  });

  it("is linear in between", () => {
    expect(sectionProgress(-1200, section, panel)).toBeCloseTo(0.5, 12);
    expect(sectionProgress(-600, section, panel)).toBeCloseTo(0.25, 12);
  });

  it("is 0 when the section is no taller than the panel (the static layout)", () => {
    expect(sectionProgress(-100, 800, 800)).toBe(0);
    expect(sectionProgress(-100, 500, 800)).toBe(0);
  });
});

describe("the six stories", () => {
  it("follow the spec's table", () => {
    expect(
      STORY_RANGES.map(({ story, from, to }) => [story, from, to]),
    ).toEqual([
      [1, 0, 0],
      [2, 0, 0.15],
      [3, 0.15, 0.38],
      [4, 0.38, 0.55],
      [5, 0.55, 0.72],
      [6, 0.72, 1],
    ]);
    // And the ranges tile 0 to 1 with no gap.
    for (let i = 2; i < STORY_RANGES.length; i += 1) {
      expect(STORY_RANGES[i]!.from).toBe(STORY_RANGES[i - 1]!.to);
    }
    expect(STORY_RANGES[1]!.from).toBe(0);
    expect(STORY_RANGES.at(-1)!.to).toBe(1);
  });

  it("storyAt: p = 0 is the hero, a boundary belongs to the story that starts there", () => {
    expect(storyAt(0)).toBe(1);
    expect(storyAt(-1)).toBe(1);
    expect(storyAt(0.0001)).toBe(2);
    expect(storyAt(0.149)).toBe(2);
    expect(storyAt(0.15)).toBe(3);
    expect(storyAt(0.379)).toBe(3);
    expect(storyAt(0.38)).toBe(4);
    expect(storyAt(0.549)).toBe(4);
    expect(storyAt(0.55)).toBe(5);
    expect(storyAt(0.719)).toBe(5);
    expect(storyAt(0.72)).toBe(6);
    expect(storyAt(1)).toBe(6);
    expect(storyAt(7)).toBe(6);
  });
});

describe("phaseAt", () => {
  it("at rest (p = 0): the logo, the hero fully shown, nothing else", () => {
    const phase = phaseAt(0);
    expect(phase.story).toBe(1);
    expect(phase.formT).toBe(0);
    expect(phase.mouseT).toBe(0);
    expect(phase.hero).toEqual({ opacity: 1, shift: 0, inert: false });
    expect(phase.sheet).toBe(0);
    expect(phase.captions).toBe(0);
    expect(phase.landmarks).toBe(0);
    expect(phase.lines).toBe(0);
  });

  it("the hand is formed by p = 0.38 and rests there until it is measured", () => {
    expect(phaseAt(0.37).formT).toBeLessThan(1);
    expect(phaseAt(0.38).formT).toBe(1);
    for (const p of [0.4, 0.5, 0.549, 0.55]) {
      expect(phaseAt(p).formT).toBe(1);
      expect(phaseAt(p).mouseT).toBe(0);
    }
  });

  it("story 6 has stopped by p = 0.90 and holds still to 1.00", () => {
    expect(phaseAt(0.89).mouseT).toBeLessThan(1);
    expect(phaseAt(MARKS.miceSettled).mouseT).toBe(1);
    for (const p of [0.9, 0.93, 0.97, 1]) {
      const phase = phaseAt(p);
      expect(phase.mouseT).toBe(1);
      expect(phase.formT).toBe(1);
      expect(phase.overlay).toBe(0);
    }
    // The captions have faded in by then.
    expect(phaseAt(0.92).captions).toBe(1);
    expect(phaseAt(0.8).captions).toBe(0);
  });

  it("the landmarks light in order, the skeleton draws, then the lines extend, all inside story 4", () => {
    const at = (p: number) => phaseAt(p);
    expect(at(0.38).landmarks).toBe(0);
    expect(at(0.425).landmarks).toBeGreaterThan(0);
    expect(at(0.425).landmarks).toBeLessThan(21);
    expect(at(0.47).landmarks).toBeCloseTo(21, 9);
    expect(at(0.42).skeleton).toBe(0);
    expect(at(0.5).skeleton).toBe(1);
    expect(at(0.47).lines).toBe(0);
    expect(at(0.55).lines).toBe(1);
    // The overlay is whole through story 4, and gone once the hand has loosened.
    expect(at(0.38).overlay).toBe(1);
    expect(at(0.55).overlay).toBe(1);
    expect(at(0.6).overlay).toBe(0);
    // It only ever gets further along while p rises through story 4.
    let previous = 0;
    for (let i = 0; i <= 100; i += 1) {
      const lit = at(0.38 + (0.17 * i) / 100).landmarks;
      expect(lit).toBeGreaterThanOrEqual(previous);
      previous = lit;
    }
  });

  it("the hero text fades and moves up over p = 0 to 0.10, with opacity and a shift only", () => {
    expect(phaseAt(0.05).hero.opacity).toBeCloseTo(0.5, 12);
    expect(phaseAt(0.05).hero.shift).toBeCloseTo(0.5, 12);
    expect(phaseAt(0.1).hero).toEqual({ opacity: 0, shift: 1, inert: true });
    expect(phaseAt(0.5).hero).toEqual({ opacity: 0, shift: 1, inert: true });
  });

  it("the buttons are inert below opacity 0.05 and not at or above it", () => {
    expect(HERO_INERT_BELOW).toBe(0.05);
    // opacity = 1 - p / 0.10, so 0.05 is at p = 0.095.
    expect(phaseAt(0.09).hero.opacity).toBeGreaterThan(0.05);
    expect(phaseAt(0.09).hero.inert).toBe(false);
    expect(phaseAt(0.0951).hero.opacity).toBeLessThan(0.05);
    expect(phaseAt(0.0951).hero.inert).toBe(true);
    for (let i = 0; i <= 1000; i += 1) {
      const { hero } = phaseAt(i / 1000);
      expect(hero.inert).toBe(hero.opacity < 0.05);
    }
  });

  it("scrolling back restores everything: the phase is a function of p alone", () => {
    const down = [0, 0.04, 0.2, 0.5, 0.8, 1].map((p) => phaseAt(p));
    const up = [1, 0.8, 0.5, 0.2, 0.04, 0].map((p) => phaseAt(p)).reverse();
    expect(up).toEqual(down);
    expect(phaseAt(0).hero).toEqual({ opacity: 1, shift: 0, inert: false });
  });

  it("the A4 outline is there while the hand is, and not before or after", () => {
    expect(phaseAt(0.1).sheet).toBe(0);
    expect(phaseAt(0.38).sheet).toBe(1);
    expect(phaseAt(0.5).sheet).toBe(1);
    expect(phaseAt(0.62).sheet).toBe(0);
    expect(phaseAt(0.9).sheet).toBe(0);
  });

  it("segment is 0 before, 1 after, linear between", () => {
    expect(segment(0.1, 0.2, 0.4)).toBe(0);
    expect(segment(0.5, 0.2, 0.4)).toBe(1);
    expect(segment(0.3, 0.2, 0.4)).toBeCloseTo(0.5, 12);
  });
});
