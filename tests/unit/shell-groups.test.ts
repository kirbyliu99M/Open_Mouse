import { describe, expect, it } from "vitest";
import catalogueJson from "../../src/db/seed/catalogue.json";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import seedJson from "../../src/db/seed/logitech.json";
import {
  fitPreferencesSchema,
  type FitEntry,
} from "../../src/lib/contracts/fit";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import {
  buildSeedRows,
  type FactsFile,
  toCatalogueMouse,
} from "../../src/server/catalogue/catalogue-rows";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";
import { listedOnly } from "../../src/server/fit/listed";
import { scoreFit } from "../../src/server/fit/score";
import { groupShells } from "../../src/server/fit/shell-groups";
import type { CatalogueMouse } from "../../src/server/fit/types";
import { makeEntry } from "./analysis-fixtures";

/** A catalogue row with every descriptor set, so a test can change one. */
const base: CatalogueMouse = {
  slug: "a",
  brand: "Acme",
  model: "A",
  lengthMm: 120,
  widthMm: 65,
  heightMm: 40,
  weightG: 80,
  size: "medium",
  handCompatibility: "ambidextrous",
  shape: "symmetrical",
  humpPlacement: "center",
  frontFlare: "flat",
  sideCurvature: "flat",
  thumbRest: true,
  ringFingerRest: false,
};

const row = (
  slug: string,
  over: Partial<CatalogueMouse> = {},
): CatalogueMouse => ({
  ...base,
  slug,
  model: slug.toUpperCase(),
  ...over,
});

const entry = (r: CatalogueMouse, rank: number, total: number): FitEntry => {
  const e = makeEntry();
  return {
    ...e,
    rank,
    total,
    mouse: {
      ...e.mouse,
      slug: r.slug,
      brand: r.brand,
      model: r.model,
      weightG: r.weightG,
    },
  };
};

describe("groupShells: the key", () => {
  const a = row("a");
  const same = row("b", { weightG: 70, size: "large" });

  it("groups rows that differ only in slug, model, weight and size", () => {
    const out = groupShells([entry(a, 1, 80), entry(same, 2, 79)], [a, same]);
    expect(out).toHaveLength(1);
    expect(out[0]!.mouse.slug).toBe("a");
    expect(out[0]!.variants).toEqual([{ slug: "b", model: "B", weightG: 70 }]);
  });

  const splitters: [string, Partial<CatalogueMouse>][] = [
    ["brand", { brand: "Other" }],
    ["lengthMm", { lengthMm: 120.01 }],
    ["widthMm", { widthMm: 65.01 }],
    ["heightMm", { heightMm: 40.01 }],
    ["shape", { shape: "ergonomic" }],
    ["handCompatibility", { handCompatibility: "right" }],
    ["humpPlacement", { humpPlacement: "back_moderate" }],
    ["frontFlare", { frontFlare: "outward_moderate" }],
    ["sideCurvature", { sideCurvature: "inward" }],
    ["thumbRest", { thumbRest: false }],
    ["ringFingerRest", { ringFingerRest: true }],
  ];
  it.each(splitters)("a different %s splits the group", (_name, over) => {
    const other = row("b", over);
    const out = groupShells([entry(a, 1, 80), entry(other, 2, 79)], [a, other]);
    expect(out.map((e) => e.mouse.slug)).toEqual(["a", "b"]);
    expect(out.every((e) => e.variants === undefined)).toBe(true);
  });

  it("strict equality: brand case is not folded and a trailing space is not trimmed", () => {
    const upper = row("b", { brand: "ACME" });
    const spaced = row("c", { brand: "Acme " });
    const out = groupShells(
      [entry(a, 1, 80), entry(upper, 2, 79), entry(spaced, 3, 78)],
      [a, upper, spaced],
    );
    expect(out).toHaveLength(3);
  });

  it.each([
    "shape",
    "handCompatibility",
    "humpPlacement",
    "frontFlare",
    "sideCurvature",
    "thumbRest",
    "ringFingerRest",
  ] as const)("null %s matches only null, not a value", (field) => {
    const n1 = row("a", { [field]: null });
    const n2 = row("b", { [field]: null });
    const v = row("c");
    const out = groupShells(
      [entry(n1, 1, 80), entry(v, 2, 79), entry(n2, 3, 78)],
      [n1, n2, v],
    );
    expect(out.map((e) => e.mouse.slug)).toEqual(["a", "c"]);
    expect(out[0]!.variants?.map((x) => x.slug)).toEqual(["b"]);
  });

  it("an absent ringFingerRest equals null, and differs from false", () => {
    const { ringFingerRest: _r, ...noField } = base;
    void _r;
    const absent: CatalogueMouse = { ...noField, slug: "a", model: "A" };
    const nul = row("b", { ringFingerRest: null });
    const falsy = row("c", { ringFingerRest: false });
    const out = groupShells(
      [entry(absent, 1, 80), entry(nul, 2, 79), entry(falsy, 3, 78)],
      [absent, nul, falsy],
    );
    expect(out.map((e) => e.mouse.slug)).toEqual(["a", "c"]);
  });
});

