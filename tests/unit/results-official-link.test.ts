import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfficialLink } from "../../src/components/results/OfficialLink";
import { OtherMice } from "../../src/components/results/OtherMice";
import { OtherPicks } from "../../src/components/results/OtherPicks";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import { emptyFilters, filteredView } from "../../src/lib/results/filters";
import type { FitResponse } from "../../src/lib/contracts/fit";
import type { Locale } from "../../src/lib/contracts/locale";

const link = (props: {
  url?: string | null;
  kind?: "product" | "brand" | null;
  language?: Locale;
}) =>
  renderToStaticMarkup(
    createElement(OfficialLink, {
      url: "url" in props ? props.url : "https://maker.example/p",
      kind: "kind" in props ? props.kind : "product",
      brand: "Logitech",
      language: props.language ?? "zh-TW",
    }),
  );

describe("OfficialLink", () => {
  it("says 官網產品頁 for a product page and 品牌頁 for a brand page", () => {
    expect(link({ kind: "product" })).toContain("Logitech 官網產品頁");
    expect(link({ kind: "brand" })).toContain("Logitech 品牌頁");
    expect(link({ kind: "brand" })).not.toContain("官網產品頁");
  });

  it("says the same in English", () => {
    expect(link({ kind: "product", language: "en" })).toContain(
      "Logitech official product page",
    );
    expect(link({ kind: "brand", language: "en" })).toContain(
      "Logitech brand page",
    );
  });

  it("never calls a link a product page when its kind is not known", () => {
    expect(link({ kind: null })).toContain("Logitech 品牌頁");
    expect(link({ kind: null })).not.toContain("官網產品頁");
  });

  it("renders nothing without a URL", () => {
    expect(link({ url: null })).toBe("");
    expect(link({ url: undefined })).toBe("");
    expect(link({ url: "" })).toBe("");
  });

  it("opens in a new tab with rel noopener, and says so to a screen reader", () => {
    for (const [language, hidden] of [
      ["zh-TW", "（開新分頁）"],
      ["en", "(opens in a new tab)"],
    ] as const) {
      const html = link({ language });
      expect(html).toContain('href="https://maker.example/p"');
      expect(html).toContain('rel="noopener"');
      expect(html).toContain('target="_blank"');
      expect(html).not.toContain("sponsored"); // the maker's page, not a partner link
      expect(html).toContain(`results-visuallyHidden"> ${hidden}`);
      expect(html).toContain('aria-hidden="true"'); // the icon
    }
  });
});

describe("where the official link appears", () => {
  const many = FIXTURES["many-results"];
  const withLinks: FitResponse = {
    ...many,
    results: many.results.map((r) => ({
      ...r,
      mouse: {
        ...r.mouse,
        officialUrl: `https://maker.example/${r.mouse.slug}`,
        officialKind: "product" as const,
      },
    })),
  };
  const render = (rank?: number) =>
    renderToStaticMarkup(
      createElement(ResultsView, {
        response: withLinks,
        language: "en",
        scanId: withLinks.scanId,
        ...(rank ? { rank } : {}),
      }),
    );
  const count = (html: string) =>
    (html.match(/class="results-official"/g) ?? []).length;

  it("is in the big header block, once, on the main page and on every detail page", () => {
    for (const rank of [1, 2, 3, 4, 5]) {
      const html = render(rank);
      expect(count(html), `rank ${rank}`).toBe(1);
      const entry = withLinks.results[rank - 1]!;
      expect(html).toContain(
        `href="https://maker.example/${entry.mouse.slug}"`,
      );
    }
  });

  it("sits on the same row as the fit-band chip, after it", () => {
    const html = render(1);
    const row = html.match(/<div class="results-bandRow">.*?<\/a><\/div>/s);
    expect(row?.[0]).toContain("results-band");
    expect(row?.[0]).toContain("results-official");
    expect(row![0].indexOf("results-band")).toBeLessThan(
      row![0].indexOf("results-official"),
    );
  });

  it("is not in the small 'Other picks' cards, nor in the other-mice list", () => {
    const view = filteredView(withLinks, emptyFilters());
    const picks = renderToStaticMarkup(
      createElement(OtherPicks, {
        cards: view.cards.slice(1),
        language: "en",
        hrefFor: () => "/x",
      }),
    );
    expect(picks).toContain("results-card");
    expect(count(picks)).toBe(0);
    expect(picks).not.toContain("maker.example");
    const others = renderToStaticMarkup(
      createElement(OtherMice, {
        ranked: view.rest,
        excluded: [],
        hand: "right",
        language: "en",
      }),
    );
    expect(others).toContain("results-otherMice-row");
    expect(count(others)).toBe(0);
    expect(others).not.toContain("maker.example");
  });

  it("is on the page once in total, never once per card", () => {
    expect(render(1).match(/maker\.example/g)).toHaveLength(1);
  });

  it("is absent when the entry has no official URL", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, { response: many, language: "en" }),
    );
    expect(html).not.toContain("results-official");
    expect(html).toContain("results-band"); // the chip is still there
  });
});
