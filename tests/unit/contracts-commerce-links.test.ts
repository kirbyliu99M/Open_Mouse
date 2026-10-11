import { describe, expect, it } from "vitest";
import {
  OFFICIAL_URL_KINDS,
  httpsUrlSchema,
  mouseLinksSchema,
} from "../../src/lib/contracts/commerce";

const shop = { label: "Shop A", url: "https://shop.example/a" };

describe("mouseLinksSchema (2026-10-11, candidate)", () => {
  it("accepts an official link, its kind and up to four shops", () => {
    for (const kind of OFFICIAL_URL_KINDS) {
      expect(
        mouseLinksSchema.safeParse({
          officialUrl: "https://maker.example/mouse",
          officialKind: kind,
          purchaseLinks: [shop, shop, shop, shop],
        }).success,
      ).toBe(true);
    }
  });

  it("accepts no official link and no shops", () => {
    expect(
      mouseLinksSchema.safeParse({
        officialUrl: null,
        officialKind: null,
        purchaseLinks: [],
      }).success,
    ).toBe(true);
  });

  it.each([
    ["an http official link", { officialUrl: "http://maker.example/m" }],
    [
      "an official link with credentials",
      { officialUrl: "https://user:pw@maker.example/m" },
    ],
    ["an official link that is not a URL", { officialUrl: "maker.example/m" }],
    ["an unknown official kind", { officialKind: "shop" }],
    ["five shops", { purchaseLinks: [shop, shop, shop, shop, shop] }],
    [
      "a shop over http",
      { purchaseLinks: [{ label: "A", url: "http://shop.example/a" }] },
    ],
    ["a shop with an extra field", { purchaseLinks: [{ ...shop, rank: 1 }] }],
    ["an extra top-level field", { rank: 1 }],
  ])("rejects %s", (_, extra) => {
    expect(
      mouseLinksSchema.safeParse({
        officialUrl: null,
        officialKind: null,
        purchaseLinks: [],
        ...extra,
      }).success,
    ).toBe(false);
  });

  it("shares one https rule with the purchase links", () => {
    expect(httpsUrlSchema.safeParse("https://a.example/x").success).toBe(true);
    expect(httpsUrlSchema.safeParse("ftp://a.example/x").success).toBe(false);
  });
});
