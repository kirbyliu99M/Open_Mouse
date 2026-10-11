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
  it("shows for text the model wrote, named once, with a decorative star", () => {
    const html = render(ready("model"));
    expect(html).toContain(MARK);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Written with Gemini"');
    expect(html).toContain('title="Written with Gemini"');
    // The star itself is decorative; the name is said once, by the wrapper.
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html.match(/Written with Gemini/g)).toHaveLength(2); // aria-label + title
    expect(html).toContain('width="14"');
  });

  it("still shows for model text served from the cache", () => {
    expect(render(ready("model", true))).toContain(MARK);
  });

  it("is named in the page's language", () => {
    const html = render(ready("model"), "zh-TW");
    expect(html).toContain('aria-label="由 Gemini 撰寫"');
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
