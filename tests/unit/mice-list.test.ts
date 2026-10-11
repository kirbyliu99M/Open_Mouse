import { describe, expect, it } from "vitest";
import type {
  Connectivity,
  FormFactor,
  Shape,
  Size,
} from "../../src/lib/contracts/descriptors";
import { handSizeOf } from "../../src/lib/fit/handType";
import {
  EXCLUDED_FORM_FACTORS,
  MAX_SEARCH_LENGTH,
  MICE_PAGE_SIZE,
  SEARCH_PARAM,
  compareMice,
  filterMice,
  formatGrams,
  formatMm,
  matchesSearch,
  mergeSearchParam,
  nextShownCount,
  normalizeSearch,
  parseSearchParam,
  searchMice,
  sortMice,
  toFilterEntry,
  toFilterSource,
  toMiceListRow,
  visibleMice,
  withoutExcludedFormFactors,
  type MiceListRow,
  type MiceListSource,
} from "../../src/lib/mice/list";
import {
  brandOrder,
  emptyFilters,
  facetCounts,
  matchCount,
  mergeFilterParams,
  nullCounts,
  parseFilters,
  sizeGroupOf,
  toggleOption,
  weightBandOf,
  type Filters,
} from "../../src/lib/results/filters";

function source(over: Partial<MiceListSource> = {}): MiceListSource {
  return {
    slug: "logitech-g-pro-2",
    brand: "Logitech",
    model: "G Pro 2 Lightspeed",
    size: "medium",
    shape: "symmetrical",
    connectivity: "wireless",
    lengthMm: 125,
    widthMm: 63.5,
    heightMm: 40,
    weightG: 80,
    ...over,
  };
}

function row(over: Partial<MiceListSource> = {}): MiceListRow {
  return toMiceListRow(source(over));
}

function pick(...groups: [keyof Filters, string][]): Filters {
  return groups.reduce<Filters>(
    (f, [g, v]) => toggleOption(f, g as never, v),
    emptyFilters(),
  );
}

describe("toMiceListRow", () => {
  it("keeps the display fields and nothing else, even when the source has more", () => {
    const withExtras = {
      ...source(),
      sourceUrl: "https://example.com/spec",
      dataSource: "first_party",
      humpPlacement: "mid",
      frontFlare: "narrow",
      sideCurvature: "straight",
      thumbRest: true,
      ringFingerRest: false,
      handCompatibility: "right_only",
      imagePath: "/images/mice/x.png",
      id: "uuid",
    } as MiceListSource;
    const out = toMiceListRow(withExtras);
    expect(Object.keys(out).sort()).toEqual(
      [
        "slug",
        "brand",
        "model",
        "size",
        "shape",
        "connectivity",
        "lengthMm",
        "widthMm",
        "heightMm",
        "weightG",
      ].sort(),
    );
    expect(JSON.stringify(out)).not.toMatch(
      /sourceUrl|dataSource|hump|flare|curvature|thumb|ring|handCompat|image|uuid/i,
    );
  });

  it("counts fingertip as small, with the function the results filter uses", () => {
    expect(row({ size: "fingertip" }).size).toBe("small");
    for (const size of ["fingertip", "small", "medium", "large"] as Size[]) {
      expect(row({ size }).size).toBe(handSizeOf(size));
    }
  });

  it("turns an unknown value into null, never a guess", () => {
    const r = row({
      shape: undefined as never,
      connectivity: undefined as never,
      weightG: undefined as never,
    });
    expect(r.shape).toBeNull();
    expect(r.connectivity).toBeNull();
    expect(r.weightG).toBeNull();
  });
});

