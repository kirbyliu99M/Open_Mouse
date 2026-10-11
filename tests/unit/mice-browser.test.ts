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
import type { Locale } from "../../src/lib/contracts/locale";
import { toMiceListRow, type MiceListRow } from "../../src/lib/mice/list";

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

  it("shows the card line with the weight when there is one", () => {
    const html = render(rows(2));
    expect(html).toMatch(/120 \u00d7 63\.5 \u00d7 40 mm<\/p>/);
    expect(html).toMatch(/121 \u00d7 63\.5 \u00d7 40 mm \u00b7 41 g/);
  });

  it("carries no field the page does not show (nothing else is in the rows, so nothing else is in the markup)", () => {
    const html = render(rows(5));
    expect(html).not.toMatch(
      /sourceUrl|dataSource|humpPlacement|frontFlare|sideCurvature|thumbRest|handCompatibility|specRetrievedAt/,
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
