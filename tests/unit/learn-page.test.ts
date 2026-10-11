import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LearnInfo } from "../../src/components/learn/LearnInfo";
import { en, learnPageCopy, zhTW } from "../../src/lib/copy/learn-page";
import {
  en as resultsEn,
  zhTW as resultsZh,
} from "../../src/lib/copy/results-page";
import {
  markPlacement,
  SHAPE_SKETCHES,
  viewBoxText,
} from "../../src/lib/learn/shape-sketches";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";

const LOCALES = [
  ["en", en],
  ["zh-TW", zhTW],
] as const;

/** Every string leaf of a copy table. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

/**
 * The text a visitor reads: tags and attributes dropped, and the step numbers
 * (the badges 1 to 6 are the order of the steps, not data) left out.
 */
function visibleText(html: string): string {
  return html
    .replace(/<span class="learn-card-number"[^>]*>\d<\/span>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const render = (copy: typeof en) =>
  renderToStaticMarkup(createElement(LearnInfo, { copy }));

describe("learn page copy", () => {
  it("takes the two shape labels from the results page, not new strings", () => {
    expect(en.shape.symmetrical).toBe(resultsEn.filter.shape.symmetrical);
    expect(en.shape.ergonomic).toBe(resultsEn.filter.shape.ergonomic);
    expect(zhTW.shape.symmetrical).toBe(resultsZh.filter.shape.symmetrical);
    expect(zhTW.shape.ergonomic).toBe(resultsZh.filter.shape.ergonomic);
  });

  it("has the same shape marks in both languages, one for every mark on the four sketches", () => {
    const keys = SHAPE_SKETCHES.flatMap((s) => s.marks.map((m) => m.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(en.shape.marks).sort()).toEqual([...keys].sort());
    expect(Object.keys(zhTW.shape.marks).sort()).toEqual([...keys].sort());
    for (const copy of [en, zhTW]) {
      for (const text of [
        ...Object.values(copy.shape.marks),
        copy.shape.hump,
        copy.shape.flare,
      ]) {
        expect(text.trim()).not.toBe("");
      }
    }
    // The flare drawing is exaggerated: the page must say so.
    expect(en.shape.marks.schematic).toMatch(/schematic/i);
  });

  it("takes the grip names and three chart labels from the results page, not new strings", () => {
    for (const [copy, results] of [
      [en, resultsEn],
      [zhTW, resultsZh],
    ] as const) {
      expect(copy.grip.claw.name).toBe(
        copy === en ? "Claw" : results.handGrip.claw,
      );
      expect(copy.score.bars.length).toBe(results.subscoreShort.length);
      expect(copy.score.bars.gripWidth).toBe(results.subscoreShort.gripWidth);
      expect(copy.score.bars.weight).toBe(results.subscoreShort.weight);
    }
    expect(zhTW.grip.palm.name).toBe(resultsZh.handGrip.palm);
    expect(zhTW.grip.fingertip.name).toBe(resultsZh.handGrip.fingertip);
  });

  it("picks the table for the locale", () => {
    expect(learnPageCopy("en")).toBe(en);
    expect(learnPageCopy("zh-TW")).toBe(zhTW);
  });

  it.each(LOCALES)(
    "%s: no medical claim and no ergonomic as an adjective",
    (_l, copy) => {
      // The two shape labels are the results page's own data words
      // ("Ergonomic" / 人體工學), reused as they are.
      const shapeWords = [copy.shape.symmetrical, copy.shape.ergonomic];
      // The sketch marks are not a medical claim; they are checked here too.
      for (const text of strings(copy)) {
        if (!shapeWords.includes(text)) {
          expect(findMedicalClaimTerm(text), text).toBeNull();
        }
        // "Ergonomic" is allowed only as the results page's own shape word.
        expect(
          text.toLowerCase().replaceAll(copy.shape.ergonomic.toLowerCase(), ""),
        ).not.toContain("ergonomic");
        expect(text).not.toMatch(/更準|more accurate|rank|score of/i);
      }
    },
  );
});

describe("the rendered /learn body", () => {
  it.each(LOCALES)(
    "%s: has no number anywhere a visitor can read (the paper name A4 is the one allowed digit)",
    (_l, copy) => {
      const html = render(copy);
      const text = visibleText(html).replaceAll("A4", "A-four");
      expect(text).not.toMatch(/\d/);
      // Bar lengths are percentages in a style attribute, never in text.
      expect(text).not.toContain("%");
    },
  );

  it.each(LOCALES)(
    "%s: one h1, six h2 cards in order, a bar for each of the six scores, and the two links and the button",
    (_l, copy) => {
      const html = render(copy);
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      expect(html.match(/<h2[ >]/g)).toHaveLength(6);
      const titles = [
        ...html.matchAll(/<h2[^>]*>.*?<\/span>([^<]+)<\/h2>/g),
      ].map((m) => m[1]);
      expect(titles).toEqual([
        copy.hand.title,
        copy.grip.title,
        copy.size.title,
        copy.shape.title,
        copy.weightAndConnection.title,
        copy.score.title,
      ]);
      const numbers = [
        ...html.matchAll(/class="learn-card-number"[^>]*>(\d)</g),
      ].map((m) => m[1]);
      expect(numbers).toEqual(["1", "2", "3", "4", "5", "6"]);
      expect(html.match(/class="learn-bar"/g)).toHaveLength(6);
      const labels = [
        ...html.matchAll(/class="learn-bar-label">([^<]+)</g),
      ].map((m) => m[1]);
      expect(labels).toEqual([
        copy.score.bars.length,
        copy.score.bars.gripWidth,
        copy.score.bars.heightHump,
        copy.score.bars.frontFlare,
        copy.score.bars.thumb,
        copy.score.bars.weight,
      ]);
      expect(html).toContain(copy.score.barsNote);
      // The four names under the four tiles, in order; the first two are the
      // results page's words.
      const names = [
        ...html.matchAll(/<figcaption>([^<]+)<\/figcaption>/g),
      ].map((m) => m[1]);
      expect(names).toEqual([
        copy.shape.symmetrical,
        copy.shape.ergonomic,
        copy.shape.hump,
        copy.shape.flare,
      ]);
      expect(html.match(/href="\/scan\/easy"/g)).toHaveLength(2);
      expect(html).toContain('href="/how-it-works"');
      expect(html).toContain(copy.scanButton);
    },
  );

  it("hides the visible grip captions from a screen reader (the list names each grip once) and keeps the four shape captions", () => {
    const html = render(en);
    expect(html.match(/<figcaption aria-hidden="true">/g)).toHaveLength(3);
    expect(html.match(/<figcaption>/g)).toHaveLength(4);
    expect(html).toContain("<dt>Palm</dt>");
  });

  it("draws the bars at the engine's relative weights, longest first", () => {
    const html = render(en);
    const widths = [
      ...html.matchAll(/class="learn-bar" style="width:([\d.]+)%"/g),
    ].map((m) => Number(m[1]));
    expect(widths).toEqual([100, 83.33, 66.67, 33.33, 33.33, 16.67]);
  });

  it("uses Kirby's grip drawings, the home hand SVG and our four shape sketches, all decorative (empty alt), each file present, the old two mouse drawings gone, and writes no thickness card", () => {
    const html = render(en);
    for (const grip of ["palm", "claw", "fingertip"]) {
      expect(html).toContain(`/images/learn/grip-${grip}.webp`);
      expect(() =>
        readFileSync(`public/images/learn/grip-${grip}.webp`),
      ).not.toThrow();
    }
    expect(html).toContain("/images/hand-on-a4.svg");
    // The hand, three grips, four sketches and three arrow overlays.
    expect(html.match(/<img /g)).toHaveLength(11);
    expect(html.match(/ alt=""/g)).toHaveLength(11);
    for (const sketch of SHAPE_SKETCHES) {
      expect(html).toContain(`/images/learn/shape-${sketch.id}.svg"`);
      expect(html.includes(`shape-${sketch.id}-arrows.svg`)).toBe(
        sketch.arrows,
      );
    }
    expect(html).not.toContain("-top.svg");
    for (const old of ["symmetrical-top.svg", "ergonomic-top.svg"]) {
      expect(existsSync(`public/images/learn/${old}`)).toBe(false);
    }
    expect(html.toLowerCase()).not.toContain("thick");
  });

  it.each(LOCALES)(
    "%s: puts every sketch mark in the page as plain text with its line breaks, none hidden from a screen reader",
    (_l, copy) => {
      const html = render(copy);
      const marks = [
        ...html.matchAll(
          /<span class="learn-shape-mark"([^>]*)>([^<]*)<\/span>/g,
        ),
      ];
      const expected = SHAPE_SKETCHES.flatMap((s) =>
        s.marks.map((m) => copy.shape.marks[m.key]),
      );
      expect(marks.map((m) => m[2])).toEqual(expected);
      for (const m of marks) expect(m[1]).not.toContain("aria-hidden");
      // The line breaks are kept in the text (the page shows them with
      // white-space: pre), not turned into tags or spaces.
      expect(html).toContain(copy.shape.marks.thumbRest);
      expect(copy.shape.marks.thumbRest).toContain("\n");
    },
  );
});

describe("the four shape sketches", () => {
  const read = (name: string) =>
    readFileSync(`public/images/learn/${name}`, "utf8");
  const rootTag = (svg: string) => svg.match(/^<svg[^>]*>/)?.[0] ?? "";

  it.each(SHAPE_SKETCHES.map((s) => [s.id, s] as const))(
    "%s: the base drawing and the arrow overlay carry the crop viewBox, with no fixed width or height",
    (_id, sketch) => {
      const files = [`shape-${sketch.id}.svg`];
      if (sketch.arrows) files.push(`shape-${sketch.id}-arrows.svg`);
      else {
        expect(
          existsSync(`public/images/learn/shape-${sketch.id}-arrows.svg`),
        ).toBe(false);
      }
      for (const file of files) {
        const tag = rootTag(read(file));
        expect(tag, file).toContain(`viewBox="${viewBoxText(sketch)}"`);
        expect(tag, file).not.toMatch(/\s(width|height)=/);
      }
    },
  );

  it("the crop keeps the 512-unit width of the package and every mark's anchor is inside it", () => {
    for (const sketch of SHAPE_SKETCHES) {
      const { x, y, w, h } = sketch.viewBox;
      expect(w).toBe(512);
      expect(h).toBeGreaterThan(0);
      for (const mark of sketch.marks) {
        expect(mark.x, mark.key).toBeGreaterThanOrEqual(x);
        expect(mark.x, mark.key).toBeLessThanOrEqual(x + w);
        expect(mark.y, mark.key).toBeGreaterThanOrEqual(y);
        expect(mark.y, mark.key).toBeLessThan(y + h);
      }
    }
  });

  it("places a mark by percentages of the crop: from the right edge for anchor r", () => {
    const [sym, erg, hump] = SHAPE_SKETCHES;
    // Symmetrical: x 256 of 512, y 344 in a crop that starts at 130 and is 260 high.
    expect(markPlacement(sym, sym.marks[0])).toEqual({
      top: "82.31%",
      left: "50%",
    });
    expect(markPlacement(erg, erg.marks[0])).toEqual({
      top: "47.45%",
      left: "3.52%",
    });
    // Hump, anchor r: the text ends at x 257, so it is 255 / 512 from the right.
    expect(markPlacement(hump, hump.marks[0])).toEqual({
      top: "13.33%",
      right: "49.8%",
    });
    expect(markPlacement(hump, hump.marks[1])).toEqual({
      top: "13.33%",
      left: "60.35%",
    });
  });
});