describe("order: brand, then model", () => {
  it("sorts by brand then model, digits as numbers, case ignored", () => {
    const rows = [
      row({ slug: "a3", brand: "Razer", model: "Viper V3 Pro" }),
      row({ slug: "a2", brand: "logitech", model: "G Pro 10" }),
      row({ slug: "a1", brand: "Logitech", model: "G Pro 2" }),
      row({ slug: "a0", brand: "Logitech", model: "G Pro X" }),
    ];
    expect(sortMice(rows).map((r) => r.slug)).toEqual(["a1", "a2", "a0", "a3"]);
  });

  it("does not change its input, and a full tie falls back to the slug", () => {
    const rows = [row({ slug: "b" }), row({ slug: "a" })];
    const before = rows.map((r) => r.slug);
    expect(sortMice(rows).map((r) => r.slug)).toEqual(["a", "b"]);
    expect(rows.map((r) => r.slug)).toEqual(before);
    expect(compareMice(rows[0]!, rows[0]!)).toBe(0);
  });
});

describe("search", () => {
  it("ignores case and every kind of white space", () => {
    expect(normalizeSearch("  G  PRO\tx ")).toBe("gprox");
    expect(normalizeSearch("Ｇ Ｐro")).toBe("gpro");
    const r = row();
    for (const q of ["g pro", "GPRO", "  logitech  ", "lightspeed", "ogitechg"])
      expect(matchesSearch(r, q), q).toBe(true);
    expect(matchesSearch(r, "razer")).toBe(false);
  });

  it("matches the brand and the model, and an empty search matches all", () => {
    const rows = [
      row({ slug: "1", brand: "Razer", model: "DeathAdder V3" }),
      row({ slug: "2", brand: "Logitech", model: "G502 X" }),
    ];
    expect(searchMice(rows, "razer").map((r) => r.slug)).toEqual(["1"]);
    expect(searchMice(rows, "g502").map((r) => r.slug)).toEqual(["2"]);
    expect(searchMice(rows, "death adder").map((r) => r.slug)).toEqual(["1"]);
    expect(searchMice(rows, "   ")).toHaveLength(2);
    expect(searchMice(rows, "")).toHaveLength(2);
    expect(searchMice(rows, "nothing")).toHaveLength(0);
  });
});

