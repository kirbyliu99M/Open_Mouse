import { describe, expect, it } from "vitest";
import type { Shape, Size } from "../../src/lib/contracts/descriptors";
import type { FitEntry, FitResponse } from "../../src/lib/contracts/fit";
import { classifyHandType, handSizeOf } from "../../src/lib/fit/handType";
import {
  clearGroup,
  closeSheet,
  editDraft,
  emptyFilters,
  facetCounts,
  filteredView,
  mergeFilterParams,
  nullCounts,
  openSheet,
  parseFilters,
  resolveViewDetail,
  selectedCount,
  serializeFilters,
  sizeGroupOf,
  suggestRelaxation,
  suitableSize,
  toggleOption,
  viewOtherPicks,
  weightBandOf,
  type Filters,
} from "../../src/lib/results/filters";
import { computeSize } from "../../src/server/catalogue/size";
import { makeEntry, makeFit } from "./analysis-fixtures";

interface Spec {
  slug: string;
  brand?: string;
  size?: Size;
  weightG?: number | null;
  shape?: Shape | null;
  connectivity?: "wired" | "wireless" | null;
  variants?: {
    slug: string;
    weightG: number | null;
    connectivity?: "wired" | "wireless" | null;
  }[];
}

/** Ranked in the order given: the first spec is rank 1. */
function fit(specs: Spec[], over: Partial<FitResponse> = {}): FitResponse {
  const results: FitEntry[] = specs.map((s, i) => {
    const base = makeEntry();
    return {
      ...base,
      rank: i + 1,
      total: 90 - i,
      mouse: {
        ...base.mouse,
        slug: s.slug,
        brand: s.brand ?? "Acme",
        model: s.slug.toUpperCase(),
        size: s.size ?? "medium",
        weightG: s.weightG === undefined ? 60 : s.weightG,
        shape: s.shape === undefined ? "ergonomic" : s.shape,
        connectivity:
          s.connectivity === undefined ? "wireless" : s.connectivity,
      },
      ...(s.variants
        ? {
            variants: s.variants.map((v) => ({
              slug: v.slug,
              model: v.slug.toUpperCase(),
              weightG: v.weightG,
              ...(v.connectivity !== undefined
                ? { connectivity: v.connectivity }
                : {}),
            })),
          }
        : {}),
    };
  });
  return makeFit({ results, excluded: [], ...over });
}

const f = (patch: Partial<Filters>): Filters => ({
  ...emptyFilters(),
  ...patch,
});

const slugs = (cards: { entry: FitEntry }[]) =>
  cards.map((c) => c.entry.mouse.slug);

// Six cards over brands, sizes, weights, shapes and connectivity.
const CATALOGUE = fit([
  {
    slug: "m1",
    brand: "Razer",
    size: "medium",
    weightG: 55,
    shape: "ergonomic",
    connectivity: "wireless",
  },
  {
    slug: "m2",
    brand: "Logitech",
    size: "small",
    weightG: 49,
    shape: "symmetrical",
    connectivity: "wired",
  },
  {
    slug: "m3",
    brand: "Razer",
    size: "large",
    weightG: 95,
    shape: "ergonomic",
    connectivity: "wired",
  },
  {
    slug: "m4",
    brand: "Zowie",
    size: "fingertip",
    weightG: 70,
    shape: "hybrid",
    connectivity: "wireless",
  },
  {
    slug: "m5",
    brand: "Razer",
    size: "medium",
    weightG: null,
    shape: null,
    connectivity: null,
  },
  {
    slug: "m6",
    brand: "Cooler Master",
    size: "small",
    weightG: 89.9,
    shape: "symmetrical",
    connectivity: "wireless",
  },
]);

describe("weight bands are half-open", () => {
  it.each([
    [null, null],
    [30, "lt50"],
    [49.99, "lt50"],
    [50, "50-69"],
    [69.9, "50-69"],
    [70, "70-89"],
    [89.99, "70-89"],
    [90, "gte90"],
    [140, "gte90"],
  ] as const)("%s g -> %s", (g, band) => {
    expect(weightBandOf(g)).toBe(band);
  });
});

