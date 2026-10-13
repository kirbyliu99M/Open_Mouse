import { describe, expect, it } from "vitest";
import {
  ANALYTICS_COUNT_CAP,
  analyticsBrandKey,
  analyticsEventSchemas,
  retailerOf,
} from "../../src/lib/contracts/analytics";
import {
  CONNECTIVITY_OPTIONS,
  FEATURED_BRANDS,
  SHAPE_OPTIONS,
  SIZE_OPTIONS,
  WEIGHT_OPTIONS,
} from "../../src/lib/results/filters";

const SLUG = "logitech-g-pro-x-superlight-2";
const SCAN_ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const PAGE = { page: "main", rank: 1, filtered: false } as const;
const s = analyticsEventSchemas;

describe("results-page events (2026-10-13)", () => {
  it("accepts the documented shape of each event", () => {
    const ok: [keyof typeof s, unknown][] = [
      [
        "results_page_viewed",
        {
          state: "ready",
          ...PAGE,
          mouse: SLUG,
          overallRank: 1,
          poorFit: false,
        },
      ],
      ["results_page_viewed", { state: "serverError" }],
      ["purchase_links_shown", { ...PAGE, mouse: SLUG, count: 4 }],
      [
        "purchase_link_clicked",
        { ...PAGE, mouse: SLUG, overallRank: 3, retailer: "momo", position: 2 },
      ],
      ["official_link_clicked", { ...PAGE, mouse: SLUG, kind: "brand" }],
      ["details_opened", { page: "detail", rank: 5, filtered: true }],
      ["viewer_used", PAGE],
      ["photo_zoomed", { ...PAGE, mouse: SLUG }],
      ["pick_opened", { ...PAGE, toRank: 2, mouse: SLUG }],
      ["other_mice_opened", PAGE],
      ["similar_hands_shown", { status: "unavailable" }],
      [
        "filter_applied",
        {
          ...PAGE,
          filtered: true,
          source: "sheet",
          brand: ["logitech", "cooler-master"],
          size: ["small"],
          weight: ["lt50", "50-69"],
          shape: [],
          connectivity: ["wireless"],
          count: 0,
        },
      ],
      ["filter_sheet_opened", PAGE],
      ["share_started", { ...PAGE, position: "hero", overall: true }],
      ["share_finished", { ...PAGE, position: "top", outcome: "cancelled" }],
      ["survey_reminder_clicked", { ...PAGE, unanswered: true }],
      ["rescan_clicked", PAGE],
    ];
    for (const [name, props] of ok) {
      expect(s[name].safeParse(props).success, name).toBe(true);
    }
  });

  it("refuses a page event without its page fields, or with a place past 5", () => {
    expect(s.details_opened.safeParse({}).success).toBe(false);
    expect(
      s.details_opened.safeParse({ page: "detail", rank: 6, filtered: false })
        .success,
    ).toBe(false);
    expect(
      s.details_opened.safeParse({ page: "other", rank: 1, filtered: false })
        .success,
    ).toBe(false);
  });

  it("refuses a URL, a scan ID or a free number where they never go", () => {
    const click = (extra: object) =>
      s.purchase_link_clicked.safeParse({
        ...PAGE,
        mouse: SLUG,
        overallRank: 1,
        retailer: "pchome",
        position: 1,
        ...extra,
      }).success;
    expect(click({})).toBe(true);
    expect(click({ url: "https://24h.pchome.com.tw/prod/X" })).toBe(false);
    expect(click({ retailer: "24h.pchome.com.tw" })).toBe(false);
    expect(click({ mouse: SCAN_ID })).toBe(false);
    expect(click({ position: 5 })).toBe(false);
    expect(click({ position: 1.5 })).toBe(false);
  });

  it("caps the filter's counts and refuses a brand that is not a key", () => {
    const applied = (extra: object) =>
      s.filter_applied.safeParse({
        ...PAGE,
        filtered: true,
        source: "sidebar",
        brand: [],
        size: [],
        weight: [],
        shape: [],
        connectivity: [],
        count: 3,
        ...extra,
      }).success;
    expect(applied({ count: ANALYTICS_COUNT_CAP })).toBe(true);
    expect(applied({ count: ANALYTICS_COUNT_CAP + 1 })).toBe(false);
    expect(applied({ brand: ["SteelSeries"] })).toBe(false);
    expect(applied({ brand: ["steel series"] })).toBe(false);
    expect(applied({ size: ["fingertip"] })).toBe(false);
  });

  it("names the filter's options exactly as the filter does", () => {
    const shape = s.filter_applied.shape;
    expect(shape.size.element.options).toEqual([...SIZE_OPTIONS]);
    expect(shape.weight.element.options).toEqual([...WEIGHT_OPTIONS]);
    expect(shape.shape.element.options).toEqual([...SHAPE_OPTIONS]);
    expect(shape.connectivity.element.options).toEqual([
      ...CONNECTIVITY_OPTIONS,
    ]);
  });
});

describe("retailerOf", () => {
  it("maps each shop's hosts, subdomains included", () => {
    expect(retailerOf("https://24h.pchome.com.tw/prod/DGBJ-A900")).toBe(
      "pchome",
    );
    expect(retailerOf("https://www.momoshop.com.tw/goods/x?i_code=1")).toBe(
      "momo",
    );
    expect(retailerOf("https://shopee.tw/product/1/2")).toBe("shopee");
    expect(retailerOf("https://tw.buy.yahoo.com/gdsale/x")).toBe("yahoo");
    expect(retailerOf("https://biggo.com.tw/s/x")).toBe("biggo");
    expect(retailerOf("https://feebee.com.tw/s/x")).toBe("feebee");
    expect(retailerOf("https://www.amazon.co.jp/dp/X")).toBe("amazon");
    expect(retailerOf("https://WWW.MOMOSHOP.COM.TW./x")).toBe("momo");
  });

  it("is `other` for an unknown host, a look-alike, another scheme or junk", () => {
    expect(retailerOf("https://www.logitechg.com/x")).toBe("other");
    expect(retailerOf("https://notmomoshop.com.tw/x")).toBe("other");
    expect(retailerOf("https://momoshop.com.tw.evil.example/x")).toBe("other");
    expect(retailerOf("javascript:alert(1)")).toBe("other");
    expect(retailerOf("not a url")).toBe("other");
    expect(retailerOf("")).toBe("other");
  });
});

describe("analyticsBrandKey", () => {
  it("turns every brand the filter features into an accepted key", () => {
    for (const brand of FEATURED_BRANDS) {
      const key = analyticsBrandKey(brand);
      expect(key, brand).not.toBeNull();
      expect(
        s.filter_applied.shape.brand.element.safeParse(key).success,
        brand,
      ).toBe(true);
    }
    expect(analyticsBrandKey("SteelSeries")).toBe("steelseries");
    expect(analyticsBrandKey("Cooler Master")).toBe("cooler-master");
    expect(analyticsBrandKey("  G.Skill ")).toBe("g-skill");
  });

  it("is null when nothing usable is left", () => {
    expect(analyticsBrandKey("")).toBeNull();
    expect(analyticsBrandKey("---")).toBeNull();
    expect(analyticsBrandKey("羅技")).toBeNull();
  });
});