describe("the filter is the results page's: same bands, same size groups, same null rule", () => {
  const rows = [
    row({ slug: "w49", weightG: 49.9 }),
    row({ slug: "w50", weightG: 50 }),
    row({ slug: "w69", weightG: 69.9 }),
    row({ slug: "w70", weightG: 70 }),
    row({ slug: "w89", weightG: 89.9 }),
    row({ slug: "w90", weightG: 90 }),
    row({ slug: "wnull", weightG: null }),
  ];

  it("applies the half-open weight bands (50 g is in 50-69, 90 g is in 90 and up)", () => {
    const slugs = (band: string) =>
      filterMice(rows, pick(["weight", band])).map((r) => r.slug);
    expect(slugs("lt50")).toEqual(["w49"]);
    expect(slugs("50-69")).toEqual(["w50", "w69"]);
    expect(slugs("70-89")).toEqual(["w70", "w89"]);
    expect(slugs("gte90")).toEqual(["w90"]);
    // The bands are the results page's function, not a copy.
    for (const r of rows)
      expect(weightBandOf(r.weightG) === null).toBe(r.slug === "wnull");
  });

  it("never matches a mouse with no weight to a weight band, and counts it as missing", () => {
    const f = pick(["weight", "lt50"], ["weight", "gte90"]);
    expect(filterMice(rows, f).map((r) => r.slug)).toEqual(["w49", "w90"]);
    expect(nullCounts(toFilterSource(rows), f).weight).toBe(1);
  });

  it("is OR inside a group and AND across groups, and with no filter keeps everything", () => {
    const set = [
      row({
        slug: "a",
        brand: "Razer",
        shape: "ergonomic",
        connectivity: "wired",
      }),
      row({
        slug: "b",
        brand: "Razer",
        shape: "symmetrical",
        connectivity: "wireless",
      }),
      row({
        slug: "c",
        brand: "Pulsar",
        shape: "symmetrical",
        connectivity: "wireless",
      }),
      row({ slug: "d", brand: "Zowie", shape: "hybrid", connectivity: null }),
    ];
    expect(filterMice(set, emptyFilters())).toHaveLength(4);
    expect(
      filterMice(set, pick(["brand", "Razer"], ["brand", "Pulsar"])).map(
        (r) => r.slug,
      ),
    ).toEqual(["a", "b", "c"]);
    expect(
      filterMice(
        set,
        pick(["brand", "Razer"], ["connectivity", "wireless"]),
      ).map((r) => r.slug),
    ).toEqual(["b"]);
    expect(
      filterMice(set, pick(["shape", "symmetrical"])).map((r) => r.slug),
    ).toEqual(["b", "c"]);
    // A hybrid shape has a value but no option: it leaves when a shape is chosen.
    expect(
      filterMice(
        set,
        pick(["shape", "ergonomic"], ["shape", "symmetrical"]),
      ).map((r) => r.slug),
    ).toEqual(["a", "b", "c"]);
    // A null connection never matches a connection option.
    expect(
      filterMice(
        set,
        pick(["connectivity", "wired"], ["connectivity", "wireless"]),
      ).map((r) => r.slug),
    ).toEqual(["a", "b", "c"]);
  });

  it("puts a mouse in the size group the results filter puts it in", () => {
    for (const size of ["fingertip", "small", "medium", "large"] as Size[]) {
      const r = row({ size });
      expect(sizeGroupOf(toFilterEntry(r))).toBe(handSizeOf(size));
    }
    const set = (["fingertip", "small", "medium", "large"] as Size[]).map(
      (size) => row({ slug: size, size }),
    );
    expect(filterMice(set, pick(["size", "small"])).map((r) => r.slug)).toEqual(
      ["fingertip", "small"],
    );
  });

  it("builds a source whose counts and brand order come from the same functions as the results page", () => {
    const set = [
      row({ slug: "1", brand: "Zowie" }),
      row({ slug: "2", brand: "Logitech" }),
      row({ slug: "3", brand: "Logitech" }),
      row({ slug: "4", brand: "Finalmouse" }),
    ];
    const src = toFilterSource(set);
    expect(brandOrder(src)).toEqual({
      featured: ["Logitech"],
      rest: ["Finalmouse", "Zowie"],
    });
    const counts = facetCounts(src, emptyFilters());
    expect(counts.brand.featured.map((o) => [o.value, o.count])).toEqual([
      ["Logitech", 2],
    ]);
    expect(src.handType).toBeUndefined();
    expect(matchCount(src, pick(["brand", "Logitech"]))).toBe(2);
    // No hand type: nothing is marked 「Fits you」.
    expect(src.results).toHaveLength(4);
  });

  it("applies the search and the filters together", () => {
    const set = [
      row({ slug: "1", brand: "Razer", model: "Viper", connectivity: "wired" }),
      row({
        slug: "2",
        brand: "Razer",
        model: "DeathAdder",
        connectivity: "wired",
      }),
      row({
        slug: "3",
        brand: "Pulsar",
        model: "Viper Mini",
        connectivity: "wireless",
      }),
    ];
    expect(
      visibleMice(set, pick(["connectivity", "wired"]), "viper").map(
        (r) => r.slug,
      ),
    ).toEqual(["1"]);
    expect(
      visibleMice(set, emptyFilters(), "viper").map((r) => r.slug),
    ).toEqual(["1", "3"]);
    expect(visibleMice(set, emptyFilters(), "").map((r) => r.slug)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});

describe("Show more", () => {
  it("adds one batch of 50 rows at a time and stops at the total", () => {
    expect(MICE_PAGE_SIZE).toBe(50);
    expect(nextShownCount(50, 406)).toBe(100);
    expect(nextShownCount(100, 406)).toBe(150);
    expect(nextShownCount(400, 406)).toBe(406);
    expect(nextShownCount(50, 60)).toBe(60);
    expect(nextShownCount(0, 0)).toBe(0);
  });
});

describe("numbers as the page writes them", () => {
  it("shows at most one decimal and no trailing zero", () => {
    expect(formatMm(125)).toBe("125");
    expect(formatMm(63.5)).toBe("63.5");
    expect(formatMm(63.50000001)).toBe("63.5");
    expect(formatMm(40.04)).toBe("40");
    expect(formatGrams(80)).toBe("80");
    expect(formatGrams(60.5)).toBe("60.5");
  });

  it("gives null for a value that is not a number", () => {
    expect(formatMm(null)).toBeNull();
    expect(formatGrams(Number.NaN)).toBeNull();
    expect(formatGrams(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("the address", () => {
  it("reads and writes the search without touching the filter parameters", () => {
    expect(SEARCH_PARAM).toBe("q");
    expect(parseSearchParam("?q=g%20pro&conn=wired")).toBe("g pro");
    expect(parseSearchParam("conn=wired")).toBe("");
    expect(parseSearchParam(new URLSearchParams("q=razer"))).toBe("razer");
    expect(parseSearchParam(`q=${"x".repeat(200)}`)).toHaveLength(
      MAX_SEARCH_LENGTH,
    );
    expect(mergeSearchParam("?conn=wired", "viper")).toBe("conn=wired&q=viper");
    expect(mergeSearchParam("conn=wired&q=old", "new")).toBe(
      "conn=wired&q=new",
    );
    expect(mergeSearchParam("conn=wired&q=old", "   ")).toBe("conn=wired");
    expect(mergeSearchParam("", "")).toBe("");
  });

  it("keeps the search when the filter changes (the results page's merge keeps other parameters)", () => {
    const f = pick(["connectivity", "wired"]);
    expect(mergeFilterParams("q=viper", f)).toBe("q=viper&conn=wired");
    expect(
      parseFilters("q=viper&conn=wired&brand=Razer", { knownBrands: ["Razer"] })
        .connectivity,
    ).toEqual(["wired"]);
  });
});

describe("types", () => {
  it("a row's shape and connection are the contract's values", () => {
    const shapes: Shape[] = ["symmetrical", "ergonomic", "hybrid"];
    const conns: Connectivity[] = ["wired", "wireless"];
    for (const shape of shapes)
      for (const connectivity of conns)
        expect(row({ shape, connectivity })).toMatchObject({
          shape,
          connectivity,
        });
  });
});

describe("the temporary exclusion of vertical mice and trackballs (Kirby 2026-10-12)", () => {
  const form = (slug: string, formFactor: FormFactor) => ({
    ...row({ slug, shape: "ergonomic" }),
    formFactor,
  });
  const set = [
    form("a", "standard"),
    form("v", "vertical"),
    form("t", "trackball"),
    form("b", "standard"),
  ];

  it("excludes exactly the vertical and trackball form factors", () => {
    expect([...EXCLUDED_FORM_FACTORS].sort()).toEqual([
      "trackball",
      "vertical",
    ]);
  });

  it("drops them from the list and keeps the order of the rest", () => {
    expect(withoutExcludedFormFactors(set).map((r) => r.slug)).toEqual([
      "a",
      "b",
    ]);
  });

  it("the count, the search and the option counts follow the rows that are left", () => {
    const kept = withoutExcludedFormFactors(set);
    expect(visibleMice(kept, emptyFilters(), "").length).toBe(2);
    expect(matchCount(toFilterSource(kept), emptyFilters())).toBe(2);
    const shapes = facetCounts(toFilterSource(kept), emptyFilters()).shape;
    expect(shapes.map((o) => [o.value, o.count])).toEqual([
      ["ergonomic", 2],
      ["symmetrical", 0],
    ]);
    // With them left in, the same calls count 4 and 4 (that is what the exclusion changes).
    expect(visibleMice(set, emptyFilters(), "").length).toBe(4);
    // A search for an excluded mouse's slug-like name finds nothing once it is gone.
    const named = [
      { ...form("v", "vertical"), model: "MX Vertical" },
      { ...form("s", "standard"), model: "G305" },
    ];
    expect(
      visibleMice(
        withoutExcludedFormFactors(named),
        emptyFilters(),
        "vertical",
      ),
    ).toEqual([]);
  });

  it("takes nothing out when the list of excluded form factors is empty (removing the constant brings them back)", () => {
    expect(withoutExcludedFormFactors(set, []).map((r) => r.slug)).toEqual([
      "a",
      "v",
      "t",
      "b",
    ]);
  });
});
