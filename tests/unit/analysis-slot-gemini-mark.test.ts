import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisSlot } from "../../src/components/results/AnalysisSlot";
import type { AnalysisState } from "../../src/components/results/analysisState";
import type { AnalysisSource } from "../../src/lib/contracts/analysis";
import type { Locale } from "../../src/lib/contracts/locale";
import { en, RESULTS_PAGE_COPY, zhTW } from "../../src/lib/copy/results-page";

const MARK = "results-analysis-geminiMark";

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

describe("the Gemini star beside the written analysis", () => {
  it("shows for text the model wrote, with a decorative 14px star", () => {
    const html = render(ready("model"));
    expect(html).toContain(MARK);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('width="14"');
  });

  it("gives the accessible name once: visually hidden text, with the hover title on an aria-hidden element", () => {
    const html = render(ready("model"));
    // The name a screen reader reads: one visually hidden text, nothing else.
    expect(html).toContain(
      '<span class="results-visuallyHidden">Written with Gemini</span>',
    );
    // The hover tip is on an element hidden from assistive technology, so the
    // title is never read as a second name or a description.
    expect(html).toContain(
      '<span aria-hidden="true" title="Written with Gemini">',
    );
    // Regression guard: no element may carry both an aria-label and a title,
    // nor an aria-label with the name (it would be read twice, with the text).
    expect(html).not.toMatch(/<[^>]*aria-label="[^"]*"[^>]*title=/);
    expect(html).not.toMatch(/<[^>]*title="[^"]*"[^>]*aria-label=/);
    expect(html).not.toContain('aria-label="Written with Gemini"');
    expect(html).not.toContain('role="img"');
    // Outside aria-hidden elements the name appears exactly once.
    const exposed = html.replace(
      /<span aria-hidden="true"[^>]*>.*?<\/span>/g,
      "",
    );
    expect(exposed.match(/Written with Gemini/g)).toHaveLength(1);
  });

  it("still shows for model text served from the cache", () => {
    expect(render(ready("model", true))).toContain(MARK);
  });

  it("is named in the page's language", () => {
    const html = render(ready("model"), "zh-TW");
    expect(html).toContain(
      '<span class="results-visuallyHidden">由 Gemini 撰寫</span>',
    );
    expect(html).toContain('title="由 Gemini 撰寫"');
    expect(html).not.toContain("Written with Gemini");
  });

  it("sits beside the heading, not inside it", () => {
    const html = render(ready("model"));
    expect(html).toMatch(
      /<h2 class="results-analysis-heading">Why this one<\/h2><span class="results-analysis-geminiMark"/,
    );
  });

  it("does not show for the template-written fallback", () => {
    const html = render(ready("fallback"));
    expect(html).not.toContain(MARK);
    expect(html).not.toContain("Gemini");
    // The fallback text keeps its own note, unchanged.
    expect(html).toContain("results-analysis-provenance");
    expect(html).toContain("Generated automatically from your scores above.");
  });

  it("does not show while loading, when rate limited, on error or when idle", () => {
    for (const status of ["loading", "rateLimited", "error", "idle"] as const) {
      const html = render({ status });
      expect(html).not.toContain(MARK);
      expect(html).not.toContain("Gemini");
    }
  });

  it("keeps the model text's own note out of the Gemini text", () => {
    expect(render(ready("model"))).not.toContain("results-analysis-provenance");
  });

  it("has a name in both languages, and only this string says Gemini", () => {
    expect(RESULTS_PAGE_COPY["zh-TW"].writtenWithGemini).toBe(
      zhTW.writtenWithGemini,
    );
    expect(zhTW.writtenWithGemini).toBe("由 Gemini 撰寫");
    expect(en.writtenWithGemini).toBe("Written with Gemini");
    for (const copy of [zhTW, en]) {
      const others = JSON.stringify(copy, (key, v) =>
        key === "writtenWithGemini" ? undefined : v,
      );
      expect(others).not.toMatch(/gemini/i);
    }
  });
});
