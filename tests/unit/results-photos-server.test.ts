import { describe, expect, it, vi } from "vitest";
import {
  fitPreferencesSchema,
  fitResponseSchema,
  type FitEntry,
} from "../../src/lib/contracts/fit";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { loadOwnedFit } from "../../src/server/fit/core";
import { withPhotos } from "../../src/server/fit/photos";
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

const entry = (
  slug: string,
  rank = 1,
  extra: Partial<FitEntry["mouse"]> = {},
): FitEntry => {
  const e = makeEntry({ rank });
  return { ...e, mouse: { ...e.mouse, slug, ...extra } };
};

describe("withPhotos", () => {
  it("fills the photo from the media file", () => {
    const [out] = withPhotos([entry("a")], MEDIA);
    expect(out!.mouse.imageUrl).toBe("/images/mice/a.webp");
  });

  it("fills every entry, however far down the list: the filter can promote any mouse", () => {
    const many = Array.from({ length: 12 }, (_, i) => entry("a", i + 1));
    const out = withPhotos(many, MEDIA);
    expect(out).toHaveLength(12);
    for (const e of out) expect(e.mouse.imageUrl).toBe("/images/mice/a.webp");
  });

  it("keeps the catalogue's own image when the entry already has one", () => {
    const [out] = withPhotos(
      [entry("a", 1, { imageUrl: "/images/own.webp" })],
      MEDIA,
    );
    expect(out!.mouse.imageUrl).toBe("/images/own.webp");
  });

  it("writes null for a slug with no media and for a mouse with no photo", () => {
    const out = withPhotos([entry("ghost"), entry("b")], MEDIA);
    expect(out[0]!.mouse.imageUrl).toBeNull();
    expect(out[1]!.mouse.imageUrl).toBeNull();
  });

  it("adds nothing but the photo: no official link, kind or purchase links on an entry", () => {
    const [out] = withPhotos([entry("a")], MEDIA);
    expect(out!.mouse).not.toHaveProperty("officialUrl");
    expect(out!.mouse).not.toHaveProperty("officialKind");
    expect(out!.mouse).not.toHaveProperty("purchaseLinks");
  });

  it("treats a file that is not valid as no data, and never reads the prototype", () => {
    const [out] = withPhotos([entry("constructor")], { constructor: "oops" });
    expect(out!.mouse.imageUrl).toBeNull();
    const [proto] = withPhotos([entry("toString")], {});
    expect(proto!.mouse.imageUrl).toBeNull();
    expect(withPhotos([entry("a")], null)[0]!.mouse.imageUrl).toBeNull();
  });

  it("changes no score, rank, order or other field, and does not mutate its input", () => {
    const input = [entry("a", 1), entry("b", 2)];
    const before = JSON.stringify(input);
    const out = withPhotos(input, MEDIA);
    expect(JSON.stringify(input)).toBe(before);
    expect(out.map((e) => e.mouse.slug)).toEqual(["a", "b"]);
    expect(out.map((e) => e.rank)).toEqual([1, 2]);
    expect(out[0]!.total).toBe(input[0]!.total);
    expect(out[0]!.subscores).toBe(input[0]!.subscores);
  });
});

describe("loadOwnedFit runs withPhotos", () => {
  // The fixture catalogue's own slugs are not in mouse-media.json, so they would
  // all read "no photo" and prove nothing. Give its two mice real slugs, one
  // with a photo and one without.
  const REAL = "logitech-g502-hero";
  const NO_PHOTO = "fantech-yari-e";
  const catalogue = [
    { ...sampleCatalogue[0]!, slug: REAL },
    { ...sampleCatalogue[1]!, slug: NO_PHOTO },
  ];

  async function fit() {
    const { repo: fitRepo } = createFakeFitRepo(catalogue);
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
    return result.fit;
  }

  it("gives a real mouse its real photo path and a mouse with no photo null", async () => {
    const out = await fit();
    const bySlug = new Map(out.results.map((e) => [e.mouse.slug, e]));
    expect(bySlug.get(REAL)?.mouse.imageUrl).toBe(`/images/mice/${REAL}.webp`);
    expect(bySlug.get(NO_PHOTO)?.mouse.imageUrl).toBeNull();
  });

  it("carries no link field on any result, and passes the contract", async () => {
    const out = await fit();
    expect(out.results.length).toBeGreaterThan(0);
    for (const e of out.results) {
      // The links ride on the static per-mouse route, never on the response.
      expect(JSON.stringify(e)).not.toMatch(
        /officialUrl|officialKind|purchaseLinks/,
      );
    }
    expect(() => fitResponseSchema.parse(out)).not.toThrow();
  });
});

describe("withPhotos parses a given media file once", () => {
  it("answers from the first parse: the same object is not read again", () => {
    const file = {
      a: {
        officialUrl: "https://maker.example/a",
        officialKind: "product",
        image: "/images/mice/a.webp",
      },
    };
    expect(withPhotos([entry("a")], file)[0]!.mouse.imageUrl).toBe(
      "/images/mice/a.webp",
    );
    // Changing the object afterwards changes nothing: it is not parsed a
    // second time (files are not edited at run time; this shows the cache).
    file.a.image = "/images/mice/changed.webp";
    expect(withPhotos([entry("a")], file)[0]!.mouse.imageUrl).toBe(
      "/images/mice/a.webp",
    );
    // A different object is a different file.
    expect(withPhotos([entry("a")], { ...file })[0]!.mouse.imageUrl).toBe(
      "/images/mice/changed.webp",
    );
  });
});

// Hard rule 2: the photo path is display data. The LLM never sees it, and
// nothing in it becomes an allowed numeral.
describe("the photo path never reaches the analysis", () => {
  function plainAndRich() {
    const results = [1, 2, 3, 4].map((rank) =>
      entry(`m-${rank}`, rank, { model: `M${rank}` }),
    );
    const plain = makeFit({ results });
    const rich = makeFit({
      results: results.map((e) => ({
        ...e,
        mouse: { ...e.mouse, imageUrl: "/images/mice/uniq-photo-4711.webp" },
      })),
    });
    return { plain, rich };
  }

  it("gives the same analysis input with and without imageUrl", () => {
    const { plain, rich } = plainAndRich();
    expect(() => fitResponseSchema.parse(rich)).not.toThrow();
    const m = makeMeasurements();
    const a = buildAnalysisInput(plain, m, "en");
    const b = buildAnalysisInput(rich, m, "en");
    expect(b).toEqual(a);
    const json = JSON.stringify(b);
    for (const word of [
      "imageUrl",
      "officialUrl",
      "officialKind",
      "purchaseLinks",
      "uniq-photo",
      "/images/mice",
    ]) {
      expect(json).not.toContain(word);
    }
    for (const top of b.topPicks) {
      for (const key of [
        "imageUrl",
        "officialUrl",
        "officialKind",
        "purchaseLinks",
      ]) {
        expect(top).not.toHaveProperty(key);
      }
    }
  });

  it("no digit in a photo name enters the numeral allow-list", () => {
    const { plain, rich } = plainAndRich();
    const m = makeMeasurements();
    const allowed = collectNumbers(buildAnalysisInput(rich, m, "en"));
    expect(allowed.has(4711)).toBe(false);
    expect([...allowed].sort()).toEqual(
      [...collectNumbers(buildAnalysisInput(plain, m, "en"))].sort(),
    );
  });
});
