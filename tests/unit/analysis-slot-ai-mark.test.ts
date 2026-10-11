import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisSlot } from "../../src/components/results/AnalysisSlot";
import type { AnalysisState } from "../../src/components/results/analysisState";
import type { AnalysisSource } from "../../src/lib/contracts/analysis";
import type { Locale } from "../../src/lib/contracts/locale";
import {
  en,
  resultsScreensCopy,
  zhTW,
} from "../../src/lib/copy/results-screens";

const STAR = "results-analysis-aiStar";
const LABEL_ROW = "results-analysis-labelRow";
const NOTICE_CLASS = "results-analysis-aiNotice";
const NOTICE_ZH = "本分析由 AI 撰寫，內容僅供參考。";
const NOTICE_EN = "This analysis was written by AI and is for reference only.";

function ready(source: AnalysisSource, cached = false): AnalysisState {
  return {
    status: "ready",
    response: {
      output: {
        headline: "A good match.",
        whyTopPick: "It suits your hand.",
        tradeoffs: ["A little heavy."],
        whatToAvoid: [],
        caveats: [],
      },
      source,
      cached,
    },
  };
}

function render(state: AnalysisState, language: Locale = "en"): string {
  return renderToStaticMarkup(
    createElement(AnalysisSlot, { state, language, onRetry: () => {} }),
  );
}

/** Everything a screen reader or a reader of the page can get: the markup with
 * the aria-hidden star removed. */
function exposed(html: string): string {
  return html.replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/g, "");
}

const NOT_SHOWN_STATES: [string, AnalysisState][] = [
  ["fallback text", ready("fallback")],
  ["loading", { status: "loading" }],
  ["rate limited", { status: "rateLimited" }],
  ["error", { status: "error" }],
  ["idle", { status: "idle" }],
];

describe("the AI label, star and notice around the written analysis", () => {
  it("shows all three for text the model wrote", () => {
    const html = render(ready("model"));
    expect(html).toContain(LABEL_ROW);
    expect(html).toContain(STAR);
    expect(html).toContain(NOTICE_CLASS);
    expect(html).toContain(
      `<p class="results-eyebrow">${en.analysis.eyebrow}</p>`,
    );
    expect(html).toContain(`>${NOTICE_EN}</p>`);
  });

  it("still shows for model text served from the cache", () => {
    const html = render(ready("model", true));
    expect(html).toContain(STAR);
    expect(html).toContain(NOTICE_EN);
  });

  it("follows the page language, with Kirby's Chinese sentence", () => {
    const html = render(ready("model"), "zh-TW");
    expect(html).toContain(`>${NOTICE_ZH}</p>`);
    expect(html).toContain(zhTW.analysis.eyebrow);
    expect(html).not.toContain(NOTICE_EN);
    expect(html).not.toContain(en.analysis.eyebrow);
  });

  it("makes the notice visible text, not a hover tip or hidden text", () => {
    const html = render(ready("model"));
    // Touch devices have no hover, so nothing here may live in a title.
    expect(html).not.toContain("title=");
    expect(html).not.toContain("results-visuallyHidden");
    expect(html).not.toMatch(/aria-label=/);
    expect(html).not.toMatch(/<p class="results-analysis-aiNotice"[^>]*hidden/);
  });

  it("is read once: the star is aria-hidden and the sentence appears once", () => {
    const html = render(ready("model"));
    expect(html).toMatch(
      new RegExp(
        `<span class="${STAR}" aria-hidden="true"><svg[^>]*aria-hidden="true"`,
      ),
    );
    expect(html).toContain('width="14"');
    expect(exposed(html).split(NOTICE_EN)).toHaveLength(2);
    expect(html.split(NOTICE_EN)).toHaveLength(2);
  });

  it("puts the label with the star above the heading, and the notice below the text", () => {
    const html = render(ready("model"));
    const label = html.indexOf(LABEL_ROW);
    const heading = html.indexOf("Why this one");
    const body = html.indexOf("A good match.");
    const notice = html.indexOf(NOTICE_CLASS);
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(heading);
    expect(heading).toBeLessThan(body);
    expect(body).toBeLessThan(notice);
    // The star sits in the label row, beside the label text.
    expect(html).toMatch(
      new RegExp(
        `<div class="${LABEL_ROW}"><p class="results-eyebrow">[^<]+</p><span class="${STAR}"`,
      ),
    );
  });

  it("does not show label, star or notice for fallback, loading, rate limited, error or idle", () => {
    for (const [name, state] of NOT_SHOWN_STATES) {
      for (const language of ["en", "zh-TW"] as const) {
        const html = render(state, language);
        expect(html, `${name} / ${language}`).not.toContain(STAR);
        expect(html, `${name} / ${language}`).not.toContain(LABEL_ROW);
        expect(html, `${name} / ${language}`).not.toContain(NOTICE_CLASS);
        expect(html, `${name} / ${language}`).not.toContain(NOTICE_EN);
        expect(html, `${name} / ${language}`).not.toContain(NOTICE_ZH);
      }
    }
  });

  it("uses the same localized small label in loading, rate limited and error", () => {
    for (const status of ["loading", "rateLimited", "error"] as const) {
      expect(render({ status }, "en")).toContain(
        `<p class="results-eyebrow">${en.analysis.eyebrow}</p>`,
      );
      const zh = render({ status }, "zh-TW");
      expect(zh).toContain(
        `<p class="results-eyebrow">${zhTW.analysis.eyebrow}</p>`,
      );
      expect(zh).not.toContain("Written analysis");
    }
  });

  it("keeps the fallback note unchanged, and the model text free of it", () => {
    const fallback = render(ready("fallback"));
    expect(fallback).toContain("results-analysis-provenance");
    expect(fallback).toContain(
      "Generated automatically from your scores above.",
    );
    expect(render(ready("model"))).not.toContain("results-analysis-provenance");
  });

  it("has the strings in both languages and says no vendor name anywhere", () => {
    expect(resultsScreensCopy("zh-TW").analysis.aiWrittenNotice).toBe(
      NOTICE_ZH,
    );
    expect(resultsScreensCopy("en").analysis.aiWrittenNotice).toBe(NOTICE_EN);
    expect(zhTW.analysis.eyebrow.length).toBeGreaterThan(0);
    expect(en.analysis.eyebrow).toBe("Written analysis");
    for (const copy of [zhTW, en]) {
      expect(JSON.stringify(copy)).not.toMatch(/gemini/i);
    }
    // No rendered state, in either language, carries the name.
    const states = [
      ready("model"),
      ready("model", true),
      ...NOT_SHOWN_STATES.map(([, s]) => s),
    ];
    for (const state of states) {
      for (const language of ["en", "zh-TW"] as const) {
        expect(render(state, language)).not.toMatch(/gemini/i);
      }
    }
  });
});