describe("groupShells: which member is shown, order and ranks", () => {
  const a = row("a");
  const b = row("b");
  const c = row("c");
  const x = row("x", { brand: "Other" });
  const y = row("y", { brand: "Third" });
  const cat = [a, b, c, x, y];

  it("the best total wins, even when it ranked later", () => {
    // Out-of-order totals: not what the engines produce, but the rule is explicit.
    const ranked = [
      entry(a, 1, 70),
      entry(x, 2, 69),
      entry(b, 3, 75),
      entry(c, 4, 60),
    ];
    const out = groupShells(ranked, cat);
    const shown = out.find((e) => e.mouse.slug === "b")!;
    expect(shown.total).toBe(75);
    expect(shown.variants?.map((v) => v.slug)).toEqual(["a", "c"]);
  });

  it("a tie goes to the earlier rank", () => {
    const out = groupShells([entry(b, 1, 80), entry(a, 2, 80)], cat);
    expect(out).toHaveLength(1);
    expect(out[0]!.mouse.slug).toBe("b");
    expect(out[0]!.variants?.map((v) => v.slug)).toEqual(["a"]);
  });

  it("variants are ordered by rank before grouping", () => {
    const out = groupShells(
      [entry(a, 1, 90), entry(c, 2, 80), entry(x, 3, 79), entry(b, 4, 70)],
      cat,
    );
    expect(out[0]!.variants?.map((v) => v.slug)).toEqual(["c", "b"]);
  });

  it("keeps the order of the shown entries and renumbers 1..n without gaps", () => {
    const ranked = [
      entry(a, 1, 90),
      entry(b, 2, 89),
      entry(x, 3, 80),
      entry(c, 4, 79),
      entry(y, 5, 70),
    ];
    const out = groupShells(ranked, cat);
    expect(out.map((e) => [e.rank, e.mouse.slug])).toEqual([
      [1, "a"],
      [2, "x"],
      [3, "y"],
    ]);
  });

  it("changes nothing else on a shown entry", () => {
    const ranked = [entry(a, 1, 90), entry(b, 2, 89), entry(x, 3, 80)];
    const out = groupShells(ranked, cat);
    expect(out[1]).toEqual({ ...ranked[2], rank: 2 });
    const { variants: _v, ...first } = out[0]!;
    void _v;
    expect(first).toEqual(ranked[0]);
  });

  it("a single-member group gets no variants key at all", () => {
    const out = groupShells([entry(a, 1, 90), entry(x, 2, 80)], cat);
    for (const e of out) expect("variants" in e).toBe(false);
  });

  it("does not mutate its input", () => {
    const ranked = [entry(a, 1, 90), entry(b, 2, 89)];
    const copy = structuredClone(ranked);
    groupShells(ranked, cat);
    expect(ranked).toEqual(copy);
  });

  it("an empty list gives an empty list", () => {
    expect(groupShells([], cat)).toEqual([]);
  });

  it("throws when a ranked mouse has no catalogue row", () => {
    expect(() => groupShells([entry(a, 1, 90)], [])).toThrow(/catalogue row/);
  });
});

describe("groupShells on the real seed (v0)", () => {
  const built = buildSeedRows(
    seedJson as unknown as SpecRecord[],
    descriptorsJson as unknown as DescriptorRecord[],
    {
      facts: factsJson as unknown as FactsFile,
      entries: catalogueJson as unknown as CatalogueEntry[],
    },
  );
  const catalogue = listedOnly(
    [...built.withDescriptors, ...built.withoutDescriptors].map((r) =>
      toCatalogueMouse(r),
    ),
  );
  const scored = scoreFit(
    { handLengthMm: 205, palmLengthMm: 124, palmWidthMm: 88 },
    catalogue,
    fitPreferencesSchema.parse({ gripStyle: "claw" }),
    "right",
  );
  const grouped = groupShells(scored.results, catalogue);

  it("Scimitar Elite Wireless SE is ranked before grouping and is not its own entry after", () => {
    const models = (list: FitEntry[]) => list.map((e) => e.mouse.model);
    expect(models(scored.results)).toContain("Scimitar Elite Wireless SE");
    expect(models(grouped)).not.toContain("Scimitar Elite Wireless SE");
    const scimitar = grouped.find(
      (e) => e.mouse.model === "Scimitar Elite Wireless",
    );
    expect(scimitar?.variants?.map((v) => v.model)).toContain(
      "Scimitar Elite Wireless SE",
    );
  });

  it("ranks are contiguous, and every ranked mouse is shown or a variant exactly once", () => {
    expect(grouped.map((e) => e.rank)).toEqual(grouped.map((_, i) => i + 1));
    expect(grouped.length).toBeLessThan(scored.results.length);
    const variantSlugs = new Set(
      grouped.flatMap((e) => (e.variants ?? []).map((v) => v.slug)),
    );
    expect(grouped.some((e) => variantSlugs.has(e.mouse.slug))).toBe(false);
    expect(grouped.length + variantSlugs.size).toBe(scored.results.length);
  });
});
