import { describe, expect, it } from "vitest";
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
const all = [...built.withDescriptors, ...built.withoutDescriptors];
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
  it("holds 38 + 409 - 15 merged = 432 rows, none skipped, slugs unique", () => {
    expect(all).toHaveLength(432);
    expect(built.merged).toBe(15);
    expect(built.imported).toBe(394);
    expect(built.skipped).toBe(0);
    expect(new Set(all.map((r) => r.slug)).size).toBe(432);
    expect(new Set(all.map((r) => `${r.brand}/${r.model}`)).size).toBe(432);
  });

  it("hides exactly the 18 Logitech rows that are neither G nor MX", () => {
    const hidden = all.filter((r) => !r.listed);
    expect(hidden).toHaveLength(18);
    for (const r of hidden) {
      expect(r.brand).toBe("Logitech");
      expect(isGSeries(r.model) || isMxSeries(r.model)).toBe(false);
      expect(r.category).toBe("office");
    }
    expect(all.filter((r) => r.listed)).toHaveLength(414);
  });

  it("makes every candidate row gaming and every G-series row gaming", () => {
    for (const r of all.filter((x) => x.dataSource === "eloshapes"))
      expect(r.category).toBe("gaming");
    for (const r of all.filter((x) => isGSeries(x.model)))
      expect(r.category).toBe("gaming");
    expect(all.filter((r) => r.category === "office")).toHaveLength(23);
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

  it("marks the 38 specs and the 8 official candidates first-party, the rest EloShapes", () => {
    expect(all.filter((r) => r.dataSource === "first_party")).toHaveLength(46);
    expect(all.filter((r) => r.dataSource === "eloshapes")).toHaveLength(386);
  });

  it("gives every row valid descriptor combinations", () => {
    for (const r of built.withDescriptors)
      expect(() => assertConsistent(r.model, r)).not.toThrow();
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
    // Provenance stays the geometry file's.
    expect(g305.descriptorModel).toMatch(/^geometry-gd1@/);
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

  it("leaves G403 (the older listing) a row of its own beside G403 Hero", () => {
    expect(byModel("G403").dataSource).toBe("eloshapes");
    expect(byModel("G403 Hero").dataSource).toBe("first_party");
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
    expect(inferred).toHaveLength(8);
    for (const e of inferred)
      expect(byModel(e.model).descriptorModel).toBe("eloshapes-inferred");
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
