import { describe, expect, it } from "vitest";
import { CATALOGUE_EXPECTED as N } from "./fixtures/catalogue-expected";
import catalogueJson from "../../src/db/seed/catalogue.json";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import seedJson from "../../src/db/seed/logitech.json";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import {
  assertConsistent,
  buildSeedRows,
  type FactsFile,
  imagePathFor,
  isGSeries,
  isMxSeries,
  logitechVisibility,
  type SeedRow,
  toCatalogueMouse,
} from "../../src/server/catalogue/catalogue-rows";
import type {
  DescriptorFields,
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";

const specs = seedJson as unknown as SpecRecord[];
const descriptors = descriptorsJson as unknown as DescriptorRecord[];
const facts = factsJson as unknown as FactsFile;
const entries = catalogueJson as unknown as CatalogueEntry[];

const built = buildSeedRows(specs, descriptors, { facts, entries });
const all: (SeedRow & Partial<DescriptorFields>)[] = [
  ...built.withDescriptors,
  ...built.withoutDescriptors,
];
const byModel = (model: string) => {
  const row = all.find((r) => r.model === model);
  if (!row) throw new Error(`${model} not built`);
  return row;
};

describe("Logitech series rules", () => {
  it.each([
    ["G502 X Plus", true],
    ["G Pro X Superlight 2", true],
    ["G903 Hero", true],
    ["MX Master 4", false],
    ["Signature Comfort M840L", false],
    ["Pebble 2 M350s", false],
    ["POP Mouse", false],
  ])("isGSeries(%s) is %s", (model, expected) => {
    expect(isGSeries(model)).toBe(expected);
  });

  it("isMxSeries matches MX names only", () => {
    expect(isMxSeries("MX Ergo S")).toBe(true);
    expect(isMxSeries("MX Master 3S")).toBe(true);
    expect(isMxSeries("M750")).toBe(false);
  });

  it("G is gaming and listed, MX is office and listed, the rest office and hidden", () => {
    expect(logitechVisibility("Logitech", "G305 Lightspeed")).toEqual({
      category: "gaming",
      listed: true,
    });
    expect(logitechVisibility("Logitech", "MX Vertical")).toEqual({
      category: "office",
      listed: true,
    });
    expect(logitechVisibility("Logitech", "M720 Triathlon")).toEqual({
      category: "office",
      listed: false,
    });
    expect(logitechVisibility("Razer", "Viper")).toEqual({
      category: "gaming",
      listed: true,
    });
  });
});

describe("buildSeedRows on the checked-in files", () => {
  it("holds seed + candidates - merged rows, none skipped, slugs unique", () => {
    expect(N.seedRows + N.candidates - N.merged).toBe(N.rows);
    expect(all).toHaveLength(N.rows);
    expect(built.merged).toBe(N.merged);
    expect(built.imported).toBe(N.imported);
    expect(built.skipped).toBe(0);
    expect(new Set(all.map((r) => r.slug)).size).toBe(N.rows);
    expect(new Set(all.map((r) => `${r.brand}/${r.model}`)).size).toBe(N.rows);
  });

  it("hides exactly the Logitech rows that are neither G nor MX", () => {
    const hidden = all.filter((r) => !r.listed);
    expect(hidden).toHaveLength(N.unlisted);
    for (const r of hidden) {
      expect(r.brand).toBe("Logitech");
      expect(isGSeries(r.model) || isMxSeries(r.model)).toBe(false);
      expect(r.category).toBe("office");
    }
    expect(all.filter((r) => r.listed)).toHaveLength(N.listed);
  });

  it("makes every candidate row gaming and every G-series row gaming", () => {
    for (const r of all.filter((x) => x.dataSource === "eloshapes"))
      expect(r.category).toBe("gaming");
    for (const r of all.filter((x) => isGSeries(x.model)))
      expect(r.category).toBe("gaming");
    expect(all.filter((r) => r.category === "office")).toHaveLength(N.office);
  });

  it("takes the three trackballs from the Logitech facts, nothing else", () => {
    expect(
      all
        .filter((r) => r.formFactor === "trackball")
        .map((r) => r.model)
        .sort(),
    ).toEqual(["ERGO M575", "ERGO M575S", "MX Ergo S"]);
  });

  it("derives vertical from height over length where no fact says so", () => {
    expect(
      all
        .filter((r) => r.formFactor === "vertical")
        .map((r) => r.model)
        .sort(),
    ).toEqual(["Lift Vertical", "M5", "MX Vertical"]);
  });

  it("marks the specs and the official candidates first-party, the rest EloShapes", () => {
    expect(all.filter((r) => r.dataSource === "first_party")).toHaveLength(
      N.firstParty,
    );
    expect(all.filter((r) => r.dataSource === "eloshapes")).toHaveLength(
      N.eloshapes,
    );
  });

  it("gives every row valid descriptor combinations", () => {
    for (const r of built.withDescriptors)
      expect(() => assertConsistent(r.model, r)).not.toThrow();
  });
});

describe("connectivity", () => {
  const tally = (rows: { connectivity: string | null }[]) => ({
    wired: rows.filter((r) => r.connectivity === "wired").length,
    wireless: rows.filter((r) => r.connectivity === "wireless").length,
    unknown: rows.filter((r) => r.connectivity === null).length,
  });

  it("counts what the fixture says, over every row and the listed ones", () => {
    expect(tally(all)).toEqual(N.rowConnectivity);
    expect(tally(all.filter((r) => r.listed))).toEqual(N.listedConnectivity);
  });

  it("gives an imported row its candidate's value", () => {
    const entry = entries.find(
      (e) => !e.mergesInto && e.connectivity === "wired",
    )!;
    expect(all.find((r) => r.slug === entry.slug)!.connectivity).toBe("wired");
    const none = entries.find((e) => e.connectivity === null)!;
    expect(all.find((r) => r.slug === none.slug)!.connectivity).toBeNull();
  });

  it("keeps the seed's value on a merged Logitech row when the candidate disagrees", () => {
    const seedValue = specs.find((s) => s.model === "G502 Hero")!.connectivity;
    const flipped = entries.map((e) =>
      e.mergesInto === "G502 Hero"
        ? { ...e, connectivity: seedValue === "wired" ? "wireless" : "wired" }
        : e,
    ) as CatalogueEntry[];
    const rebuilt = buildSeedRows(specs, descriptors, {
      facts,
      entries: flipped,
    });
    const row = [
      ...rebuilt.withDescriptors,
      ...rebuilt.withoutDescriptors,
    ].find((r) => r.model === "G502 Hero")!;
    expect(row.connectivity).toBe(seedValue);
  });

  it("agrees with the seed on every merged Logitech row today", () => {
    for (const e of entries.filter((x) => x.mergesInto)) {
      const seedValue = specs.find(
        (s) => s.model === e.mergesInto,
      )!.connectivity;
      expect(e.connectivity, e.model).toBe(seedValue);
    }
  });
});

describe("a merged Logitech row", () => {
  it("keeps its own dimensions and weight, not the candidate's", () => {
    const g703 = byModel("G703 Lightspeed");
    expect(g703.weightG).toBe(95); // the candidate says 107
    expect(g703.dataSource).toBe("first_party");
    const g309 = byModel("G309");
    expect(g309.weightG).toBeNull(); // the seed has none; the candidate's 86 is not copied
  });

  it("fills its null descriptors from the candidate and keeps the geometry hump", () => {
    const g305 = byModel("G305 Lightspeed"); // geometry: back_moderate
    expect(g305.humpPlacement).toBe("back_moderate");
    expect(g305.shape).toBe("symmetrical"); // from the candidate
    expect(g305.frontFlare).not.toBeNull();
    // The geometry model is kept, and the EloShapes fill is named.
    expect(g305.descriptorModel).toMatch(/^geometry-gd1@[0-9a-f]+\+eloshapes$/);
    expect(g305.descriptorSourceUrls).toContain(
      entries.find((e) => e.model === "G305 Lightspeed")!.sourceUrl,
    );
  });

  it("says +eloshapes on every merged row that took a value from its candidate", () => {
    const mergedRows = entries.filter((e) => e.mergesInto);
    expect(mergedRows).toHaveLength(N.merged);
    for (const e of mergedRows) {
      const row = byModel(e.mergesInto!);
      expect(row.descriptorModel, e.model).toMatch(/\+eloshapes$/);
      expect(row.descriptorSourceUrls, e.model).toContain(e.sourceUrl);
      expect(row.dataSource, e.model).toBe("first_party");
    }
    // The first-party rows nothing was merged into keep the geometry provenance.
    for (const row of all.filter(
      (r) =>
        r.brand === "Logitech" &&
        r.dataSource === "first_party" &&
        !entries.some((e) => e.mergesInto === r.model),
    ))
      expect(row.descriptorModel ?? "", row.model).not.toMatch(/eloshapes/);
  });

  it("leaves the geometry provenance alone when nothing is taken from the candidate", () => {
    const g309 = entries.find((e) => e.mergesInto === "G309")!;
    const empty: CatalogueEntry = {
      ...g309,
      shape: null,
      handCompatibility: null,
      humpPlacement: null,
      frontFlare: null,
      sideCurvature: null,
      thumbRest: null,
    };
    const rebuilt = buildSeedRows(specs, descriptors, {
      facts,
      entries: [empty],
    });
    const row = rebuilt.withDescriptors.find((r) => r.model === "G309")!;
    expect(row.descriptorModel).toMatch(/^geometry-gd1@[0-9a-f]+$/);
    expect(row.descriptorSourceUrls).toEqual([]);
  });

  it("lets a first-party fact win over the candidate", () => {
    // Facts: G Pro X Superlight 2 DEX is right and ergonomic.
    const dex = byModel("G Pro X Superlight 2 DEX");
    expect(dex.handCompatibility).toBe("right");
    expect(dex.shape).toBe("ergonomic");
  });

  it("merges the G903 Lightspeed candidate into the G903 Hero row", () => {
    const g903 = byModel("G903 Hero");
    expect(g903.handCompatibility).toBe("ambidextrous");
    expect(g903.shape).toBe("symmetrical");
    expect(g903.lengthMm).toBe(
      specs.find((s) => s.model === "G903 Hero")!.lengthMm,
    );
    expect(all.some((r) => r.model === "G903 Lightspeed")).toBe(false);
  });

  it("names EloShapes as the descriptor source when no geometry record exists", () => {
    const m = built.withDescriptors.find(
      (r) => r.model === "G Pro X Superlight",
    )!;
    expect(m.descriptorModel).toBe("eloshapes");
    expect(m.descriptorMethod).toBeNull();
  });

  it("marks inferred rows in descriptor_model", () => {
    const inferred = entries.filter((e) => e.descriptorsInferred);
    expect(inferred).toHaveLength(N.inferred);
    for (const e of inferred)
      expect(byModel(e.model).descriptorModel).toBe("eloshapes-inferred");
  });
});

describe("Logitech visibility on imported rows", () => {
  it("lists a Logitech row only if it is G or MX, whichever way it got in", () => {
    for (const r of all.filter((x) => x.brand === "Logitech" && x.listed))
      expect(isGSeries(r.model) || isMxSeries(r.model), r.model).toBe(true);
  });

  it("hides an imported Logitech candidate that is neither G nor MX", () => {
    const base = entries.find((e) => e.model === "G Pro Wireless")!;
    const office: CatalogueEntry = {
      ...base,
      model: "M590 Silent",
      slug: "logitech-m590-silent",
      mergesInto: null,
    };
    const rebuilt = buildSeedRows(specs, descriptors, {
      facts,
      entries: [office, base],
    });
    const rows = [...rebuilt.withDescriptors, ...rebuilt.withoutDescriptors];
    expect(rows.find((r) => r.model === "M590 Silent")).toMatchObject({
      category: "office",
      listed: false,
    });
    expect(rows.find((r) => r.model === "G Pro Wireless")).toMatchObject({
      category: "gaming",
      listed: true,
    });
  });
});

describe("rows with no source for their descriptors", () => {
  it("stay in withoutDescriptors when there are no facts or candidates (the old seed)", () => {
    const old = buildSeedRows(specs, []);
    expect(old.withDescriptors).toHaveLength(0);
    expect(old.withoutDescriptors).toHaveLength(38);
    expect(old.imported).toBe(0);
  });
});

describe("image_path", () => {
  it("is set only when the file exists", () => {
    const withImage = buildSeedRows(specs, [], {
      imageExists: (slug) => slug === "logitech-g309",
    });
    const rows = [
      ...withImage.withDescriptors,
      ...withImage.withoutDescriptors,
    ];
    expect(rows.find((r) => r.model === "G309")!.imagePath).toBe(
      "/images/mice/logitech-g309.webp",
    );
    expect(
      rows.find((r) => r.model === "G203 Lightsync")!.imagePath,
    ).toBeNull();
    expect(imagePathFor("a-b")).toBe("/images/mice/a-b.webp");
  });

  it("is null for every row today (public/images/mice does not exist)", () => {
    for (const r of all) expect(r.imagePath).toBeNull();
  });
});

describe("errors", () => {
  it("rejects a fact that is not a contract value", () => {
    expect(() =>
      buildSeedRows(specs, [], {
        facts: { "logitech-g309": { shape: { value: "round" } } },
      }),
    ).toThrow(/logitech-g309\.shape/);
  });

  it("rejects a candidate whose slug is already a logitech.json row", () => {
    const clash: CatalogueEntry = {
      ...entries.find((e) => e.model === "G Pro X Superlight")!,
      model: "G309",
      slug: "logitech-g309",
      mergesInto: null,
    };
    expect(() => buildSeedRows(specs, [], { entries: [clash] })).toThrow(
      /logitech-g309/,
    );
  });

  it("assertConsistent refuses an ambidextrous ergonomic mouse and a thumb rest on a non-ergonomic one", () => {
    const base: DescriptorFields = {
      shape: "ergonomic",
      handCompatibility: "ambidextrous",
      humpPlacement: null,
      frontFlare: null,
      sideCurvature: null,
      thumbRest: null,
      ringFingerRest: null,
      descriptorMethod: null,
      descriptorModel: null,
      descriptorSourceUrls: null,
      classifiedAt: null,
    };
    expect(() => assertConsistent("x", base)).toThrow(/ambidextrous/);
    expect(() =>
      assertConsistent("x", {
        ...base,
        handCompatibility: "right",
        shape: "symmetrical",
        thumbRest: true,
      }),
    ).toThrow(/thumb rest/);
    expect(() =>
      assertConsistent("x", {
        ...base,
        handCompatibility: null,
        shape: null,
        thumbRest: true,
      }),
    ).toThrow(/thumb rest/);
  });
});

describe("toCatalogueMouse", () => {
  it("carries listed and formFactor to the engine", () => {
    const m = toCatalogueMouse(byModel("ERGO M575"));
    expect(m.listed).toBe(false);
    expect(m.formFactor).toBe("trackball");
  });
});
