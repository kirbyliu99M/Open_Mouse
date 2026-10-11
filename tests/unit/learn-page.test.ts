import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LearnInfo } from "../../src/components/learn/LearnInfo";
import { en, learnPageCopy, zhTW } from "../../src/lib/copy/learn-page";
import {
  en as resultsEn,
  zhTW as resultsZh,
} from "../../src/lib/copy/results-page";
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
      // The shape labels are the results page's words, under the two mice.
      expect(html).toContain(
        `<figcaption>${copy.shape.symmetrical}</figcaption>`,
      );
      expect(html).toContain(
        `<figcaption>${copy.shape.ergonomic}</figcaption>`,
      );
      expect(html.match(/href="\/scan\/easy"/g)).toHaveLength(2);
      expect(html).toContain('href="/how-it-works"');
      expect(html).toContain(copy.scanButton);
    },
  );

  it("draws the bars at the engine's relative weights, longest first", () => {
    const html = render(en);
    const widths = [
      ...html.matchAll(/class="learn-bar" style="width:([\d.]+)%"/g),
    ].map((m) => Number(m[1]));
    expect(widths).toEqual([100, 83.33, 66.67, 33.33, 33.33, 16.67]);
  });

  it("uses Kirby's grip drawings, the home hand SVG and our two mouse line drawings, all decorative (empty alt), each file present, and writes no thickness card", () => {
    const html = render(en);
    for (const shape of ["symmetrical", "ergonomic"]) {
      expect(html).toContain(`/images/learn/${shape}-top.svg`);
      expect(() =>
        readFileSync(`public/images/learn/${shape}-top.svg`),
      ).not.toThrow();
    }
    for (const grip of ["palm", "claw", "fingertip"]) {
      expect(html).toContain(`/images/learn/grip-${grip}.webp`);
      expect(() =>
        readFileSync(`public/images/learn/grip-${grip}.webp`),
      ).not.toThrow();
    }
    expect(html).toContain("/images/hand-on-a4.svg");
    expect(html.match(/<img /g)).toHaveLength(6);
    expect(html.match(/ alt=""/g)).toHaveLength(6);
    expect(html.toLowerCase()).not.toContain("thick");
  });
});
