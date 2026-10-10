import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnalysisState } from "../../src/components/results/analysisState";
import { FilterChips } from "../../src/components/results/filter/FilterChips";
import { FilterFacets } from "../../src/components/results/filter/FilterFacets";
import { FilterSheet } from "../../src/components/results/filter/FilterSheet";
import { ResultsView } from "../../src/components/results/ResultsView";
import type { FitResponse } from "../../src/lib/contracts/fit";
import { emptyFilters, type Filters } from "../../src/lib/results/filters";
import { filterFit, type FilterSpec } from "./fixtures/filter-fit";

const noop = () => {};

const f = (patch: Partial<Filters>): Filters => ({
  ...emptyFilters(),
  ...patch,
});

const SPECS: FilterSpec[] = [
  { slug: "a1", brand: "Zowie", size: "medium", weightG: 60 },
  {
    slug: "r2",
    brand: "Razer",
    size: "medium",
    weightG: 55,
    connectivity: "wired",
  },
  { slug: "r3", brand: "Razer", size: "small", weightG: 95 },
  { slug: "l4", brand: "Logitech", size: "large", weightG: null },
  { slug: "c5", brand: "Corsair", size: "medium", weightG: 72 },
  { slug: "p6", brand: "Pulsar", size: "medium", weightG: 48 },
  { slug: "s7", brand: "SteelSeries", size: "large", weightG: 80 },
  { slug: "x8", brand: "Alpha", size: "small", weightG: 66 },
  { slug: "x9", brand: "Beta", size: "small", weightG: 66 },
];

const response = (over: Partial<FitResponse> = {}) =>
  filterFit(SPECS, {
    handType: { size: "medium", grip: "claw", width: "wide" },
    ...over,
  });

function facets(r: FitResponse, filters: Filters) {
  return renderToStaticMarkup(
    createElement(FilterFacets, {
      response: r,
      language: "zh-TW",
      filters,
      onChange: noop,
    }),
  );
}

