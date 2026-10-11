import { describe, expect, it, vi } from "vitest";
import {
  fitPreferencesSchema,
  fitResponseSchema,
  type FitEntry,
} from "../../src/lib/contracts/fit";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { loadOwnedFit } from "../../src/server/fit/core";
import { withMedia } from "../../src/server/fit/media";
import mouseMediaFile from "../../src/data/mouse-media.json";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

const MEDIA = {
  a: {
    officialUrl: "https://maker.example/a",
    officialKind: "product",
    image: "/images/mice/a.webp",
  },
  b: {
    officialUrl: "https://maker.example/lineup",
    officialKind: "brand",
    image: null,
  },
};
const PURCHASE = {
  a: [
    { label: "Shop A", url: "https://shop.example/a" },
    { label: "Shop B", url: "https://shop.example/b" },
  ],
  b: [],
};

const entry = (
  slug: string,
  rank = 1,
  extra: Partial<FitEntry["mouse"]> = {},
): FitEntry => {
  const e = makeEntry({ rank });
  return { ...e, mouse: { ...e.mouse, slug, ...extra } };
};

describe("withMedia", () => {
  it("fills the photo, official link, kind and purchase links", () => {
    const [out] = withMedia([entry("a")], { media: MEDIA, purchase: PURCHASE });
    expect(out!.mouse.imageUrl).toBe("/images/mice/a.webp");
    expect(out!.mouse.officialUrl).toBe("https://maker.example/a");
    expect(out!.mouse.officialKind).toBe("product");
    expect(out!.mouse.purchaseLinks).toEqual(PURCHASE.a);
  });

  it("fills every entry, however far down the list: the filter can promote any mouse", () => {
    const many = Array.from({ length: 12 }, (_, i) => entry("a", i + 1));
    const out = withMedia(many, { media: MEDIA, purchase: PURCHASE });
    expect(out).toHaveLength(12);
    for (const e of out) {
      expect(e.mouse.officialUrl).toBe("https://maker.example/a");
      expect(e.mouse.purchaseLinks).toHaveLength(2);
      expect(e.mouse.imageUrl).toBe("/images/mice/a.webp");
    }
  });

  it("keeps the catalogue's own image when the entry already has one", () => {
    const [out] = withMedia([entry("a", 1, { imageUrl: "/images/own.webp" })], {
      media: MEDIA,
      purchase: PURCHASE,
    });
    expect(out!.mouse.imageUrl).toBe("/images/own.webp");
  });

  it("writes null for a slug with no media, and adds no purchase links", () => {
    const [out] = withMedia([entry("ghost")], {
      media: MEDIA,
      purchase: PURCHASE,
    });
    expect(out!.mouse.officialUrl).toBeNull();
    expect(out!.mouse.officialKind).toBeNull();
    expect(out!.mouse.imageUrl).toBeNull();
    expect(out!.mouse).not.toHaveProperty("purchaseLinks");
  });

  it("omits purchaseLinks, rather than writing an empty list, when a slug has none", () => {
    const [out] = withMedia([entry("b")], { media: MEDIA, purchase: PURCHASE });
    expect(out!.mouse).not.toHaveProperty("purchaseLinks");
    expect(out!.mouse.officialKind).toBe("brand");
    expect(out!.mouse.imageUrl).toBeNull(); // a mouse with no photo
  });

  it("treats a file that is not valid as no data, and never reads the prototype", () => {
    const [out] = withMedia([entry("constructor")], {
      media: { constructor: "oops" },
      purchase: null,
    });
    expect(out!.mouse.officialUrl).toBeNull();
    expect(out!.mouse).not.toHaveProperty("purchaseLinks");
    const [proto] = withMedia([entry("toString")], { media: {}, purchase: {} });
    expect(proto!.mouse.officialUrl).toBeNull();
  });

  it("changes no score, rank, order or other field, and does not mutate its input", () => {
    const input = [entry("a", 1), entry("b", 2)];
    const before = JSON.stringify(input);
    const out = withMedia(input, { media: MEDIA, purchase: PURCHASE });
    expect(JSON.stringify(input)).toBe(before);
    expect(out.map((e) => e.mouse.slug)).toEqual(["a", "b"]);
    expect(out.map((e) => e.rank)).toEqual([1, 2]);
    expect(out[0]!.total).toBe(input[0]!.total);
    expect(out[0]!.subscores).toBe(input[0]!.subscores);
  });
});

