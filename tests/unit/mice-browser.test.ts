import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The browser reads the address; there is no router outside the app.
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/mice",
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ refresh: () => {} }),
}));

import { MiceBrowser } from "../../src/app/mice/MiceBrowser";
import { FilterSheet } from "../../src/components/results/filter/FilterSheet";
import type { Locale } from "../../src/lib/contracts/locale";
import {
  searchMice,
  toFilterSource,
  toMiceListRow,
  type MiceListRow,
} from "../../src/lib/mice/list";
import { parseFilters } from "../../src/lib/results/filters";

function rows(n: number): MiceListRow[] {
  return Array.from({ length: n }, (_, i) =>
    toMiceListRow({
      slug: `brand-${String(i).padStart(3, "0")}`,
      brand: i % 2 === 0 ? "Logitech" : "Razer",
      model: `Model ${String(i).padStart(3, "0")}`,
      size: i % 3 === 0 ? "large" : "medium",
      shape: i % 4 === 0 ? "ergonomic" : "symmetrical",
      connectivity: i % 5 === 0 ? "wired" : "wireless",
      lengthMm: 120 + (i % 10),
      widthMm: 63.5,
      heightMm: 40,
      weightG: i % 7 === 0 ? null : 40 + i,
    }),
  );
}

function render(
  data: MiceListRow[],
  opts: { search?: string; language?: Locale; unavailable?: boolean } = {},
): string {
  nav.search = opts.search ?? "";
  return renderToStaticMarkup(
    createElement(MiceBrowser, {
      rows: data,
      language: opts.language ?? "en",
      unavailable: opts.unavailable ?? false,
    }),
  );
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("MiceBrowser (server render, phone layout first)", () => {
  it("shows the first 50 rows in the table and as cards, the count of all, and Show more", () => {
    const html = render(rows(120));
    expect(count(html, /<tr [^>]*data-row-index=/g)).toBe(50);
    expect(count(html, /<li [^>]*class="mice-card"/g)).toBe(50);
    expect(html).toContain("120 mice found");
    expect(html).toContain(">Show more<");
    expect(html).toContain('placeholder="Search brand or model"');
    // The table has its columns, and the size column is named like the filter's group.
    for (const h of [
      "Mouse",
      "Size",
      "Shape",
      "Connection",
      "Length (mm)",
      "Width (mm)",
      "Height (mm)",
      "Weight (g)",
    ])
      expect(html).toContain(`>${h}</th>`);
  });

  it("has no Show more when everything is shown, and says 1 mouse for one", () => {
    expect(render(rows(30))).not.toContain("Show more");
    expect(render(rows(50))).not.toContain("Show more");
    expect(render(rows(1))).toContain("1 mouse found");
  });

  it("starts with the filter and the search from the address, and the count follows both", () => {
    // 120 rows: wired ones are every 5th (24); Logitech are even indexes.
    const html = render(rows(120), { search: "conn=wired&brand=Logitech" });
    const wiredLogitech = rows(120).filter(
      (r) => r.connectivity === "wired" && r.brand === "Logitech",
    ).length;
    expect(html).toContain(`${wiredLogitech} mice found`);
    expect(html).toContain("Applied filters");
    const searched = render(rows(120), { search: "q=model 007" });
    expect(searched).toContain("1 mouse found");
    expect(searched).toContain('value="model 007"');
    expect(count(searched, /<tr [^>]*data-row-index=/g)).toBe(1);
  });

  it("writes a missing value as a dash, never a guess", () => {
    const html = render([
      toMiceListRow({
        slug: "x",
        brand: "Acme",
        model: "Blank",
        size: "small",
        shape: null,
        connectivity: null,
        lengthMm: 100,
        widthMm: 60,
        heightMm: 35,
        weightG: null,
      }),
    ]);
    expect(html).toContain("<td>\u2014</td>");
    expect(html).toContain("100 \u00d7 60 \u00d7 35 mm</p>");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("writes a hybrid shape as Hybrid (zh: 混合型) in the table and on the card, not as a dash, and adds no filter option for it", () => {
    const hybrid = toMiceListRow({
      slug: "h",
      brand: "Acme",
      model: "Mixed",
      size: "small",
      shape: "hybrid",
      connectivity: "wired",
      lengthMm: 100,
      widthMm: 60,
      heightMm: 35,
      weightG: 70,
    });
    const html = render([hybrid]);
    expect(html).toContain("<td>Hybrid</td>");
    expect(html).toMatch(/<li>Hybrid<\/li>/);
    // Only the row's own two places (table cell, card tag): the filter's Shape group has no Hybrid option.
    expect(count(html, /Hybrid/g)).toBe(2);
    expect(html).not.toContain("<td>—</td>");
    const zh = render([hybrid], { language: "zh-TW" });
    expect(zh).toContain("<td>混合型</td>");
    expect(count(zh, /混合型/g)).toBe(2);
    // A mouse without a shape is still a dash, and no Hybrid appears for it.
    const none = render(rows(3));
    expect(none).not.toContain("Hybrid");
  });

  it("has Show more as the primary white button (BTN-1: results-pill, not the small or the text-link style)", () => {
    const html = render(rows(60));
    const button = /<button[^>]*>Show more<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain('class="results-pill mice-more"');
    expect(button).not.toContain("results-pill--small");
    expect(button).not.toContain("results-textLink");
  });

  it("shows the card line with the weight when there is one", () => {
    const html = render(rows(2));
    expect(html).toMatch(/120 \u00d7 63\.5 \u00d7 40 mm<\/p>/);
    expect(html).toMatch(/121 \u00d7 63\.5 \u00d7 40 mm \u00b7 41 g/);
  });

  it("carries no field the page does not show (nothing else is in the rows, so nothing else is in the markup)", () => {
    const html = render(rows(5));
    expect(html).not.toMatch(
      /sourceUrl|dataSource|humpPlacement|frontFlare|sideCurvature|thumbRest|handCompatibility|specRetrievedAt|imagePath|image_path|descriptorSourceUrls|descriptorModel/,
    );
  });

  it("says nothing matches when a search with no filter finds nothing, and offers a way out when a filter does", () => {
    const none = render(rows(10), { search: "q=zzzz" });
    expect(none).toContain("0 mice found");
    expect(none).toContain("No mouse matches this search");
    expect(none).not.toContain("<table");
    const filtered = render(rows(10), { search: "q=zzzz&conn=wired" });
    expect(filtered).toContain("No mouse matches these filters");
  });

  it("shows an empty state instead of an error when the catalogue could not be read", () => {
    const html = render([], { unavailable: true });
    expect(html).toContain("The mouse list could not be loaded");
    expect(html).toContain("0 mice found");
    expect(html).not.toContain("<table");
  });

  it("is in Chinese for zh-TW, and the rows use the filter's own words", () => {
    const html = render(rows(4), { language: "zh-TW" });
    expect(html).toContain("找到 4 款");
    expect(html).toContain("搜尋品牌或型號");
    expect(html).toContain("人體工學");
    expect(html).toContain("左右對稱");
    expect(html).toContain("無線");
    expect(html).toContain("大型鼠");
  });
});

describe("MiceBrowser puts both filter shells in the server's markup (no layout switch after hydration)", () => {
  it("has the sidebar, the phone's bar and one search box, and says which layout CSS shows", () => {
    const html = render(rows(60));
    expect(html).toContain('data-filter="both"');
    expect(html).not.toContain('data-filter="sidebar"');
    expect(html).not.toContain('data-filter="sheet"');
    expect(count(html, /<aside /g)).toBe(1);
    expect(count(html, /class="results-filterChrome"/g)).toBe(1);
    expect(count(html, /type="search"/g)).toBe(1);
    // The search comes first in the markup, so on a phone it is above the Filter button.
    expect(html.indexOf('type="search"')).toBeLessThan(
      html.indexOf("results-filterChrome"),
    );
    // Both shells name the filter and carry the count.
    expect(count(html, /60 mice found/g)).toBeGreaterThanOrEqual(2);
  });

  it("makes the table a keyboard-reachable scroll region", () => {
    const html = render(rows(3));
    expect(html).toMatch(
      /<div class="mice-tableWrap" role="region" aria-label="All mice" tabindex="0">/,
    );
  });
});

describe("the phone sheet's 「View N mice」 counts what the list will show", () => {
  const data = rows(120);
  const full = toFilterSource(data);
  const sheet = (
    query: string,
    filterQuery: string,
    withCountSource: boolean,
  ) => {
    const searched = toFilterSource(searchMice(data, query));
    return renderToStaticMarkup(
      createElement(FilterSheet, {
        response: full,
        countSource: withCountSource ? searched : undefined,
        language: "en",
        applied: parseFilters(filterQuery),
        onApply: () => {},
        onClosed: () => {},
      }),
    );
  };
  const viewCount = (html: string) =>
    Number(/View (\d+) (?:mice|mouse)</.exec(html)![1]);

  it("equals the list's row count after a search (with and without a filter)", () => {
    // Model 007 matches one row; "model 01" matches Model 010 to Model 019 (10 rows).
    expect(viewCount(sheet("model 007", "", true))).toBe(1);
    expect(viewCount(sheet("model 01", "", true))).toBe(10);
    const wired = searchMice(data, "model 01").filter(
      (r) => r.connectivity === "wired",
    ).length;
    expect(wired).toBeGreaterThan(0);
    expect(viewCount(sheet("model 01", "conn=wired", true))).toBe(wired);
    // The list says the same thing.
    const list = render(data, { search: "q=model 01&conn=wired" });
    expect(list).toContain(`${wired} mice found`);
  });

  it("counts the whole catalogue when no source for the count is given (the results page's behaviour)", () => {
    expect(viewCount(sheet("model 007", "", false))).toBe(120);
  });
});
