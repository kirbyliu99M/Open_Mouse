import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

const render = (source: unknown, slug = "logitech-g-pro-x-superlight-2") =>
  renderToStaticMarkup(
    createElement(PurchaseSlot, { slug, language: "en", source }),
  );

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
  it("renders nothing for an empty file", () => {
    expect(render({})).toBe("");
  });

  it("renders nothing for a slug with no links", () => {
    expect(render(VALID, "razer-deathadder-v3")).toBe("");
  });

  it("renders nothing, and does not crash, for an invalid file", () => {
    expect(render({ "logitech-g-pro-x-superlight-2": "oops" })).toBe("");
    expect(render(null)).toBe("");
  });

  it("renders the links with rel sponsored noopener and a new tab", () => {
    const html = render(VALID);
    const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a).toContain('rel="sponsored noopener"');
      expect(a).toContain('target="_blank"');
    }
    expect(html).toContain("https://shop.example/superlight");
    expect(html).toContain("Shop A");
  });

  it("reads the bundled file by default (empty today, so nothing shows)", () => {
    expect(
      renderToStaticMarkup(
        createElement(PurchaseSlot, { slug: "anything", language: "zh-TW" }),
      ),
    ).toBe("");
  });
});