describe("the bundled media file, through withMedia", () => {
  it("gives an official link to a catalogue slug and passes the contract", () => {
    const slugs = Object.keys(mouseMediaFile);
    expect(slugs.length).toBeGreaterThan(300);
    const out = withMedia(
      slugs.slice(0, 5).map((s) => entry(s)),
      { media: mouseMediaFile, purchase: {} },
    );
    for (const e of out) {
      expect(e.mouse.officialUrl).toMatch(/^https:\/\//);
      expect(["product", "brand"]).toContain(e.mouse.officialKind);
    }
    expect(() =>
      fitResponseSchema.parse(makeFit({ results: out })),
    ).not.toThrow();
  });
});

describe("loadOwnedFit runs withMedia", () => {
  it("returns the fields on every result, for slugs that are in the files and for ones that are not", async () => {
    const { repo: fitRepo } = createFakeFitRepo([...sampleCatalogue]);
    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "s" },
      fitPreferencesSchema.parse({}),
      {
        scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
        fitRepo,
        now: () => new Date("2026-10-11T00:00:00Z"),
      },
    );
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.fit.results.length).toBeGreaterThan(0);
    for (const e of result.fit.results) {
      // Every entry carries the three fields (null when the slug has no media).
      expect(e.mouse).toHaveProperty("officialUrl");
      expect(e.mouse).toHaveProperty("officialKind");
      expect(e.mouse).toHaveProperty("imageUrl");
      const inFile = Object.hasOwn(mouseMediaFile, e.mouse.slug);
      expect(e.mouse.officialUrl === null).toBe(!inFile);
    }
    expect(() => fitResponseSchema.parse(result.fit)).not.toThrow();
  });
});

// Hard rule 2: photo, official link and purchase links are display data. The
// LLM never sees them, and nothing in them becomes an allowed numeral.
describe("media fields never reach the analysis", () => {
  function plainAndRich() {
    const results = [1, 2, 3, 4].map((rank) =>
      entry(`m-${rank}`, rank, { model: `M${rank}` }),
    );
    const plain = makeFit({ results });
    const rich = makeFit({
      results: results.map((e) => ({
        ...e,
        mouse: {
          ...e.mouse,
          imageUrl: "/images/mice/uniq-photo-4711.webp",
          officialUrl: "https://maker.example/uniq-official-4712",
          officialKind: "product" as const,
          purchaseLinks: [
            { label: "UniqShop 4713", url: "https://shop.example/uniq-4714" },
          ],
        },
      })),
    });
    return { plain, rich };
  }

  it("gives the same analysis input with and without the media fields", () => {
    const { plain, rich } = plainAndRich();
    expect(() => fitResponseSchema.parse(rich)).not.toThrow();
    const m = makeMeasurements();
    const a = buildAnalysisInput(plain, m, "en");
    const b = buildAnalysisInput(rich, m, "en");
    expect(b).toEqual(a);
    const json = JSON.stringify(b);
    for (const word of [
      "officialUrl",
      "officialKind",
      "purchaseLinks",
      "imageUrl",
      "uniq-photo",
      "uniq-official",
      "UniqShop",
      "uniq-4714",
      "maker.example",
      "shop.example",
    ]) {
      expect(json).not.toContain(word);
    }
    for (const top of b.topPicks) {
      for (const key of [
        "officialUrl",
        "officialKind",
        "purchaseLinks",
        "imageUrl",
      ]) {
        expect(top).not.toHaveProperty(key);
      }
    }
  });

  it("no digit in a link or a photo name enters the numeral allow-list", () => {
    const { plain, rich } = plainAndRich();
    const m = makeMeasurements();
    const allowed = collectNumbers(buildAnalysisInput(rich, m, "en"));
    for (const n of [4711, 4712, 4713, 4714]) {
      expect(allowed.has(n)).toBe(false);
    }
    expect([...allowed].sort()).toEqual(
      [...collectNumbers(buildAnalysisInput(plain, m, "en"))].sort(),
    );
  });
});
