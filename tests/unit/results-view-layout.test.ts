import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import type { AnalysisState } from "../../src/components/results/analysisState";
import type { FitResponse } from "../../src/lib/contracts/fit";
import type { UiLanguage } from "../../src/client/uiLanguage";

const many = FIXTURES["many-results"];

function render(
  response: FitResponse,
  props: { rank?: number; language?: UiLanguage; scanId?: string } = {},
) {
  return renderToStaticMarkup(
    createElement(ResultsView, {
      response,
      language: "zh-TW",
      ...props,
    }),
  );
}

/** Index of `needle` in `html`, failing loudly when it is missing. */
function at(html: string, needle: string): number {
  const i = html.indexOf(needle);
  expect(i, `${needle} is on the page`).toBeGreaterThanOrEqual(0);
  return i;
}

describe("the results page layout", () => {
  it("shows the sections in the approved order", () => {
    const html = render(many);
    const order = [
      "results-topBar",
      "results-hand-title",
      "results-hero-photo",
      "results-score-model",
      "results-why-list",
      "results-details",
      "results-others-grid",
      "results-otherMice",
    ].map((needle) => at(html, needle));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("writes the hand type from the response, as a mouse type", () => {
    const html = render(many);
    expect(html).toContain("適合你的滑鼠型");
    expect(html).toContain("中型滑鼠・抓握・寬身");
    expect(html).toContain("第一名 · Logitech");
    expect(html).toContain("適配分數 / 100");
  });

  it("has no hand-type block at all when the response sends none (fit-v0)", () => {
    const html = render(FIXTURES["high-confidence"]);
    expect(html).not.toContain("results-hand");
    expect(html).not.toContain("適合你的滑鼠型");
    // The model name is the page's one h1 then.
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toMatch(
      /<h1 class="results-score-model">G Pro X Superlight 2/,
    );
  });

  it("gives one reason line per rated sub-score, up to three: two for low-confidence.json, which rates only length and thumb", () => {
    const low = FIXTURES["low-confidence"];
    const rated = Object.values(low.results[0].subscores).filter(
      (sub) => sub.score !== null,
    );
    expect(rated).toHaveLength(2);
    expect(render(low).match(/data-subscore="/g)).toHaveLength(2);
  });

  it("draws the glow as an empty decorative element, not a pseudo element", () => {
    const html = render(many);
    expect(html).toContain('<div class="results-glow" aria-hidden="true">');
  });

  it("has exactly one h1 with a hand type too", () => {
    expect(render(many).match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("shows a silhouette, with no text of its own, when there is no photo", () => {
    const html = render(many);
    expect(html).toContain('data-has-photo="false"');
    expect(html).toContain("results-photo-silhouette");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/official|官方產品照|產品照/);
  });

  it("shows the photo from imageUrl when there is one", () => {
    const withPhoto: FitResponse = {
      ...many,
      results: many.results.map((r) =>
        r.rank === 1
          ? { ...r, mouse: { ...r.mouse, imageUrl: "/images/mice/x.webp" } }
          : r,
      ),
    };
    const html = render(withPhoto);
    expect(html).toContain('src="/images/mice/x.webp"');
    expect(html).toContain('alt="Logitech G Pro X Superlight 2"');
  });

  it("closes both disclosures by default", () => {
    const html = render(many);
    const details = html.match(/<details[^>]*>/g) ?? [];
    expect(details).toHaveLength(2);
    for (const tag of details) expect(tag).not.toContain(" open");
  });

  it("shows the band badge from the shared band words, in the page language", () => {
    expect(render(many, { language: "zh-TW" })).toContain("非常適合你");
    expect(render(many, { language: "en" })).toContain("A very good fit");
  });

  it("gives the three reason lines from the sub-scores, never more", () => {
    const html = render(many);
    expect(html.match(/data-subscore="/g)).toHaveLength(3);
  });

  it("lists the other four of the top five, linking to their pages", () => {
    const html = render(many, { scanId: many.scanId });
    const cards = [...html.matchAll(/<a [^>]*class="results-card"[^>]*>/g)];
    expect(cards).toHaveLength(4);
    expect(html).not.toContain(`href="/results/${many.scanId}"`);
    expect(html).toContain(`href="/results/${many.scanId}/m/logitech-g305"`);
    expect(html).toContain("點選任一款，會看到同樣版面的結果頁。");
  });

  it("makes the cards buttons when there is no scan (the demo)", () => {
    const html = render(many);
    expect(html.match(/<button[^>]*class="results-card"/g)).toHaveLength(4);
    expect(html).not.toContain('class="results-card" href');
  });

  it("counts the other mice: ranks six onward plus the excluded", () => {
    const html = render(many);
    expect(html).toContain("其他滑鼠（共 5 款）");
    expect(html).toContain("未列入比較");
    // Excluded come after the ranked rows.
    expect(at(html, "results-otherMice-row")).toBeLessThan(
      at(html, "results-excluded-list"),
    );
  });

  it("carries the share button in the top bar (link), beside the purchase links on a wide screen and under Other mice on a phone (primary)", () => {
    const html = render(many);
    expect(html.match(/data-testid="share-card-button"/g)).toHaveLength(3);
    expect(html.match(/shareCard-button-link/g)).toHaveLength(1);
    expect(html.match(/shareCard-button-primary/g)).toHaveLength(2);
    for (const position of ["top", "hero", "bottom"])
      expect(html).toContain(`data-share-position="${position}"`);
    // In order: top bar, hero, then under Other mice.
    expect(at(html, 'data-share-position="top"')).toBeLessThan(
      at(html, 'data-share-position="hero"'),
    );
    expect(at(html, 'data-share-position="hero"')).toBeLessThan(
      at(html, 'data-share-position="bottom"'),
    );
  });

  it("shares the top pick on a detail page too: the card is about the hand type, not this page's mouse", () => {
    // The button is given the whole response, so rank 1 is what it draws.
    const html = render(many, { rank: 3, scanId: many.scanId });
    expect(html.match(/data-testid="share-card-button"/g)).toHaveLength(3);
  });

  it("shows no share button when there are no results", () => {
    const html = render({ ...many, results: [] });
    expect(html).not.toContain("share-card-button");
  });

  it("carries no early-preview line of its own (nor does the site footer for now)", () => {
    expect(render(many, { language: "en" })).not.toMatch(/Early preview/i);
  });

  it("names the back link by its destination, chevron left out", () => {
    expect(render(many, { language: "en" })).toContain(
      'aria-label="Back to Scan again"',
    );
    expect(render(many, { language: "zh-TW" })).toContain(
      'aria-label="返回重新掃描"',
    );
  });

  it("puts the back link and the site name in the top bar", () => {
    const html = render(many);
    expect(html).toContain('href="/scan/easy"');
    expect(html).toContain("重新掃描");
    expect(html).toContain(">Palmate<");
  });

  it("marks zh-TW text with lang, and English text with none", () => {
    const zh = render(many, { language: "zh-TW" });
    expect(zh).toContain('lang="zh-TW"');
    const en = render(many, { language: "en" });
    expect(en).not.toContain('lang="zh-TW"');
  });
});

describe("excluded rows", () => {
  const withTotal = render(many, { language: "en" });

  /** The visible words of a row, in reading order. */
  const words = (row: string) =>
    row
      .replace(/<span aria-hidden="true">.*?<\/span>/g, " · ")
      .replace(/<[^>]+>/g, "")
      .replace(/&#x27;/g, "'")
      .replace(/ /g, "~");
  const rowsOf = (html: string) =>
    [
      ...html.matchAll(/<li><span class="results-excluded-name">.*?<\/li>/g),
    ].map((m) => m[0]);

  it("put the reason first, then the number labelled as the mirrored shape's score", () => {
    const rows = rowsOf(withTotal);
    expect(rows).toHaveLength(2);
    const wrongHand = rows.find((r) => r.includes("Basilisk"))!;
    // A right-hand scan: the mouse is made for the left hand, the number is
    // for the right-hand version of its shape.
    expect(words(wrongHand)).toBe(
      "Razer Basilisk V3 X (left-handed)Made for the left hand · as a right-hand shape:~58 / 100",
    );
    // Source order is reading order: reason, label, number.
    expect(at(wrongHand, "results-excluded-reason")).toBeLessThan(
      at(wrongHand, "results-excluded-mirror-label"),
    );
    expect(at(wrongHand, "results-excluded-mirror-label")).toBeLessThan(
      at(wrongHand, "results-excluded-score"),
    );
    // Tabular figures, and the label and number in one unbreakable unit.
    expect(wrongHand).toMatch(/results-excluded-score results-tabularNum/);
    expect(wrongHand).toMatch(
      /<span class="results-excluded-mirror">.*results-excluded-score.*<\/span><\/span>/,
    );
  });

  it("read the same in zh-TW", () => {
    const wrongHand = rowsOf(render(many, { language: "zh-TW" })).find((r) =>
      r.includes("Basilisk"),
    )!;
    expect(words(wrongHand)).toBe(
      "Razer Basilisk V3 X (left-handed)為左手設計 · 若是右手形狀：~58 / 100",
    );
  });

  it("mirror the hand words for a left-hand scan", () => {
    const left = { ...many, hand: "left" as const };
    const en = rowsOf(render(left, { language: "en" })).find((r) =>
      r.includes("Basilisk"),
    )!;
    expect(words(en)).toContain(
      "Made for the right hand · as a left-hand shape:~58 / 100",
    );
    const zh = rowsOf(render(left, { language: "zh-TW" })).find((r) =>
      r.includes("Basilisk"),
    )!;
    expect(words(zh)).toContain("為右手設計 · 若是左手形狀：~58 / 100");
  });

  it("show the reason only, with no number or dash, when there is no total", () => {
    const rows = [
      ...withTotal.matchAll(
        /<li><span class="results-excluded-name">.*?<\/li>/g,
      ),
    ].map((m) => m[0]);
    const vertical = rows.find((r) => r.includes("Lift Vertical"))!;
    expect(vertical).toContain(
      "Vertical mouse: our scoring doesn&#x27;t cover this shape yet",
    );
    expect(vertical).not.toContain("results-excluded-score");
    // The words only: no tags, and the apostrophe's entity has digits in it.
    const text = vertical.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
    expect(text).not.toMatch(/\d|—|–/);
    expect(text).not.toMatch(/shape:|形狀/);
  });

  it("have no link or button", () => {
    const from = withTotal.indexOf("results-excluded-list");
    const list = withTotal.slice(from, withTotal.indexOf("</ul>", from));
    expect(list).not.toMatch(/<a |<button/);
  });

  it("are counted in Other mice", () => {
    expect(withTotal).toContain("Other mice (5)");
  });

  it("is shown in the page language", () => {
    const zh = render(many, { language: "zh-TW" });
    expect(zh).toContain("為左手設計");
    expect(zh).toContain("垂直滑鼠：目前的評分方式不適用");
  });
});

describe("the retired pieces", () => {
  it("no longer show the mouse header or an early-preview notice", () => {
    const html = render(many);
    expect(html).not.toContain("results-mouseHeader");
    expect(html).not.toContain("results-previewNotice");
  });
});

describe("a detail page", () => {
  const detail = render(many, { rank: 3, scanId: many.scanId });

  it("has the same layout, about the chosen mouse", () => {
    expect(detail).toContain("第三名 · Logitech");
    expect(detail).toContain("results-hand-title");
    expect(detail).toContain(`<h2 class="results-score-model">G309`);
  });

  it("does not carry the written analysis", () => {
    const withAnalysis = renderToStaticMarkup(
      createElement(ResultsView, {
        response: many,
        language: "en",
        rank: 3,
        analysisState: {
          status: "ready",
          response: {
            output: {
              headline: "h",
              whyTopPick: "w",
              tradeoffs: [],
              whatToAvoid: [],
              caveats: [],
            },
            source: "model",
            cached: false,
          },
        },
      }),
    );
    expect(withAnalysis).not.toContain("results-analysis");
    const main = renderToStaticMarkup(
      createElement(ResultsView, {
        response: many,
        language: "en",
        analysisState: {
          status: "ready",
          response: {
            output: {
              headline: "h",
              whyTopPick: "w",
              tradeoffs: [],
              whatToAvoid: [],
              caveats: [],
            },
            source: "model",
            cached: false,
          },
        },
      }),
    );
    expect(main).toContain("results-analysis");
  });

  it("lists rank 1 first among the other picks, linking back to the main page", () => {
    const cards = [...detail.matchAll(/<a [^>]*class="results-card"[^>]*>/g)];
    expect(cards).toHaveLength(4);
    expect(cards[0][0]).toContain(`href="/results/${many.scanId}"`);
    expect(detail).not.toContain(`/m/${many.results[2].mouse.slug}"`);
  });
});

describe("a poor fit", () => {
  it("says so on the main page only", () => {
    const poor: FitResponse = {
      ...many,
      results: many.results.map((r) => ({ ...r, total: 40 })),
    };
    expect(render(poor, { language: "en" })).toContain(
      "None of these fits your hand well.",
    );
    expect(render(poor, { language: "en", rank: 2 })).not.toContain(
      "None of these fits your hand well.",
    );
  });
});

describe("cautions and links", () => {
  const links = {
    "logitech-g-pro-x-superlight-2": [
      { label: "Shop A", url: "https://shop.example/superlight" },
    ],
  };

  it("puts the typed-length and left-hand notes before the purchase links", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        response: { ...many, hand: "left" },
        language: "en",
        enteredLengthMm: 186,
        purchaseSource: links,
      }),
    );
    const purchase = at(html, "results-purchase");
    const notes = [...html.matchAll(/results-handNotice/g)].map(
      (m) => m.index!,
    );
    expect(notes).toHaveLength(2);
    for (const note of notes) expect(note).toBeLessThan(purchase);
  });

  it("shows no purchase box at all without links", () => {
    expect(render(many)).not.toContain("results-purchase");
  });
});

describe("the written analysis heading", () => {
  const ready: AnalysisState = {
    status: "ready",
    response: {
      output: {
        headline: "h",
        whyTopPick: "w",
        tradeoffs: ["t"],
        whatToAvoid: ["a"],
        caveats: [],
      },
      source: "model",
      cached: false,
    },
  };

  it("is an h3 inside Details, under the page's h2 sections, with h4s below it", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        response: many,
        language: "en",
        analysisState: ready,
      }),
    );
    expect(html).toMatch(/<h3 class="results-analysis-heading">Why this one/);
    expect(html).toContain("<h4>Tradeoffs</h4>");
    // Only the zh-TW "why" heading is an h2 of that name.
    expect(html).not.toMatch(/<h2[^>]*>Why this one/);
  });
});
