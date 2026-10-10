import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import {
  FINALE_BRIGHT_FROM,
  finaleShape,
  finaleSlotName,
  finaleTone,
  labelsFromGlyphs,
} from "@/lib/particles/finale-shape";
import { KIND, KIND_LEVELS } from "@/lib/particles/finale-targets";
import { parseFinaleTargets } from "@/lib/particles/load-finale";
import { lettersFromLabels, thresholdMask } from "@/lib/particles/text-mask";

const finale = parseFinaleTargets(
  JSON.parse(readFileSync(ARTIFACT_PATHS.finale, "utf8")),
);

describe("finaleSlotName", () => {
  it("names each tier apart, after the drawing", () => {
    expect(finaleSlotName("desktop")).toBe("finale-grip@desktop");
    expect(finaleSlotName("mobile")).toBe("finale-grip@mobile");
  });
});

describe("finaleTone", () => {
  it("lights the highlights always, the loose grains and the rim never, the rest from their threshold up", () => {
    expect(finaleTone(KIND.highlight, 0)).toBe(1);
    expect(finaleTone(KIND.satellite, 0)).toBe(0);
    expect(finaleTone(KIND.rim, 0)).toBe(0);
    // The thresholds themselves, written out (2026-10-11: dust from level 3,
    // details and stars from 1), so a change of FINALE_BRIGHT_FROM fails here
    // instead of being compared with itself.
    const expected: [number, number][] = [
      [KIND.dust, 3],
      [KIND.detail, 1],
      [KIND.star, 1],
    ];
    for (const [kind, from] of expected) {
      expect(FINALE_BRIGHT_FROM[kind as 0 | 2 | 4]).toBe(from);
      for (let level = 0; level < KIND_LEVELS[kind]!; level += 1) {
        expect(finaleTone(kind as 0 | 2 | 4, level)).toBe(
          level >= from ? 1 : 0,
        );
      }
      // Monotonic in the level: a brighter level is never dimmer.
      expect(finaleTone(kind as 0 | 2 | 4, KIND_LEVELS[kind]! - 1)).toBe(1);
      expect(finaleTone(kind as 0 | 2 | 4, 0)).toBe(0);
    }
  });

  it("makes this many of the committed figure's points bright: 1,714 of 2,061 on a desktop, 1,352 of 1,639 on a phone (the observable result of the thresholds)", () => {
    // Counted 2026-10-11 from finale.generated.json with the thresholds above.
    // A change of a threshold, or of the drawing's levels, moves these.
    const bright = (tier: "desktop" | "mobile") =>
      finaleShape(finale, tier).points.filter((p) => p.tone === 1).length;
    expect(finale.tiers.desktop.points).toHaveLength(2061);
    expect(finale.tiers.mobile.points).toHaveLength(1639);
    expect(bright("desktop")).toBe(1714);
    expect(bright("mobile")).toBe(1352);
  });

  it("refuses a kind or a level that does not exist", () => {
    expect(() => finaleTone(9 as never, 0)).toThrow(RangeError);
    expect(() => finaleTone(KIND.dust, -1)).toThrow(RangeError);
    expect(() => finaleTone(KIND.dust, KIND_LEVELS[KIND.dust]!)).toThrow(
      RangeError,
    );
    expect(() => finaleTone(KIND.dust, 1.5)).toThrow(RangeError);
  });
});

