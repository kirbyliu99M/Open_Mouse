import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LearnInfo } from "../../src/components/learn/LearnInfo";
import { en, learnPageCopy, zhTW } from "../../src/lib/copy/learn-page";
import {
  en as answersEn,
  zhTW as answersZh,
} from "../../src/lib/copy/scan-answers";
import {
  en as resultsEn,
  zhTW as resultsZh,
} from "../../src/lib/copy/results-page";
import {
  markPlacement,
  markPlacementNarrow,
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
    expect(zhTW.shape.marks.schematic).toContain("示意圖");
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
    "%s: one h1, six h2 cards in order (palm thickness third, no weight-and-connection card), a bar for each of the six scores, and the two links and the button",
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
        copy.thickness.title,
        copy.size.title,
        copy.shape.title,
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

  it.each(LOCALES)(
    "%s: the palm thickness card is third, three static options in order, with no control, no number and no unit",
    (_l, copy) => {
      const html = render(copy);
      const card = html.match(
        /<li class="learn-card learn-card--thickness">.*?<\/li>/,
      )?.[0];
      expect(card).toBeDefined();
      // The third card: after grip, before size.
      expect(html.indexOf("learn-card--grip")).toBeLessThan(
        html.indexOf("learn-card--thickness"),
      );
      expect(html.indexOf("learn-card--thickness")).toBeLessThan(
        html.indexOf("learn-card--size"),
      );
      const names = [...card!.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
      const lines = [...card!.matchAll(/<dd>([^<]+)<\/dd>/g)].map((m) => m[1]);
      const o = copy.thickness.options;
      expect(names).toEqual([o.thick.name, o.medium.name, o.thin.name]);
      expect(lines).toEqual([o.thick.line, o.medium.line, o.thin.line]);
      // Static explanation: nothing to press, tick or type in.
      expect(card).not.toMatch(
        /<(button|input|a|select)[ >]|role="radio"|tabindex/,
      );
      const text = [
        copy.thickness.title,
        copy.thickness.body,
        ...names,
        ...lines,
      ].join(" ");
      expect(text).not.toMatch(/\d|mm|毫米|公釐/);
    },
  );

  it("takes the three thickness option names in the same order in both languages", () => {
    expect(Object.keys(en.thickness.options)).toEqual([
      "thick",
      "medium",
      "thin",
    ]);
    expect(Object.keys(zhTW.thickness.options)).toEqual([
      "thick",
      "medium",
      "thin",
    ]);
    expect(zhTW.thickness.options.thick.name).toBe("厚");
    expect(zhTW.thickness.options.medium.name).toBe("中");
    expect(zhTW.thickness.options.thin.name).toBe("薄");
  });

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

  it("makes the chart an ordered list, largest weight first, with no list numbers drawn", () => {
    const html = render(en);
    expect(html).toContain('<ol class="learn-bars">');
    expect(html).not.toContain("<ul");
    const widths = [
      ...html.matchAll(/class="learn-bar" style="width:([\d.]+)%"/g),
    ].map((m) => Number(m[1]));
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    const css = readFileSync("src/app/learn/learn-info.css", "utf8");
    expect(css).toMatch(/\.learn-bars \{[^}]*list-style: none/);
  });

  it("uses Kirby's grip drawings, the home hand SVG and our four shape sketches, all decorative (empty alt), each file present, and the old two mouse drawings gone", () => {
    const html = render(en);
    for (const grip of ["palm", "claw", "fingertip"]) {
      expect(html).toContain(`/images/learn/grip-${grip}.webp`);
      expect(() =>
        readFileSync(`public/images/learn/grip-${grip}.webp`),
      ).not.toThrow();
    }
    expect(html).toContain("/images/hand-on-a4.svg");
    // The hand, three grips, four sketches and their four arrow overlays.
    expect(html.match(/<img /g)).toHaveLength(12);
    expect(html.match(/ alt=""/g)).toHaveLength(12);
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
  });

  it.each(LOCALES)(
    "%s: puts every sketch mark in the page as plain text with its line breaks, none hidden from a screen reader",
    (_l, copy) => {
      const html = render(copy);
      // The marks on the drawings, and the note that sits under the flare
      // (in the tile's flow): all plain text.
      const marks = [
        ...html.matchAll(
          /<span class="learn-shape-(?:mark|note)"([^>]*)>([^<]*)<\/span>/g,
        ),
      ];
      const expected = SHAPE_SKETCHES.flatMap((s) =>
        s.marks.map((m) => copy.shape.marks[m.key]),
      );
      expect(marks.map((m) => m[2])).toEqual(expected);
      for (const m of marks) expect(m[1]).not.toContain("aria-hidden");
      // The line breaks are kept in the text (the page shows them with
      // white-space: pre), not turned into tags or spaces.
      expect(marks).toHaveLength(7);
      // The schematic note is the one in the flow, not placed on the drawing.
      expect(html).toContain(
        `<span class="learn-shape-note" data-mark="schematic" data-tone="secondary">${copy.shape.marks.schematic}</span>`,
      );
      expect(html.match(/class="learn-shape-note"/g)).toHaveLength(1);
      expect(html).toContain(copy.shape.marks.thumbRest);
      expect(copy.shape.marks.thumbRest).toContain("\n");
    },
  );
});

