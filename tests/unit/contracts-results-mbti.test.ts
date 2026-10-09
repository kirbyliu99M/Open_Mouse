import { describe, expect, it } from "vitest";
import { ENGINE_VERSION_V1 } from "../../src/server/fit/coefficients";
import { purchaseLinksSchema } from "../../src/lib/contracts/commerce";
import {
  CATALOGUE_CATEGORIES,
  DATA_SOURCES,
} from "../../src/lib/contracts/descriptors";
import {
  HAND_TYPE_SIZES,
  HAND_TYPE_WIDTHS,
  SUBSCORES,
  fitResponseSchema,
} from "../../src/lib/contracts/fit";

const sub = {
  score: 90,
  weight: 0.2,
  reason: { code: "length_ideal", params: {} },
};
const mouse = {
  slug: "logitech-g-pro-x-superlight-2",
  brand: "Logitech",
  model: "G Pro X Superlight 2",
  lengthMm: 125,
  widthMm: 63.5,
  heightMm: 40,
  weightG: 60,
  size: "large",
};
const base = {
  scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f",
  engineVersion: ENGINE_VERSION_V1,
  hand: "right",
  gripStyle: { stated: null, predicted: "claw", used: "claw" },
  targets: { lengthMm: 118, gripWidthMm: 62, heightMm: 39 },
  excluded: [],
  results: [
    {
      rank: 1,
      mouse,
      total: 80,
      confidence: 1,
      subscores: Object.fromEntries(SUBSCORES.map((k) => [k, sub])),
    },
  ],
};

describe("contract additions of 2026-10-08", () => {
  it("keeps a fit-v0 response (no new fields) valid", () => {
    expect(fitResponseSchema.safeParse(base).success).toBe(true);
  });

  it("accepts category, imageUrl, grip weights and a hand type", () => {
    const v1 = {
      ...base,
      gripStyle: {
        ...base.gripStyle,
        weights: { palm: 0.2, claw: 0.7, fingertip: 0.1 },
      },
      handType: { size: "medium", grip: "claw", width: "wide" },
      results: [
        {
          ...base.results[0],
          mouse: {
            ...mouse,
            category: "gaming",
            imageUrl: "/images/mice/logitech-g-pro-x-superlight-2.webp",
          },
        },
      ],
    };
    expect(fitResponseSchema.safeParse(v1).success).toBe(true);
  });

  it.each([
    ["/images/mice/logitech-g309.webp", true],
    ["/a", true],
    ["https://example.com/a.webp", false],
    ["//evil.com/a.webp", false],
    ["/\\evil.com/a.webp", false],
    ["/images/../secret", false],
    ["", false],
    ["images/mice/a.webp", false],
    ["javascript:alert(1)", false],
  ])("imageUrl %j is accepted: %s", (imageUrl, ok) => {
    const parsed = fitResponseSchema.safeParse({
      ...base,
      results: [{ ...base.results[0], mouse: { ...mouse, imageUrl } }],
    });
    expect(parsed.success).toBe(ok);
  });

  it("accepts a null imageUrl", () => {
    const parsed = fitResponseSchema.safeParse({
      ...base,
      results: [{ ...base.results[0], mouse: { ...mouse, imageUrl: null } }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a category outside the contract", () => {
    const parsed = fitResponseSchema.safeParse({
      ...base,
      results: [{ ...base.results[0], mouse: { ...mouse, category: "toy" } }],
    });
    expect(parsed.success).toBe(false);
  });

  it.each([
    [{ palm: 1.2, claw: 0, fingertip: 0 }],
    [{ palm: -0.1, claw: 0.6, fingertip: 0.5 }],
    [{ palm: 0.5, claw: 0.5 }],
    [{ palm: 0.2, claw: 0.7, fingertip: 0.1, extra: 0 }],
  ])("rejects grip weights %j", (weights) => {
    const parsed = fitResponseSchema.safeParse({
      ...base,
      gripStyle: { ...base.gripStyle, weights },
    });
    expect(parsed.success).toBe(false);
  });

  it.each([
    [{ size: "huge", grip: "claw", width: "wide" }],
    [{ size: "medium", grip: "pinch", width: "wide" }],
    [{ size: "medium", grip: "claw", width: "narrow" }],
    [{ size: "medium", grip: "claw" }],
    [{ size: "medium", grip: "claw", width: "wide", rank: 1 }],
  ])("rejects hand type %j", (handType) => {
    expect(fitResponseSchema.safeParse({ ...base, handType }).success).toBe(
      false,
    );
  });

  it("pins the new enums", () => {
    expect(CATALOGUE_CATEGORIES).toEqual(["gaming", "office"]);
    expect(DATA_SOURCES).toEqual(["first_party", "eloshapes"]);
    expect(HAND_TYPE_SIZES).toEqual(["small", "medium", "large"]);
    expect(HAND_TYPE_WIDTHS).toEqual(["slim", "wide"]);
  });
});

describe("purchaseLinksSchema", () => {
  it("accepts https links keyed by slug, empty lists included", () => {
    const ok = purchaseLinksSchema.safeParse({
      "logitech-g-pro-x-superlight-2": [
        { label: "Shop", url: "https://shop.example.com/p/1" },
      ],
      "razer-viper-v3-pro": [],
    });
    expect(ok.success).toBe(true);
  });

  const link = { label: "Shop", url: "https://shop.example.com/p/1" };
  const ok = (links: unknown) =>
    purchaseLinksSchema.safeParse({ a: links }).success;

  it("accepts exactly four links and a 40-character label", () => {
    expect(ok([link, link, link, link])).toBe(true);
    expect(ok([{ ...link, label: "x".repeat(40) }])).toBe(true);
  });

  it.each([
    ["http://shop.example.com"],
    ["HTTPS://shop.example.com"],
    ["https://user:pw@shop.example.com"],
    ["https:///shop.example.com"],
    ["https://"],
    ["javascript:alert(1)"],
    ["not a url"],
  ])("rejects url %j", (url) => {
    expect(ok([{ ...link, url }])).toBe(false);
  });

  it.each([[""], ["Logitech G309"], ["-g309"], ["g309-"]])(
    "rejects slug key %j",
    (key) => {
      expect(purchaseLinksSchema.safeParse({ [key]: [link] }).success).toBe(
        false,
      );
    },
  );

  it("never passes a __proto__ key through", () => {
    const parsed = purchaseLinksSchema.safeParse(
      JSON.parse('{"__proto__": [{"label": "x", "url": "https://a.example"}]}'),
    );
    expect(
      parsed.success &&
        Object.prototype.hasOwnProperty.call(parsed.data, "__proto__"),
    ).toBe(false);
  });

  it("rejects empty or blank labels, long labels and five links", () => {
    expect(ok([{ ...link, label: "" }])).toBe(false);
    expect(ok([{ ...link, label: "   " }])).toBe(false);
    expect(ok([{ ...link, label: "x".repeat(41) }])).toBe(false);
    expect(ok([link, link, link, link, link])).toBe(false);
  });
});