describe("finaleShape", () => {
  for (const tier of ["desktop", "mobile"] as const) {
    it(`${tier}: every point, moved so the viewBox starts at 0, with its tone, and a run per path`, () => {
      const shape = finaleShape(finale, tier);
      const t = finale.tiers[tier];
      expect(shape.width).toBe(finale.viewBox.width);
      expect(shape.height).toBe(finale.viewBox.height);
      expect(shape.points).toHaveLength(t.points.length);
      shape.points.forEach((p, i) => {
        const q = t.points[i]!;
        expect(p.x).toBeCloseTo(q.x - finale.viewBox.x, 9);
        expect(p.y).toBeCloseTo(q.y - finale.viewBox.y, 9);
        expect(p.tone).toBe(finaleTone(q.kind, q.level));
        expect(p.x).toBeGreaterThanOrEqual(-2);
        expect(p.x).toBeLessThanOrEqual(shape.width + 2);
        expect(p.y).toBeGreaterThanOrEqual(-2);
        expect(p.y).toBeLessThanOrEqual(shape.height + 2);
      });
      expect(shape.runs).toHaveLength(t.runs.length);
      shape.runs.forEach((run, i) => {
        expect(run.start).toBe(t.runs[i]!.start);
        expect(run.count).toBe(t.runs[i]!.count);
        expect(run.closed).toBe(finale.lines[t.runs[i]!.path]!.closed);
      });
      // Both tones are there: the figure is not all dust nor all stars.
      const bright = shape.points.filter((p) => p.tone === 1).length;
      expect(bright).toBeGreaterThan(shape.points.length * 0.15);
      expect(bright).toBeLessThan(shape.points.length * 0.85);
    });
  }
});

describe("labelsFromGlyphs", () => {
  // Two lines: "AB" over "C", in a 30 × 20 mask.
  const glyphs = [
    { left: 2, right: 10, top: 1, bottom: 9, line: 0 },
    { left: 11, right: 20, top: 1, bottom: 9, line: 0 },
    { left: 5, right: 14, top: 11, bottom: 19, line: 1 },
  ];
  const { labels, lines } = labelsFromGlyphs(30, 20, glyphs);
  const at = (x: number, y: number) => labels[y * 30 + x]!;

  it("labels a pixel inside a glyph's box with that glyph (k + 1), and gives each glyph its line", () => {
    expect(lines).toEqual([0, 0, 1]);
    expect(at(5, 5)).toBe(1);
    expect(at(15, 5)).toBe(2);
    expect(at(9, 15)).toBe(3);
  });

  it("gives every pixel the nearest glyph of the nearest line: an overhang or an edge never goes unlabelled", () => {
    expect(labels.every((v) => v >= 1 && v <= 3)).toBe(true);
    // Left of A, right of B, below C, between the lines (nearer the top one).
    expect(at(0, 4)).toBe(1);
    expect(at(29, 4)).toBe(2);
    expect(at(29, 19)).toBe(3);
    expect(at(10, 9)).toBe(1);
    // In the gap between A and B, the nearer glyph.
    expect(at(10, 5)).toBe(1);
  });

  it("is what lettersFromLabels needs: every set pixel resolves to its glyph", () => {
    const alpha = new Uint8Array(30 * 20);
    for (const [k, g] of glyphs.entries()) {
      for (let y = Math.ceil(g.top); y < g.bottom; y += 1) {
        for (let x = Math.ceil(g.left) + 1; x < g.right - 1; x += 1) {
          alpha[y * 30 + x] = 255;
        }
      }
      void k;
    }
    const mask = thresholdMask(alpha, 30, 20);
    const { letters } = lettersFromLabels(mask, { labels, lines });
    expect(letters.map((l) => l.line)).toEqual([0, 0, 1]);
    expect(letters[2]!.y0).toBeGreaterThanOrEqual(11);
  });

  it("refuses an empty mask, no glyphs, a line left out, an upside-down box", () => {
    expect(() => labelsFromGlyphs(0, 5, glyphs)).toThrow(RangeError);
    expect(() => labelsFromGlyphs(5, 5, [])).toThrow(RangeError);
    expect(() =>
      labelsFromGlyphs(30, 20, [{ ...glyphs[0]!, line: 1 }]),
    ).toThrow(/line 0 is empty/);
    expect(() =>
      labelsFromGlyphs(30, 20, [{ ...glyphs[0]!, right: 1 }]),
    ).toThrow(/upside down/);
  });
});