describe("zh-TW wording Kirby chose (candidate)", () => {
  it("has the page title, lead, score title and chart note as chosen", () => {
    expect(zhTW.title).toBe("如何挑選最合手的滑鼠？");
    expect(zhTW.lead).toBe("挑滑鼠時最重要的事，依序說明");
    expect(zhTW.score.title).toBe("評分方式");
    expect(zhTW.score.barsNote).toBe("越長影響越大");
  });

  it("calls the hump 駝峰 everywhere and never 拱背", () => {
    expect(zhTW.shape.hump).toBe("駝峰");
    expect(zhTW.shape.body).toContain("駝峰位置、前端寬度與側邊弧度");
    expect(zhTW.score.bars.heightHump).toBe("高度與駝峰");
    for (const text of strings(zhTW)) expect(text).not.toContain("拱背");
    for (const file of [
      "src/lib/copy/learn-page.ts",
      "src/app/learn/learn-info.css",
      "src/components/learn/LearnInfo.tsx",
      "src/lib/learn/shape-sketches.ts",
      "tests/e2e/learn-page.spec.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("拱背");
    }
    // The English name is unchanged.
    expect(en.shape.hump).toBe("Hump");
  });

  it("says the fingertip grip as chosen (zh) and with the matching meaning (en)", () => {
    expect(zhTW.grip.fingertip.text).toBe("僅運用指尖操控滑鼠");
    expect(en.grip.fingertip.text).toBe(
      "Only your fingertips control the mouse.",
    );
    // The palm and claw sentences are unchanged.
    expect(zhTW.grip.palm.text).toBe("整個手掌貼在滑鼠上。");
    expect(zhTW.grip.claw.text).toBe("手掌碰到滑鼠後方，手指拱起。");
  });
});

describe("the palm thickness card uses the scan's thickness page words", () => {
  it.each([
    ["zh-TW", zhTW, answersZh],
    ["en", en, answersEn],
  ] as const)(
    "%s: the three names and lines are the same as scan-answers.ts, word for word",
    (_l, learn, answers) => {
      for (const level of ["thick", "medium", "thin"] as const) {
        expect(learn.thickness.options[level].name, level).toBe(
          answers.thickness[level].name,
        );
        expect(learn.thickness.options[level].line, level).toBe(
          answers.thickness[level].hint,
        );
      }
      expect(learn.thickness.title).toBe(answers.thicknessTitle);
    },
  );
});

describe("the grip sentences are shown at every width", () => {
  it.each(LOCALES)(
    "%s: each drawing has its name and sentence visible (aria-hidden, the list names it once)",
    (_l, copy) => {
      const html = render(copy);
      const figures = [
        ...html.matchAll(
          /<figcaption aria-hidden="true"><span class="learn-grip-name">([^<]*)<\/span><span class="learn-grip-text">([^<]*)<\/span><\/figcaption>/g,
        ),
      ];
      expect(figures.map((m) => [m[1], m[2]])).toEqual(
        (["palm", "claw", "fingertip"] as const).map((g) => [
          copy.grip[g].name,
          copy.grip[g].text,
        ]),
      );
      // The screen reader still gets the names once, from the list.
      expect(html.match(/<dl class="learn-grips-text">/g)).toHaveLength(1);
    },
  );

  it("the list is hidden from sight at every width (no media query turns it on) and the sentence is shown under the name", () => {
    const css = readFileSync("src/app/learn/learn-info.css", "utf8");
    const rule = css.match(/\.learn-grips-text \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("position: absolute");
    expect(rule).toContain("clip-path: inset(50%)");
    expect(css).not.toMatch(/@media[^{]*\{\s*\.learn-grips-text/);
    const text = css.match(/\.learn-grip-text \{[^}]*\}/)?.[0] ?? "";
    expect(text).toContain("display: block");
    expect(text).not.toContain("display: none");
  });
});

describe("large text and high contrast (CSS the unit test can see)", () => {
  const css = readFileSync("src/app/learn/learn-info.css", "utf8");

  it("the chart's label column can shrink, so a large text size does not widen the page", () => {
    expect(css).toMatch(/minmax\(min\(6\.5rem, 45%\), 38%\)/);
    expect(css).toMatch(/grid-template-columns: min\(26\.25rem, 45%\)/);
  });

  it("forced colours keep the bars (a system colour), the dark panel behind the hand and grip drawings, and the shape tile", () => {
    const block =
      css.match(/@media \(forced-colors: active\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(
      /\.learn-shape-tile \{[^}]*forced-color-adjust: none/,
    );
    expect(block).toMatch(/\.learn-bar \{[^}]*background: CanvasText/);
    expect(block).toMatch(
      /\.learn-grips img \{[^}]*forced-color-adjust: none[^}]*#060709/,
    );
  });

  it("the shape card clips sideways at its own edge, with no clip margin (a margin widened the page by 20 px at 320 px and 200 % text)", () => {
    const rule = (css.match(/\.learn-card--shape \{[^}]*\}/g) ?? []).join(" ");
    expect(rule).toContain("overflow-x: clip");
    expect(rule).not.toContain("overflow-clip-margin");
  });

  it("the schematic note is in the flow, and the narrow rules follow the tile's width, not the screen's", () => {
    expect(css).toMatch(/\.learn-shape-note \{[^}]*text-align: center/);
    expect(css).toContain("container-type: inline-size");
    expect(css).toMatch(/@container \(max-width: 15rem\)/);
  });
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
        // Decorative: no role and no label anywhere in the file.
        expect(read(file), file).not.toMatch(/\srole=|aria-label/);
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
    const [sym, erg, hump, flare] = SHAPE_SKETCHES;
    // The Symmetrical drawing has no text on it.
    expect(sym.marks).toEqual([]);
    // Flare's schematic note, anchor m: x 256 of 512, y 490 in a crop from 40, 470 high.
    expect(markPlacement(flare, flare.marks[2])).toEqual({
      top: "95.74%",
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

  it("below 24rem the marks that touched an arrow or the outline are nudged, the others are not", () => {
    const [, erg, hump, flare] = SHAPE_SKETCHES;
    // Hump: both 22 units up from y 136, so (114 - 100) / 270.
    expect(markPlacementNarrow(hump, hump.marks[0])).toEqual({
      top: "5.19%",
      right: "49.8%",
    });
    expect(markPlacementNarrow(hump, hump.marks[1])).toEqual({
      top: "5.19%",
      left: "60.35%",
    });
    // Thumb rest and straight side: 6 units up, off the arrow under each.
    expect(markPlacementNarrow(erg, erg.marks[0])).toEqual({
      top: "46.17%",
      left: "3.52%",
    });
    expect(markPlacementNarrow(erg, erg.marks[1])).toEqual({
      top: "35.53%",
      left: "77.34%",
    });
    // Narrower waist 16 units up (y 180).
    expect(markPlacementNarrow(flare, flare.marks[1])).toEqual({
      top: "29.79%",
      left: "3.52%",
    });
    // Wider front 6 units up (y 65), off its arrow at y 140.
    expect(markPlacementNarrow(flare, flare.marks[0])).toEqual({
      top: "5.32%",
      left: "3.52%",
    });
    // No nudge: the same as the wide placement.
    expect(markPlacementNarrow(flare, flare.marks[2])).toEqual(
      markPlacement(flare, flare.marks[2]),
    );
  });

  it("a lifted hump mark stays inside the crop and clears the hump arrow (y 164, head to 157.8) by the text height", () => {
    const hump = SHAPE_SKETCHES.find((s) => s.id === "hump")!;
    // 12 px text, 1.2 line height, on a 225 px wide drawing: 14.4 px = 33 units.
    const lineUnits = 14.4 / (225 / 512);
    for (const mark of hump.marks) {
      const lifted = mark.y + (mark.narrow?.dy ?? 0);
      expect(lifted).toBeGreaterThanOrEqual(hump.viewBox.y);
      // 4 px (9 units) of air above the arrow head.
      expect(lifted + lineUnits).toBeLessThanOrEqual(157.8 - 9);
    }
  });
});