describe("parseFilters / serializeFilters", () => {
  it("round-trips and keeps the order the groups were added in", () => {
    const filters = parseFilters(
      "?weight=70-89&brand=Razer&brand=Logitech&conn=wireless&grip=ergonomic&size=small&size=large",
    );
    expect(filters.brand).toEqual(["Razer", "Logitech"]);
    expect(filters.size).toEqual(["small", "large"]);
    expect(filters.order).toEqual([
      "weight",
      "brand",
      "connectivity",
      "shape",
      "size",
    ]);
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
  });

  it("ignores unknown parameters, unknown values and duplicates", () => {
    const filters = parseFilters(
      "utm_source=x&size=huge&size=small&size=small&weight=heavy&conn=wifi&grip=other&brand=",
    );
    expect(filters).toEqual({
      ...emptyFilters(),
      size: ["small"],
      order: ["size"],
    });
  });

  it("ignores a brand the response does not have when told the known ones", () => {
    const filters = parseFilters("brand=Razer&brand=Nope", {
      knownBrands: ["Razer", "Logitech"],
    });
    expect(filters.brand).toEqual(["Razer"]);
  });

  it("no query means no filter, and serializes to the empty string", () => {
    expect(parseFilters("")).toEqual(emptyFilters());
    expect(parseFilters(new URLSearchParams())).toEqual(emptyFilters());
    expect(serializeFilters(emptyFilters())).toBe("");
  });

  it("keeps other parameters when it replaces its own", () => {
    const next = mergeFilterParams(
      "?utm=1&size=small&brand=Razer",
      f({ connectivity: ["wired"], order: ["connectivity"] }),
    );
    const params = new URLSearchParams(next);
    expect(params.get("utm")).toBe("1");
    expect(params.getAll("conn")).toEqual(["wired"]);
    expect(params.has("size")).toBe(false);
    expect(params.has("brand")).toBe(false);
  });
});

describe("toggleOption and order", () => {
  it("adds a group last and drops an emptied one", () => {
    let x = toggleOption(emptyFilters(), "size", "small");
    x = toggleOption(x, "brand", "Razer");
    x = toggleOption(x, "size", "large");
    expect(x.order).toEqual(["size", "brand"]);
    x = toggleOption(x, "size", "small");
    x = toggleOption(x, "size", "large");
    expect(x.order).toEqual(["brand"]);
    expect(selectedCount(x)).toBe(1);
    expect(clearGroup(x, "brand")).toEqual(emptyFilters());
  });
});

