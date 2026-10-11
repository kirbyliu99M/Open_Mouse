import { describe, expect, it } from "vitest";
import {
  FINALE,
  HERO_INERT_BELOW,
  MARKS,
  NOTE_BOUNDS,
  NOTE_COUNT,
  NOTE_FADE,
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
    expect(phase.finale).toEqual({
      sky: 0,
      glow: 0,
      gather: 0,
      clip: 0,
      sweep: 0,
      lift: 0,
    });
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

  it("the finale's figure is formed by p = 0.80 and holds still to 1.00", () => {
    // 2026-10-11: the three mice (settled at 0.90) became the finale, whose
    // figure forms first so the headline can gather after it (FINALE).
    expect(MARKS.miceSettled).toBe(0.8);
    expect(phaseAt(0.79).mouseT).toBeLessThan(1);
    expect(phaseAt(MARKS.miceSettled).mouseT).toBe(1);
    for (const p of [0.8, 0.86, 0.9, 0.93, 0.97, 1]) {
      const phase = phaseAt(p);
      expect(phase.mouseT).toBe(1);
      expect(phase.formT).toBe(1);
      expect(phase.overlay).toBe(0);
    }
  });

  it("the finale: the sky, then the headline gathers and is swept solid, all done by 0.98 and held to 1", () => {
    // Up to the figure at rest (0.80) nothing else of the finale has begun:
    // the e2e suite compares the WebGL canvas with the maths there.
    for (const p of [0, 0.38, 0.55, 0.69, 0.79, MARKS.miceSettled]) {
      expect(Object.values(phaseAt(p).finale).every((v) => v === 0)).toBe(true);
    }
    for (const [from] of Object.values(FINALE)) {
      expect(from).toBeGreaterThanOrEqual(MARKS.miceSettled);
    }
    // Each window lies in story 6 and is over by 0.98 (so p = 0.98 to 1 holds
    // still): its part is 0 at the window's start and 1 at its end.
    for (const [key, [from, to]] of Object.entries(FINALE) as [
      keyof typeof FINALE,
      readonly [number, number],
    ][]) {
      expect(from, key).toBeGreaterThanOrEqual(0.72);
      expect(to, key).toBeGreaterThan(from);
      expect(to, key).toBeLessThanOrEqual(0.98);
      expect(phaseAt(from).finale[key], key).toBe(0);
      expect(phaseAt(to).finale[key], key).toBe(1);
    }
    expect(FINALE.gather[0]).toBeGreaterThanOrEqual(FINALE.sky[0]);
    expect(FINALE.sweep[0]).toBeGreaterThanOrEqual(FINALE.gather[1]);
    // The lines are cut while the letters arrive, not before.
    expect(FINALE.clip[0]).toBe(FINALE.gather[0]);
    for (const p of [0.98, 0.99, 1]) {
      expect(phaseAt(p).finale).toEqual({
        sky: 1,
        glow: 1,
        gather: 1,
        clip: 1,
        sweep: 1,
        lift: 1,
      });
    }
    // Monotonic: scrolling down never takes a part of the finale back.
    let last = phaseAt(0.7).finale;
    for (let i = 1; i <= 300; i += 1) {
      const now = phaseAt(0.7 + (0.3 * i) / 300).finale;
      for (const key of Object.keys(now) as (keyof typeof now)[]) {
        expect(now[key]).toBeGreaterThanOrEqual(last[key]);
      }
      last = now;
    }
    expect(phaseAt(0.87).finale.gather).toBeCloseTo(0.5, 12);
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

  it("the hand's outline fades in with the skeleton and goes with the overlay", () => {
    expect(phaseAt(0.4).outline).toBe(0);
    expect(phaseAt(0.42).outline).toBe(0);
    expect(phaseAt(0.46).outline).toBeCloseTo(0.5, 12);
    expect(phaseAt(0.5).outline).toBe(1);
    // It is the skeleton's own window; the overlay's multiplier takes it out.
    for (let i = 0; i <= 100; i += 1) {
      const p = i / 100;
      expect(phaseAt(p).outline).toBeCloseTo(phaseAt(p).skeleton, 12);
    }
    expect(phaseAt(0.55).overlay).toBe(1);
    expect(phaseAt(0.6).overlay).toBe(0);
  });

  it("segment is 0 before, 1 after, linear between", () => {
    expect(segment(0.1, 0.2, 0.4)).toBe(0);
    expect(segment(0.5, 0.2, 0.4)).toBe(1);
    expect(segment(0.3, 0.2, 0.4)).toBeCloseTo(0.5, 12);
  });
});

describe("the five annotations' windows", () => {
  const notes = (p: number) => phaseAt(p).notes;
  const visible = (p: number) => notes(p).filter((n) => n > 0).length;

  it("are five, in the story's order, five equal windows inside p = 0.40 to 0.60 that touch and never overlap", () => {
    expect(NOTE_COUNT).toBe(5);
    expect(NOTE_BOUNDS).toEqual([0.4, 0.44, 0.48, 0.52, 0.56, 0.6]);
    expect(NOTE_BOUNDS).toHaveLength(NOTE_COUNT + 1);
    for (let i = 1; i < NOTE_BOUNDS.length; i += 1) {
      expect(NOTE_BOUNDS[i]! - NOTE_BOUNDS[i - 1]!).toBeCloseTo(0.04, 12);
    }
    expect(notes(0)).toHaveLength(5);
    // The window's middle is where its note is whole, and the order is the story's.
    for (let i = 0; i < NOTE_COUNT; i += 1) {
      const middle = (NOTE_BOUNDS[i]! + NOTE_BOUNDS[i + 1]!) / 2;
      expect(notes(middle)[i], `note ${i + 1} at p=${middle}`).toBe(1);
      expect(
        notes(middle).filter((_, j) => j !== i),
        `the others at p=${middle}`,
      ).toEqual([0, 0, 0, 0]);
    }
  });

  it("are all 0 outside p = 0.40 to 0.60, at both ends and everywhere between", () => {
    for (const p of [
      0, 0.05, 0.2, 0.3, 0.38, 0.399, 0.4, 0.6, 0.601, 0.7, 0.9, 1,
    ]) {
      expect(notes(p), `p=${p}`).toEqual([0, 0, 0, 0, 0]);
    }
    for (let i = 0; i <= 4000; i += 1) {
      const p = i / 10000; // 0 to 0.4
      expect(Math.max(...notes(p)), `p=${p}`).toBe(0);
    }
    for (let i = 6000; i <= 10000; i += 1) {
      const p = i / 10000; // 0.6 to 1
      expect(Math.max(...notes(p)), `p=${p}`).toBe(0);
    }
  });

  it("never show two at once: at any p at most one note is above 0, and always within 0 to 1", () => {
    for (let i = 0; i <= 10000; i += 1) {
      const p = i / 10000;
      expect(visible(p), `p=${p}`).toBeLessThanOrEqual(1);
      for (const n of notes(p)) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    }
    // Exactly on a boundary neither neighbour is visible.
    for (const boundary of NOTE_BOUNDS) {
      expect(visible(boundary), `p=${boundary}`).toBe(0);
    }
  });

  it("each fades in, holds, and fades out: linear fades of NOTE_FADE, a hold in between", () => {
    expect(NOTE_FADE).toBe(0.01);
    for (let i = 0; i < NOTE_COUNT; i += 1) {
      const from = NOTE_BOUNDS[i]!;
      const to = NOTE_BOUNDS[i + 1]!;
      expect(notes(from)[i]).toBe(0);
      expect(notes(from + NOTE_FADE / 2)[i]).toBeCloseTo(0.5, 9);
      expect(notes(from + NOTE_FADE)[i]).toBe(1);
      expect(notes(to - NOTE_FADE)[i]).toBe(1);
      expect(notes(to - NOTE_FADE / 2)[i]).toBeCloseTo(0.5, 9);
      expect(notes(to)[i]).toBe(0);
      // Whole through the hold.
      for (let k = 0; k <= 10; k += 1) {
        const p = from + NOTE_FADE + ((to - from - 2 * NOTE_FADE) * k) / 10;
        expect(notes(p)[i], `note ${i + 1} at p=${p}`).toBeCloseTo(1, 9);
      }
    }
  });

  it("rise through their window in order, one after another, as p rises", () => {
    let last = -1;
    for (let i = 0; i <= 10000; i += 1) {
      const n = notes(i / 10000);
      const on = n.findIndex((v) => v > 0);
      if (on === -1) continue;
      expect(on).toBeGreaterThanOrEqual(last);
      last = on;
    }
    expect(last).toBe(4);
  });

  it("leave every other part of the phase alone: the notes are only a layer over the story", () => {
    // The same particle phase, hero, sheet, finale and overlay as before the notes.
    for (const p of [0, 0.1, 0.2, 0.38, 0.4, 0.5, 0.55, 0.6, 0.8, 1]) {
      const keys = Object.keys(phaseAt(p)).filter(
        (key) => key !== "notes" && key !== "outline",
      );
      expect(keys.sort()).toEqual(
        [
          "finale",
          "formT",
          "hero",
          "landmarks",
          "lines",
          "mouseT",
          "overlay",
          "progress",
          "sheet",
          "skeleton",
          "story",
        ].sort(),
      );
    }
    // Spot values pinned before this change: the particles' timing is untouched.
    expect(phaseAt(0.2).formT).toBeCloseTo(0.2 / 0.38, 12);
    // (The second leg ends at 0.80 since the finale, 2026-10-11: it was 0.90.)
    expect(phaseAt(0.58).mouseT).toBeCloseTo((0.58 - 0.55) / 0.25, 12);
    expect(phaseAt(0.4).landmarks).toBeCloseTo(((0.4 - 0.38) / 0.09) * 21, 9);
  });

  it("scrolling back restores them: a function of p alone", () => {
    const down = [0.41, 0.46, 0.5, 0.54, 0.58].map((p) => phaseAt(p).notes);
    const up = [0.58, 0.54, 0.5, 0.46, 0.41]
      .map((p) => phaseAt(p).notes)
      .reverse();
    expect(up).toEqual(down);
  });
});