describe("FilterFacets", () => {
  it("names each option with its count, and keeps a disabled one in the Tab order", () => {
    const filters = f({ brand: ["Logitech"], order: ["brand"] });
    const html = facets(response(), filters);
    // Logitech is chosen and has a card; Razer would give 0 with Logitech's group ignored? No: its own group
    // does not narrow it, so it counts all its cards.
    expect(html).toContain('aria-label="Razer，2 款"');
    // A weight the chosen brand has nothing in is disabled, announced as 0 款, and still focusable.
    const disabled = html.match(/<input[^>]*aria-label="50–69 g，0 款"[^>]*>/);
    expect(disabled?.[0]).toContain('aria-disabled="true"');
    expect(disabled?.[0]).not.toContain("tabindex");
    expect(disabled?.[0]).not.toContain(" disabled");
  });

  it("never disables a chosen option, even with nothing behind it", () => {
    const filters = f({
      brand: ["Logitech"],
      size: ["small"],
      order: ["brand", "size"],
    });
    const html = facets(response(), filters);
    const chosen = html.match(/<input[^>]*aria-label="小型鼠，0 款"[^>]*>/);
    expect(chosen?.[0]).toContain('checked=""');
    expect(chosen?.[0]).not.toContain("aria-disabled");
  });

  it("opens 品牌 and the groups with a choice; the others show 「不限」 or the choice", () => {
    const filters = f({
      connectivity: ["wireless"],
      order: ["connectivity"],
    });
    const html = facets(response(), filters);
    const section = (group: string) =>
      html.slice(html.indexOf(`data-group="${group}"`)).split("</section>")[0]!;
    expect(section("brand")).toContain('aria-expanded="true"');
    expect(section("connectivity")).toContain('aria-expanded="true"');
    expect(section("size")).toContain('aria-expanded="false"');
    expect(section("size")).toContain("不限");
    expect(section("weight")).toContain("不限");
    // Opened, a group no longer needs its summary.
    expect(section("connectivity")).not.toContain("results-facet-summary");
  });

  it("a collapsed group with a choice says it: 「無線」", () => {
    // The choice is made, the group is closed by hand afterwards in the browser;
    // here only the summary text itself is pinned.
    const html = facets(response(), emptyFilters());
    expect(html).not.toContain('results-facet-summary" data-chosen');
  });

  it("brands: the featured ones first in order, the rest behind 「顯示其他 N 個品牌」", () => {
    const html = facets(response(), emptyFilters());
    const order = ["Logitech", "Razer", "Corsair", "SteelSeries", "Pulsar"].map(
      (b) => html.indexOf(`aria-label="${b}，`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("顯示其他 3 個品牌");
    // Zowie, Alpha and Beta are behind the link.
    expect(html).not.toContain('aria-label="Zowie，');
  });

  it("opens the other brands when one of them is chosen", () => {
    const html = facets(response(), f({ brand: ["Zowie"], order: ["brand"] }));
    expect(html).toContain('aria-label="Zowie，');
    expect(html).toContain("收合其他品牌");
  });

  it("適合你 sits on the size that matches the hand type, and nowhere else", () => {
    const html = facets(response(), emptyFilters());
    expect(html.match(/class="results-facet-fits"/g)).toHaveLength(1);
    const row = html.match(
      /<label[^>]*>(?:(?!<\/label>).)*中型鼠(?:(?!<\/label>).)*<\/label>/,
    );
    expect(row?.[0]).toContain("適合你");
    expect(html).toContain('aria-label="中型鼠，4 款，適合你"');
  });

  it("no 適合你 without a hand type, or for a left-hand scan", () => {
    expect(
      facets(response({ handType: undefined }), emptyFilters()),
    ).not.toContain("適合你");
    expect(facets(response({ hand: "left" }), emptyFilters())).not.toContain(
      "適合你",
    );
  });

  it("says how many mice have no weight data while weight is chosen", () => {
    const html = facets(
      response(),
      f({ weight: ["gte90"], order: ["weight"] }),
    );
    expect(html).toContain("另有 1 款沒有重量資料，篩選時不會列出");
    expect(facets(response(), emptyFilters())).not.toContain("沒有重量資料");
  });

  it("the size group says how it is estimated", () => {
    expect(facets(response(), emptyFilters())).toContain("依長度與寬度估算");
  });

  it("has the five groups in the fixed order", () => {
    const html = facets(response(), emptyFilters());
    const at = ["品牌", "尺寸", "重量", "滑鼠握感", "連線方式"].map((g) =>
      html.indexOf(`<span class="results-facet-title">${g}</span>`),
    );
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // 「其他」 was dropped from the grip group.
    expect(html).not.toContain("其他<");
  });
});

describe("FilterChips", () => {
  const chips = (filters: Filters) =>
    renderToStaticMarkup(
      createElement(FilterChips, {
        filters,
        language: "zh-TW",
        onChange: noop,
      }),
    );

  it("renders nothing with no filter", () => {
    expect(chips(emptyFilters())).toBe("");
  });

  it("one removable chip per choice, in the order the groups were added, with 「清除全部」", () => {
    const html = chips(
      f({
        brand: ["Razer"],
        connectivity: ["wireless"],
        order: ["connectivity", "brand"],
      }),
    );
    expect(html.indexOf("無線")).toBeLessThan(html.indexOf("Razer"));
    expect(html).toContain('aria-label="移除「Razer」"');
    expect(html).toContain('aria-label="移除「無線」"');
    expect(html).toContain("清除全部");
  });
});

describe("FilterSheet", () => {
  const html = renderToStaticMarkup(
    createElement(FilterSheet, {
      response: response(),
      language: "zh-TW",
      applied: f({ brand: ["Razer"], order: ["brand"] }),
      onApply: noop,
      onClosed: noop,
    }),
  );

  it("is a dialog named by its title, with a visible way to close and a title focus can land on", () => {
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="/);
    expect(html).toContain('aria-label="關閉篩選"');
    expect(html).toMatch(/<h2[^>]*tabindex="-1"[^>]*>篩選<\/h2>/);
  });

  it("starts from the applied filters and offers 「清除全部」 and 「查看 N 款滑鼠」", () => {
    expect(html).toContain("清除全部");
    expect(html).toContain("查看 2 款滑鼠");
    expect(html).toContain('aria-label="Razer，2 款"');
  });

  it("has one status region (the page's own is not rendered while the sheet is open)", () => {
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });
});

describe("the results page under a filter", () => {
  const render = (
    r: FitResponse,
    filters: Filters,
    extra: {
      rank?: number;
      scanId?: string;
      analysisState?: AnalysisState;
    } = {},
  ) =>
    renderToStaticMarkup(
      createElement(ResultsView, {
        response: r,
        language: "zh-TW",
        filters,
        onFiltersChange: noop,
        ...extra,
      }),
    );
  const READY: AnalysisState = {
    status: "ready",
    response: {
      output: {
        headline: "Headline text",
        whyTopPick: "Why text.",
        tradeoffs: [],
        whatToAvoid: [],
        caveats: [],
      },
      source: "model",
      cached: false,
    },
  };
  const razer = f({ brand: ["Razer"], order: ["brand"] });

  it("no filter: nothing of the filter's page changes (no badge, no collapsed analysis, the primary share button)", () => {
    const html = render(response(), emptyFilters(), { analysisState: READY });
    expect(html).not.toContain("results-badge");
    expect(html).not.toContain("results-analysisLine");
    expect(html).toContain("第 1 名 · Zowie");
    expect(html).toContain("Why text.");
    expect(html).not.toContain("share-filter-note");
  });

  it("the filtered #1 on the large card: outlined badge, the overall rank, the brand on its own line", () => {
    const html = render(response(), razer, { analysisState: READY });
    expect(html).toContain("篩選後第 1 名");
    expect(html).toContain("總排名第 2 名");
    expect(html).toContain('<p class="results-score-brand">Razer</p>');
    expect(html).toContain('<h2 class="results-score-model">R2</h2>');
    // Not the filled blue badge: an outlined one (its own class, no fill).
    expect(html).toContain('class="results-badge"');
    // The old rank line is not shown beside it.
    expect(html).not.toContain("第 1 名 · Razer");
  });

  it("the analysis collapses to one line about the overall #1 and expands in place", () => {
    const html = render(response(), razer, { analysisState: READY });
    expect(html).toContain("AI 分析是針對總排名第 1 的 Zowie A1");
    expect(html).toContain("看分析");
    expect(html).toContain('aria-expanded="false"');
    // Closed: the analysis text is not on the page, and not in Details either.
    expect(html).not.toContain("Why text.");
  });

  it("when the overall #1 still matches nothing changes: no badge, the analysis stays in Details", () => {
    const html = render(response(), f({ size: ["medium"], order: ["size"] }), {
      analysisState: READY,
    });
    expect(html).not.toContain("results-badge");
    expect(html).not.toContain("AI 分析是針對");
    expect(html).toContain("第 1 名 · Zowie");
    expect(html).toContain("Why text.");
  });

  it("the share button turns secondary and says it shares the overall #1", () => {
    const html = render(response(), razer);
    expect(html).toContain("分享總排名第 1 名");
    expect(html).toContain("篩選中，分享圖仍放總排名第 1 名");
    expect(html).toContain("shareCard-button-secondary");
    expect(html).not.toContain("shareCard-button-primary");
  });

  it("the other picks are the filtered list, renumbered, with the overall rank beside the score", () => {
    const html = render(response(), razer, { scanId: "scan-1" });
    expect(html).toContain("其他符合條件的推薦");
    expect(html).toContain("第 2 名");
    expect(html).toContain("總排名第 3 名");
    expect(html).not.toContain("Logitech L4");
  });

  it("links keep the filter's query string, and the filtered #1 would link to the main page", () => {
    const html = render(response(), razer, { scanId: "scan-1" });
    expect(html).toContain('href="/results/scan-1/m/r3?brand=Razer"');
  });

  it("a detail page of a filtered card shows its filtered place and its overall rank", () => {
    const html = render(response(), razer, { rank: 2, scanId: "scan-1" });
    expect(html).toContain("篩選後第 2 名");
    expect(html).toContain("總排名第 3 名");
    expect(html).toContain('<h2 class="results-score-model">R3</h2>');
    // The other picks are the filtered list without this one.
    expect(html).toContain('href="/results/scan-1?brand=Razer"');
  });

  it("the low-fit reminder reads the large card's score, not the overall #1's", () => {
    const r = response();
    // The overall #1 fits well; the filtered #1 (R2) does not.
    r.results[1]!.total = 30;
    const plain = render(r, emptyFilters());
    expect(plain).not.toContain("results-fitNotice");
    const filtered = render(r, razer);
    expect(filtered).toContain("results-fitNotice");
  });

  it("no match: one sentence and the suggestion built by suggestRelaxation", () => {
    const html = render(
      response(),
      f({ brand: ["Logitech"], size: ["small"], order: ["brand", "size"] }),
    );
    expect(html).toContain("目前沒有符合條件的滑鼠");
    // Dropping 尺寸 leaves Logitech's one card; dropping 品牌 leaves 3 small ones: the most wins.
    expect(html).toContain("拿掉「品牌」條件，可看到 3 款");
    expect(html).not.toContain("results-score-model");
  });

  it("no match and nothing helps: only 「清除全部」 in the box", () => {
    const html = render(
      response(),
      f({
        brand: ["Logitech"],
        size: ["small"],
        weight: ["gte90"],
        shape: ["symmetrical"],
        order: ["brand", "size", "weight", "shape"],
      }),
    );
    expect(html).toContain("目前沒有符合條件的滑鼠");
    expect(html).not.toContain("拿掉「");
  });

  it("one left: 「只有這 1 款符合」", () => {
    const html = render(
      response(),
      f({ brand: ["Logitech"], order: ["brand"] }),
    );
    expect(html).toContain("只有這 1 款符合");
    expect(render(response(), razer)).not.toContain("只有這 1 款符合");
  });

  it("excluded mice are hidden with a note while filtering", () => {
    const r = response({
      excluded: [
        { slug: "e1", brand: "X", model: "Left One", reason: "wrong_hand" },
      ],
    });
    const off = render(r, emptyFilters());
    expect(off).toContain("Left One");
    const on = render(r, razer);
    expect(on).not.toContain("Left One");
    expect(on).toContain("篩選中，未列入比較的 1 款不會列出。");
  });

  it("without onFiltersChange (the demo) there is no filter at all", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, { response: response(), language: "zh-TW" }),
    );
    expect(html).not.toContain("results-filterBar");
    expect(html).not.toContain("results-sidebar");
  });

  it("the phone bar shows 「篩選（n）」, the count and the chips", () => {
    const html = render(
      response(),
      f({
        brand: ["Razer"],
        connectivity: ["wireless"],
        order: ["brand", "connectivity"],
      }),
    );
    expect(html).toContain("篩選（2）");
    expect(html).toContain("找到 1 款");
    expect(html).toContain('aria-label="移除「Razer」"');
    expect(html).toContain("清除全部");
  });
});