describe("filteredView: OR inside a group, AND across groups", () => {
  it("OR inside a group", () => {
    const v = filteredView(
      CATALOGUE,
      f({ brand: ["Logitech", "Zowie"], order: ["brand"] }),
    );
    expect(slugs(v.cards)).toEqual(["m2", "m4"]);
  });

  it("AND across groups", () => {
    const v = filteredView(
      CATALOGUE,
      f({
        brand: ["Razer"],
        connectivity: ["wired"],
        order: ["brand", "connectivity"],
      }),
    );
    expect(slugs(v.cards)).toEqual(["m3"]);
  });

  it("no filter is the response as it is", () => {
    const v = filteredView(CATALOGUE, emptyFilters());
    expect(v.active).toBe(false);
    expect(v.count).toBe(6);
    expect(v.cards.map((c) => c.displayRank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(v.swapped).toBe(false);
    expect(v.picks.map((c) => c.displayRank)).toEqual([2, 3, 4, 5]);
    expect(v.rest.map((c) => c.displayRank)).toEqual([6]);
  });

  it("a mouse without a value never matches that group", () => {
    const wired = filteredView(
      CATALOGUE,
      f({ connectivity: ["wired", "wireless"], order: ["connectivity"] }),
    );
    expect(slugs(wired.cards)).not.toContain("m5");
    const weight = filteredView(
      CATALOGUE,
      f({
        weight: ["lt50", "50-69", "70-89", "gte90"],
        order: ["weight"],
      }),
    );
    expect(slugs(weight.cards)).not.toContain("m5");
    const shape = filteredView(
      CATALOGUE,
      f({ shape: ["ergonomic", "symmetrical"], order: ["shape"] }),
    );
    // A null shape and a hybrid have no option, so neither is kept.
    expect(slugs(shape.cards)).toEqual(["m1", "m2", "m3", "m6"]);
  });
});

describe("filteredView: renumbering and the large card", () => {
  it("renumbers 1..n and keeps the overall rank apart", () => {
    const v = filteredView(
      CATALOGUE,
      f({ brand: ["Razer"], order: ["brand"] }),
    );
    expect(
      v.cards.map((c) => [c.entry.mouse.slug, c.displayRank, c.overallRank]),
    ).toEqual([
      ["m1", 1, 1],
      ["m3", 2, 3],
      ["m5", 3, 5],
    ]);
    // entry.rank is untouched.
    expect(v.cards[2]!.entry.rank).toBe(5);
  });

  it("the filtered #1 takes the large card when the overall #1 is filtered out", () => {
    const v = filteredView(
      CATALOGUE,
      f({
        brand: ["Logitech", "Razer"],
        size: ["small", "large"],
        order: ["brand", "size"],
      }),
    );
    expect(v.large!.entry.mouse.slug).toBe("m2");
    expect(v.large!.displayRank).toBe(1);
    expect(v.large!.overallRank).toBe(2);
    expect(v.swapped).toBe(true);
    expect(v.overallTop!.mouse.slug).toBe("m1");
  });

  it("when the overall #1 still matches nothing changes: not swapped", () => {
    const v = filteredView(
      CATALOGUE,
      f({ brand: ["Razer"], order: ["brand"] }),
    );
    expect(v.large!.entry.mouse.slug).toBe("m1");
    expect(v.swapped).toBe(false);
  });

  it("the other picks are the filtered #2 to #5, the rest 6 onward", () => {
    const many = fit(
      Array.from({ length: 9 }, (_, i) => ({
        slug: `x${i + 1}`,
        brand: i === 0 ? "Other" : "Razer",
      })),
    );
    const v = filteredView(many, f({ brand: ["Razer"], order: ["brand"] }));
    expect(v.count).toBe(8);
    expect(v.large!.entry.mouse.slug).toBe("x2");
    expect(v.picks.map((c) => c.displayRank)).toEqual([2, 3, 4, 5]);
    expect(v.rest.map((c) => c.displayRank)).toEqual([6, 7, 8]);
    expect(viewOtherPicks(v, 3).map((c) => c.displayRank)).toEqual([
      1, 2, 4, 5,
    ]);
  });

  it("excluded mice are hidden while filtering, with a count for the note", () => {
    const withExcluded = fit([{ slug: "a" }, { slug: "b" }], {
      excluded: [
        { slug: "e1", brand: "X", model: "E1", reason: "wrong_hand" },
        { slug: "e2", brand: "X", model: "E2", reason: "wrong_hand" },
      ],
    });
    const off = filteredView(withExcluded, emptyFilters());
    expect(off.excluded).toHaveLength(2);
    expect(off.hiddenExcludedCount).toBe(0);
    const on = filteredView(
      withExcluded,
      f({ brand: ["Acme"], order: ["brand"] }),
    );
    expect(on.excluded).toEqual([]);
    expect(on.hiddenExcludedCount).toBe(2);
  });

  it("an empty result has no large card", () => {
    const v = filteredView(
      CATALOGUE,
      f({ brand: ["Logitech"], size: ["large"], order: ["brand", "size"] }),
    );
    expect(v.count).toBe(0);
    expect(v.large).toBeNull();
    expect(v.picks).toEqual([]);
  });
});

describe("detail pages under a filter (B1)", () => {
  const many = fit([
    { slug: "o1", brand: "Other" },
    { slug: "o2", brand: "Other" },
    { slug: "o3", brand: "Other" },
    { slug: "o4", brand: "Other" },
    { slug: "o5", brand: "Other" },
    { slug: "o6", brand: "Other" },
    { slug: "r7", brand: "Razer" },
    { slug: "r8", brand: "Razer" },
    { slug: "r9", brand: "Razer" },
  ]);

  it("a mouse that is overall #8 opens its detail page when it is the filtered #2", () => {
    const view = filteredView(many, f({ brand: ["Razer"], order: ["brand"] }));
    const target = resolveViewDetail(view, "r8");
    expect(target.kind).toBe("detail");
    if (target.kind === "detail") {
      expect(target.card.displayRank).toBe(2);
      expect(target.card.overallRank).toBe(8);
    }
  });

  it("the filtered #1, a mouse that does not match and an unknown slug go to the main page", () => {
    const view = filteredView(many, f({ brand: ["Razer"], order: ["brand"] }));
    expect(resolveViewDetail(view, "r7")).toEqual({ kind: "main" });
    expect(resolveViewDetail(view, "o2")).toEqual({ kind: "main" });
    expect(resolveViewDetail(view, "nope")).toEqual({ kind: "main" });
  });

  it("with no filter it is the old rule: ranks 2 to 5 only, rank 1 and 6+ redirect", () => {
    const view = filteredView(many, emptyFilters());
    for (const s of ["o2", "o3", "o4", "o5"])
      expect(resolveViewDetail(view, s).kind).toBe("detail");
    for (const s of ["o1", "o6", "r9"])
      expect(resolveViewDetail(view, s)).toEqual({ kind: "main" });
  });
});

describe("facetCounts", () => {
  it("counts each option with the other groups' choices plus that option", () => {
    const filters = f({ brand: ["Razer"], order: ["brand"] });
    const c = facetCounts(CATALOGUE, filters);
    // Razer cards: m1 (medium, wireless), m3 (large, wired), m5 (medium, null).
    expect(c.size.map((o) => [o.value, o.count])).toEqual([
      ["small", 0],
      ["medium", 2],
      ["large", 1],
    ]);
    expect(c.connectivity.map((o) => [o.value, o.count])).toEqual([
      ["wireless", 1],
      ["wired", 1],
    ]);
    // A group's own choice does not narrow its own counts: Logitech gives 1.
    const logitech = [...c.brand.featured, ...c.brand.rest].find(
      (o) => o.value === "Logitech",
    )!;
    expect(logitech.count).toBe(1);
  });

  it("disables an option with nothing left, but never a chosen one", () => {
    const filters = f({
      brand: ["Logitech"],
      size: ["large"],
      order: ["brand", "size"],
    });
    const c = facetCounts(CATALOGUE, filters);
    const large = c.size.find((o) => o.value === "large")!;
    expect(large.selected).toBe(true);
    expect(large.disabled).toBe(false);
    expect(large.count).toBe(1 - 1); // Logitech has no large mouse
    const medium = c.size.find((o) => o.value === "medium")!;
    expect(medium.disabled).toBe(true);
    const small = c.size.find((o) => o.value === "small")!;
    expect(small.disabled).toBe(false);
  });

  it("puts the five featured brands first in their order, the rest by count then name", () => {
    const specs: Spec[] = [
      { slug: "a", brand: "Pulsar" },
      { slug: "b", brand: "Zowie" },
      { slug: "c", brand: "Zowie" },
      { slug: "d", brand: "Razer" },
      { slug: "e", brand: "Logitech" },
      { slug: "f", brand: "Alpha" },
      { slug: "g", brand: "Beta" },
      { slug: "h", brand: "Beta" },
      { slug: "i", brand: "Corsair" },
    ];
    const c = facetCounts(fit(specs), emptyFilters());
    expect(c.brand.featured.map((o) => o.value)).toEqual([
      "Logitech",
      "Razer",
      "Corsair",
      "Pulsar",
    ]);
    expect(c.brand.rest.map((o) => o.value)).toEqual([
      "Beta",
      "Zowie",
      "Alpha",
    ]);
  });

  it("a card counts once however many members match (per card)", () => {
    const shell = fit([
      {
        slug: "s1",
        weightG: 60,
        connectivity: "wireless",
        variants: [
          { slug: "s1b", weightG: 62, connectivity: "wireless" },
          { slug: "s1c", weightG: 64, connectivity: "wired" },
        ],
      },
    ]);
    const c = facetCounts(shell, emptyFilters());
    expect(c.weight.find((o) => o.value === "50-69")!.count).toBe(1);
    expect(c.connectivity.find((o) => o.value === "wireless")!.count).toBe(1);
    expect(c.connectivity.find((o) => o.value === "wired")!.count).toBe(1);
  });
});

describe("B2: size comes from mouse.size, not from the length", () => {
  it("groups by mouse.size and counts fingertip as small", () => {
    const r = fit([
      { slug: "a", size: "fingertip" },
      { slug: "b", size: "small" },
      { slug: "c", size: "large" },
    ]);
    // A length that would say otherwise: the size field wins.
    r.results[2]!.mouse.lengthMm = 100;
    const v = filteredView(r, f({ size: ["small"], order: ["size"] }));
    expect(slugs(v.cards)).toEqual(["a", "b"]);
    expect(sizeGroupOf(r.results[0]!)).toBe("small");
    expect(sizeGroupOf(r.results[2]!)).toBe("large");
  });

  it("適合你 and the grouping come from the same function (handSizeOf)", () => {
    // The hand type's size is `handSizeOf(computeSize(targets))` and a card's
    // size group is `handSizeOf(mouse.size)`: the mouse the size rule would
    // put at a target's dimensions is in the group the hand type names.
    const stats = { widthToLengthSplit: 0.5 };
    for (const lengthMm of [95, 105, 112, 118, 121, 126, 133, 140]) {
      for (const gripWidthMm of [55, 62, 68, 74]) {
        const targets = { lengthMm, gripWidthMm, heightMm: 38 };
        const hand = classifyHandType(targets, "claw", stats);
        const mouseSize = computeSize({
          lengthMm,
          widthMm: gripWidthMm,
          heightMm: 38,
        });
        expect(hand.size).toBe(handSizeOf(mouseSize));
        const card = fit([{ slug: "x", size: mouseSize }]).results[0]!;
        expect(sizeGroupOf(card)).toBe(hand.size);
      }
    }
  });

  it("suitableSize reads the hand type; none for no hand type or a left hand", () => {
    const base = fit([{ slug: "a" }]);
    expect(suitableSize(base)).toBeNull();
    const typed = {
      ...base,
      handType: { size: "medium", grip: "claw", width: "wide" },
    } as FitResponse;
    expect(suitableSize(typed)).toBe("medium");
    expect(suitableSize({ ...typed, hand: "left" })).toBeNull();
  });
});

describe("B3: same-shell cards match on any member", () => {
  const shell = fit([
    {
      slug: "head",
      weightG: 60,
      connectivity: "wired",
      variants: [
        { slug: "alt-wireless", weightG: 75, connectivity: "wireless" },
        { slug: "alt-wired", weightG: 61, connectivity: "wired" },
      ],
    },
    { slug: "solo", weightG: 80, connectivity: "wired" },
  ]);

  it("a card stays when a variant matches, and names the matching member", () => {
    const v = filteredView(
      shell,
      f({ connectivity: ["wireless"], order: ["connectivity"] }),
    );
    expect(slugs(v.cards)).toEqual(["head"]);
    expect(v.cards[0]!.headMatches).toBe(false);
    expect(v.cards[0]!.variants.map((x) => x.slug)).toEqual(["alt-wireless"]);
  });

  it("weight matches any member too", () => {
    const v = filteredView(shell, f({ weight: ["70-89"], order: ["weight"] }));
    expect(slugs(v.cards)).toEqual(["head", "solo"]);
    expect(v.cards[0]!.variants.map((x) => x.slug)).toEqual(["alt-wireless"]);
  });

  it("one member has to satisfy both weight and connectivity", () => {
    const v = filteredView(
      shell,
      f({
        weight: ["50-69"],
        connectivity: ["wireless"],
        order: ["weight", "connectivity"],
      }),
    );
    // head is wired and light; the wireless one is heavy: no single member does both.
    expect(v.count).toBe(0);
  });

  it("with no weight or connectivity choice, the card lists every variant", () => {
    const v = filteredView(shell, f({ brand: ["Acme"], order: ["brand"] }));
    expect(v.cards[0]!.variants).toHaveLength(2);
    expect(v.cards[0]!.headMatches).toBe(true);
  });

  it("a variant whose connectivity was not filled counts as not known", () => {
    const old = fit([
      {
        slug: "head",
        connectivity: null,
        variants: [{ slug: "v", weightG: 60 }],
      },
    ]);
    const v = filteredView(
      old,
      f({ connectivity: ["wireless", "wired"], order: ["connectivity"] }),
    );
    expect(v.count).toBe(0);
  });
});

describe("nullCounts", () => {
  it("counts cards that lack the value, only for a group with a choice", () => {
    const filters = f({ weight: ["gte90"], order: ["weight"] });
    expect(nullCounts(CATALOGUE, filters)).toEqual({
      weight: 1, // m5
      shape: 0,
      connectivity: 0,
    });
  });

  it("only counts cards the other groups keep", () => {
    const filters = f({
      weight: ["gte90"],
      brand: ["Logitech"],
      order: ["weight", "brand"],
    });
    expect(nullCounts(CATALOGUE, filters).weight).toBe(0);
  });

  it("a card has weight data when any member has it", () => {
    const r = fit([
      {
        slug: "a",
        weightG: null,
        variants: [{ slug: "b", weightG: 60, connectivity: "wireless" }],
      },
      { slug: "c", weightG: null },
    ]);
    const filters = f({ weight: ["lt50"], order: ["weight"] });
    expect(nullCounts(r, filters).weight).toBe(1);
  });

  it("a hybrid shape is a value without an option, not missing data", () => {
    const filters = f({ shape: ["ergonomic"], order: ["shape"] });
    // m5 has a null shape; m4 is hybrid.
    expect(nullCounts(CATALOGUE, filters).shape).toBe(1);
  });

  it("connectivity missing", () => {
    const filters = f({ connectivity: ["wired"], order: ["connectivity"] });
    expect(nullCounts(CATALOGUE, filters).connectivity).toBe(1);
  });
});

describe("suggestRelaxation", () => {
  it("picks the group whose removal shows the most cards", () => {
    const filters = f({
      brand: ["Razer"],
      size: ["small"],
      order: ["brand", "size"],
    });
    // Razer small: none. Drop brand -> small: m2, m6 (2). Drop size -> Razer: 3.
    expect(suggestRelaxation(CATALOGUE, filters)).toEqual({
      group: "size",
      count: 3,
    });
  });

  it("on a tie the group added last wins, whatever the fixed order says", () => {
    // Logitech has no large mouse. Drop brand -> large (m3: 1); drop size -> Logitech (m2: 1).
    const sizeLast = f({
      brand: ["Logitech"],
      size: ["large"],
      order: ["brand", "size"],
    });
    expect(suggestRelaxation(CATALOGUE, sizeLast)).toEqual({
      group: "size",
      count: 1,
    });
    const brandLast = f({
      brand: ["Logitech"],
      size: ["large"],
      order: ["size", "brand"],
    });
    expect(suggestRelaxation(CATALOGUE, brandLast)).toEqual({
      group: "brand",
      count: 1,
    });
  });

  it("then the fixed group order when the added order cannot decide", () => {
    const filters = f({ brand: ["Logitech"], size: ["large"], order: [] });
    expect(suggestRelaxation(CATALOGUE, filters)!.group).toBe("brand");
  });

  it("is null when removing any single group still leaves nothing", () => {
    const one = fit([{ slug: "a", brand: "A", size: "small", weightG: 40 }]);
    const hopeless = f({
      brand: ["B"],
      size: ["large"],
      weight: ["gte90"],
      order: ["brand", "size", "weight"],
    });
    expect(suggestRelaxation(one, hopeless)).toBeNull();
  });

  it("always names a whole group: removing it gives exactly the count it names", () => {
    const filters = f({
      size: ["small", "medium"],
      brand: ["Cooler Master"],
      weight: ["gte90"],
      order: ["size", "brand", "weight"],
    });
    const r = suggestRelaxation(CATALOGUE, filters)!;
    const view = filteredView(CATALOGUE, clearGroup(filters, r.group));
    expect(view.count).toBe(r.count);
    expect(r.count).toBeGreaterThan(0);
  });
});

describe("the sheet's draft", () => {
  it("apply keeps the draft; closing any other way discards it", () => {
    const applied = f({ brand: ["Razer"], order: ["brand"] });
    let s = openSheet(applied);
    s = editDraft(s, toggleOption(s.draft, "size", "small"));
    expect(selectedCount(s.draft)).toBe(2);
    expect(closeSheet(s, false)).toBe(applied);
    expect(selectedCount(closeSheet(s, true))).toBe(2);
  });
});
