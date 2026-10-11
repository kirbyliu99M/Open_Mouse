import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PurchaseSlot } from "../../src/components/results/PurchaseSlot";
import {
  linksForSlug,
  parsePurchaseLinks,
} from "../../src/lib/results/purchaseLinks";
import bundled from "../../src/data/purchase-links.json";

const VALID = {
  "logitech-g-pro-x-superlight-2": [
    { label: "Shop A", url: "https://shop.example/superlight" },
    { label: "商店 B", url: "https://store.example/p?id=1" },
  ],
};

describe("purchase links file", () => {
  it("ships as an empty object, which is valid", () => {
    expect(bundled).toEqual({});
    expect(parsePurchaseLinks(bundled)).toEqual({});
  });
});

describe("parsePurchaseLinks / linksForSlug", () => {
  it("keeps a valid file and reads one slug's links in order", () => {
    expect(parsePurchaseLinks(VALID)).toEqual(VALID);
    expect(
      linksForSlug(VALID, "logitech-g-pro-x-superlight-2").map((l) => l.label),
    ).toEqual(["Shop A", "商店 B"]);
  });

  it("gives no links for a slug that is not in the file", () => {
    expect(linksForSlug(VALID, "razer-deathadder-v3")).toEqual([]);
    expect(linksForSlug({}, "anything")).toEqual([]);
  });

  it("never reads the prototype for a slug like 'constructor'", () => {
    expect(linksForSlug({}, "constructor")).toEqual([]);
    expect(linksForSlug(VALID, "toString")).toEqual([]);
  });

  it("treats an invalid file as empty instead of throwing", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      [],
      { "Not A Slug": [] },
      { a: [{ label: "x", url: "http://insecure.example" }] },
      { a: [{ label: "x", url: "https://user:pw@host.example" }] },
      { a: [{ label: "", url: "https://ok.example" }] },
      { a: "not an array" },
      {
        a: Array.from({ length: 5 }, () => ({
          label: "x",
          url: "https://ok.example",
        })),
      },
    ]) {
      expect(parsePurchaseLinks(bad)).toEqual({});
      expect(linksForSlug(bad, "a")).toEqual([]);
    }
  });
});

describe("PurchaseSlot", () => {
  const LINKS = VALID["logitech-g-pro-x-superlight-2"];
  const render = (
    links: Parameters<typeof PurchaseSlot>[0]["links"],
    language: "en" | "zh-TW" = "en",
  ) => renderToStaticMarkup(createElement(PurchaseSlot, { links, language }));

  it("renders nothing without links", () => {
    expect(render([])).toBe("");
    expect(render(undefined)).toBe("");
    expect(render(null)).toBe("");
  });

  it("renders the links with rel sponsored noopener and a new tab", () => {
    const html = render(LINKS);
    const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a).toContain('rel="sponsored noopener"');
      expect(a).toContain('target="_blank"');
    }
    expect(html).toContain("https://shop.example/superlight");
    expect(html).toContain("Shop A");
  });

  it("has the one-word heading and no visible note line, in both languages", () => {
    const en = render(LINKS, "en");
    const zh = render(LINKS, "zh-TW");
    expect(en).toContain(">Buy</h2>");
    expect(zh).toContain(">購買</h2>");
    for (const html of [en, zh]) {
      expect(html).not.toMatch(
        /Partner|Where to buy|合作商店|購買連結|results-purchase-note/,
      );
      // The only paragraph-like text left is the heading and the shop names.
      expect(html).not.toMatch(/<p[ >]/);
    }
  });

  it("says 'opens in a new tab' only to a screen reader, once per link", () => {
    for (const [language, hidden] of [
      ["en", "(opens in a new tab)"],
      ["zh-TW", "（開新分頁）"],
    ] as const) {
      const html = render(LINKS, language);
      expect(html.split(hidden)).toHaveLength(3); // two links
      const anchors = [...html.matchAll(/<a [^>]*>.*?<\/a>/g)].map((m) => m[0]);
      expect(anchors).toHaveLength(2);
      for (const a of anchors) {
        expect(a).toContain("results-visuallyHidden");
        expect(a).toContain(hidden);
        // The icon is decorative.
        expect(a).toContain('aria-hidden="true"');
      }
    }
  });

  it("renders up to four rows, in the given order", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      label: `Shop ${i + 1}`,
      url: `https://shop${i + 1}.example/p`,
    }));
    const html = render(four);
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html.indexOf("Shop 1")).toBeLessThan(html.indexOf("Shop 4"));
    // A fifth (not allowed by the contract) is never drawn.
    expect(
      render([
        ...four,
        { label: "Shop 5", url: "https://shop5.example/p" },
      ]).match(/<li>/g),
    ).toHaveLength(4);
  });

  it("keeps a long shop name in full (it wraps; the DOM never cuts it)", () => {
    const label = "一家名字非常非常長的合作商店旗艦店 Official Flagship Store";
    const html = render([{ label, url: "https://shop.example/x" }], "zh-TW");
    expect(html).toContain(label);
    expect(html).not.toContain("…");
  });

  it("does not read src/data/purchase-links.json: the slot takes its links as a prop", () => {
    const source = readFileSync(
      "src/components/results/PurchaseSlot.tsx",
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["'][^"']*purchase-links\.json["']/);
    expect(source).not.toContain("purchaseLinksFile");
  });
});
