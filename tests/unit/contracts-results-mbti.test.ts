import { describe, expect, it } from "vitest";
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
  engineVersion: "fit-v1-candidate",
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

  it("accepts a null imageUrl but not an absolute or external one", () => {
    const withImage = (imageUrl: unknown) => ({
      ...base,
      results: [{ ...base.results[0], mouse: { ...mouse, imageUrl } }],
    });
    expect(fitResponseSchema.safeParse(withImage(null)).success).toBe(true);
    expect(
      fitResponseSchema.safeParse(withImage("https://example.com/a.webp"))
        .success,
    ).toBe(false);
  });

  it("rejects a hand type outside the enums", () => {
    const bad = {
      ...base,
      handType: { size: "huge", grip: "claw", width: "wide" },
    };
    expect(fitResponseSchema.safeParse(bad).success).toBe(false);
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

  it("rejects http links, empty labels and more than four links", () => {
    const link = { label: "Shop", url: "https://shop.example.com/p/1" };
    expect(
      purchaseLinksSchema.safeParse({
        a: [{ label: "Shop", url: "http://shop.example.com" }],
      }).success,
    ).toBe(false);
    expect(
      purchaseLinksSchema.safeParse({ a: [{ ...link, label: "" }] }).success,
    ).toBe(false);
    expect(
      purchaseLinksSchema.safeParse({ a: [link, link, link, link, link] })
        .success,
    ).toBe(false);
  });
});
