import { describe, expect, it } from "vitest";
import { CATALOGUE_EXPECTED as N } from "./fixtures/catalogue-expected";
import {
  DATA_SOURCES,
  FRONT_FLARES,
  HAND_COMPATIBILITY,
  HUMP_PLACEMENTS,
  SHAPES,
  SIDE_CURVATURES,
} from "../../src/lib/contracts/descriptors";
import {
  assertNoDuplicates,
  assertNoUnflaggedTrackballs,
  buildCatalogue,
  deriveFormFactor,
  eloPageConnectivity,
  ELOSHAPES_BROWSE_URL,
  isKnownConnectivity,
  LOGITECH_ALIASES,
  mapCandidate,
  mapConnectivity,
  mapDataSource,
  mapFlare,
  mapHand,
  mapHump,
  mapShape,
  mapSideCurvature,
  mapSourceUrl,
  mapYesNo,
  normaliseBrand,
  OFFICIAL_CONNECTIVITY,
  resolveLogitechMerges,
  TRACKBALL_NAME_PATTERN,
  type CandidateRecord,
} from "../../src/server/catalogue/candidate-map";
import catalogue from "../../src/db/seed/catalogue.json";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import seed from "../../src/db/seed/logitech.json";

const RETRIEVED = "2026-10-09T00:00:00.000Z";

const record = (over: Partial<CandidateRecord> = {}): CandidateRecord => ({
  descriptorBasis: "",
  brand: "Pulsar",
  model: "X2V2 Mini",
  officialUrl: "https://pulsargg.com/x2v2",
  source: "eloshapes_csv",
  lengthMm: "119.0",
  widthMm: "62.0",
  heightMm: "38.0",
  weightG: "52.0",
  size: "Small",
  shape: "Symmetrical",
  hand: "Right",
  hump: "Back - minimal",
  flare: "Outward - slight",
  sideCurvature: "Inward - aggressive",
  thumbRest: "No",
  connectivity: "Wireless",
  ...over,
});

describe("descriptor enum mapping", () => {
  it("maps every contract slug from its EloShapes wording", () => {
    const wording = (slug: string) =>
      slug
        .split("_")
        .map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
        .join(" - ");
    for (const v of HUMP_PLACEMENTS) expect(mapHump(wording(v))).toBe(v);
    for (const v of FRONT_FLARES) expect(mapFlare(wording(v))).toBe(v);
    for (const v of SIDE_CURVATURES)
      expect(mapSideCurvature(wording(v))).toBe(v);
    for (const v of HAND_COMPATIBILITY) expect(mapHand(wording(v))).toBe(v);
    for (const v of SHAPES) expect(mapShape(wording(v))).toBe(v);
  });

  it("reads the real spellings in the list", () => {
    expect(mapHump("Back - moderate")).toBe("back_moderate");
    expect(mapHump("Center")).toBe("center");
    expect(mapFlare("Outward - slight")).toBe("outward_slight");
    expect(mapFlare("Inward - aggressive")).toBe("inward_aggressive");
    expect(mapSideCurvature("Inward")).toBe("inward");
    expect(mapSideCurvature("Inward - aggressive")).toBe("inward_aggressive");
    expect(mapSideCurvature("Flat")).toBe("flat");
    expect(mapHand("Ambidextrous")).toBe("ambidextrous");
    expect(mapShape("Symmetrical")).toBe("symmetrical");
  });

  it("is case-insensitive (the list has lowercase 'symmetrical' and 'ambidextrous')", () => {
    expect(mapShape("symmetrical")).toBe("symmetrical");
    expect(mapHand("ambidextrous")).toBe("ambidextrous");
  });

  it("maps Asymmetrical to ergonomic (rubric section 3: a handed shell)", () => {
    expect(mapShape("Asymmetrical")).toBe("ergonomic");
  });

  it.each(["", "  ", "-", "–"])("treats %j as no value", (blank) => {
    expect(mapShape(blank)).toBeNull();
    expect(mapHand(blank)).toBeNull();
    expect(mapHump(blank)).toBeNull();
    expect(mapFlare(blank)).toBeNull();
    expect(mapSideCurvature(blank)).toBeNull();
    expect(mapYesNo("thumbRest", blank)).toBeNull();
  });

  it("throws on a value that does not map, naming the field", () => {
    expect(() => mapHump("Back - extreme")).toThrow(/hump/);
    expect(() => mapFlare("Sideways")).toThrow(/flare/);
    expect(() => mapSideCurvature("Outward - slight")).toThrow(/sideCurvature/);
    expect(() => mapHand("Both")).toThrow(/hand/);
    expect(() => mapShape("Round")).toThrow(/shape/);
    expect(() => mapYesNo("thumbRest", "Maybe")).toThrow(/thumbRest/);
  });

  it("maps Yes and No", () => {
    expect(mapYesNo("thumbRest", "Yes")).toBe(true);
    expect(mapYesNo("thumbRest", "no")).toBe(false);
  });
});

describe("mapDataSource", () => {
  it("maps both EloShapes sources to eloshapes and official to first_party", () => {
    expect(mapDataSource("eloshapes_csv")).toBe("eloshapes");
    expect(mapDataSource("eloshapes_site")).toBe("eloshapes");
    expect(mapDataSource("official")).toBe("first_party");
    for (const s of ["eloshapes_csv", "eloshapes_site", "official"])
      expect(DATA_SOURCES).toContain(mapDataSource(s));
  });
  it("throws on anything else", () => {
    expect(() => mapDataSource("reddit")).toThrow(/source/);
  });
});

describe("mapSourceUrl", () => {
  it("keeps an https page", () => {
    expect(mapSourceUrl(" https://a.example/x ", "eloshapes")).toBe(
      "https://a.example/x",
    );
  });
  it("falls back to the EloShapes browse page for an EloShapes row with no page", () => {
    expect(mapSourceUrl("", "eloshapes")).toBe(ELOSHAPES_BROWSE_URL);
  });
  it("refuses a first-party row with no page, and any non-https page", () => {
    expect(() => mapSourceUrl("", "first_party")).toThrow();
    expect(() => mapSourceUrl("http://a.example", "eloshapes")).toThrow(
      /https/,
    );
  });
});

describe("normaliseBrand", () => {
  it("trims and collapses whitespace", () => {
    expect(normaliseBrand("  Endgame   Gear ")).toBe("Endgame Gear");
  });
  it("folds Logitech spellings to Logitech", () => {
    expect(normaliseBrand("Logitech G")).toBe("Logitech");
    expect(normaliseBrand("LogitechG")).toBe("Logitech");
  });
  it("rejects an empty brand", () => {
    expect(() => normaliseBrand("  ")).toThrow();
  });
});

describe("deriveFormFactor", () => {
  it("is vertical above the engine's 0.55 height ratio, standard at or below", () => {
    expect(deriveFormFactor({ lengthMm: 117.8, heightMm: 71.7 })).toBe(
      "vertical",
    );
    expect(deriveFormFactor({ lengthMm: 100, heightMm: 55 })).toBe("standard");
    expect(deriveFormFactor({ lengthMm: 125, heightMm: 40 })).toBe("standard");
  });
});

describe("mapConnectivity", () => {
  it("maps each EloShapes value", () => {
    expect(mapConnectivity("Wired")).toBe("wired");
    expect(mapConnectivity("Wireless")).toBe("wireless");
    expect(mapConnectivity(" wireless ")).toBe("wireless");
  });

  it("maps blank, missing and unknown spellings to null", () => {
    expect(mapConnectivity("")).toBeNull();
    expect(mapConnectivity(undefined)).toBeNull();
    expect(mapConnectivity("Bluetooth")).toBeNull();
    expect(isKnownConnectivity("")).toBe(true);
    expect(isKnownConnectivity("Wired")).toBe(true);
    expect(isKnownConnectivity("Bluetooth")).toBe(false);
  });

  it("carries the value into the entry, null when the record has none", () => {
    expect(mapCandidate(record(), RETRIEVED).connectivity).toBe("wireless");
    expect(
      mapCandidate(record({ connectivity: "Wired" }), RETRIEVED).connectivity,
    ).toBe("wired");
    expect(
      mapCandidate(record({ connectivity: undefined }), RETRIEVED).connectivity,
    ).toBeNull();
  });
});

describe("eloPageConnectivity", () => {
  const block = (wired: string, wireless: string) => [
    "Acceleration",
    "Connectivity",
    "Wired",
    wired,
    "Wireless",
    wireless,
    "Bluetooth",
    "No",
  ];

  it("reads wired-only, wireless-only and both (both is Wireless)", () => {
    expect(eloPageConnectivity(block("Yes (USB-C)", "No"))).toBe("Wired");
    expect(eloPageConnectivity(block("No", "Yes (2.4 GHz)"))).toBe("Wireless");
    expect(eloPageConnectivity(block("Yes (USB-C)", "Yes (2.4 GHz)"))).toBe(
      "Wireless",
    );
  });

  it("returns blank when the block or the answers are missing", () => {
    expect(eloPageConnectivity(["Weight", "50"])).toBe("");
    expect(eloPageConnectivity(block("-", "-"))).toBe("");
  });

  it("reads Wired = Yes with Wireless = - as wired", () => {
    expect(eloPageConnectivity(block("Yes (USB-C)", "-"))).toBe("Wired");
  });
});

describe("OFFICIAL_CONNECTIVITY", () => {
  const official = (catalogue as unknown as CatalogueEntry[]).filter(
    (e) => e.dataSource === "first_party",
  );

  it("pins the seven values read from the brand pages", () => {
    expect(OFFICIAL_CONNECTIVITY).toEqual({
      "https://hyperx.com/products/hyperx-pulsefire-haste-3-wired-gaming-mouse":
        "Wired",
      "https://hyperx.com/products/hyperx-pulsefire-haste-3-wireless-gaming-mouse":
        "Wireless",
      "https://hyperx.com/products/hyperx-pulsefire-saga-gaming-mouse": "Wired",
      "https://www.wlmouse.com/en-wl/products/bxv2-max-black-gold": "Wireless",
      "https://www.wlmouse.com/en-wl/products/bxv2-med-black-gold": "Wireless",
      "https://www.wlmouse.com/en-wl/products/bxv2-mini-black-gold": "Wireless",
      "https://dareu.com/products/dareu-ultra-07-tri-mode-modular-gaming-mouse":
        "Wireless",
    });
  });

  it("keys every value by the URL of an official candidate in catalogue.json", () => {
    const urls = new Set(official.map((e) => e.sourceUrl));
    for (const url of Object.keys(OFFICIAL_CONNECTIVITY)) {
      expect(urls.has(url), url).toBe(true);
    }
    expect(official).toHaveLength(8);
  });

  it("leaves exactly the one unreadable official page (Razer Boomslang) null", () => {
    const nulls = official.filter((e) => e.connectivity === null);
    expect(nulls.map((e) => e.model)).toEqual([
      "Boomslang 20th Anniversary Edition",
    ]);
    for (const e of official) {
      const raw = OFFICIAL_CONNECTIVITY[e.sourceUrl];
      if (raw !== undefined) expect(e.connectivity).toBe(raw.toLowerCase());
    }
  });
});

describe("mapCandidate", () => {
  it("maps a full row, with the slug from slugify", () => {
    const e = mapCandidate(record(), RETRIEVED);
    expect(e).toMatchObject({
      slug: "pulsar-x2v2-mini",
      brand: "Pulsar",
      model: "X2V2 Mini",
      dataSource: "eloshapes",
      lengthMm: 119,
      widthMm: 62,
      heightMm: 38,
      weightG: 52,
      shape: "symmetrical",
      handCompatibility: "right",
      humpPlacement: "back_minimal",
      frontFlare: "outward_slight",
      sideCurvature: "inward_aggressive",
      thumbRest: false,
      descriptorsInferred: false,
      mergesInto: null,
      retrievedAt: RETRIEVED,
    });
  });

  it("reads a '-' weight as null and keeps the row", () => {
    expect(
      mapCandidate(record({ weightG: "-" }), RETRIEVED).weightG,
    ).toBeNull();
  });

  it("flags a row with a descriptorBasis as inferred", () => {
    const e = mapCandidate(
      record({ descriptorBasis: "EloShapes predecessor Saga Pro; inferred" }),
      RETRIEVED,
    );
    expect(e.descriptorsInferred).toBe(true);
  });

  it("names the row when a value does not map", () => {
    expect(() => mapCandidate(record({ hump: "Nowhere" }), RETRIEVED)).toThrow(
      /Pulsar X2V2 Mini: hump/,
    );
  });

  it.each([
    ["not a number", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
    ["infinite", "Infinity"],
  ])("refuses a %s dimension", (_label, value) => {
    expect(() => mapCandidate(record({ lengthMm: value }), RETRIEVED)).toThrow(
      /lengthMm/,
    );
  });

  it.each(["abc", "0", "-3"])(
    "refuses a weight of %j that is not positive",
    (value) => {
      expect(() => mapCandidate(record({ weightG: value }), RETRIEVED)).toThrow(
        /weightG/,
      );
    },
  );

  it.each(["lengthMm", "widthMm", "heightMm"] as const)(
    "refuses a row with no %s",
    (k) => {
      expect(() => mapCandidate(record({ [k]: "-" }), RETRIEVED)).toThrow(k);
    },
  );
});

describe("assertNoDuplicates", () => {
  it("throws, naming both rows, when two models share a slug", () => {
    const a = mapCandidate(record({ model: "X2 Mini" }), RETRIEVED);
    const b = mapCandidate(record({ model: "x2-mini" }), RETRIEVED);
    expect(() => assertNoDuplicates([a, b])).toThrow(/pulsar-x2-mini/);
  });
  it("passes distinct slugs", () => {
    expect(() =>
      assertNoDuplicates([
        mapCandidate(record({ model: "A" }), RETRIEVED),
        mapCandidate(record({ model: "B" }), RETRIEVED),
      ]),
    ).not.toThrow();
  });
});

describe("resolveLogitechMerges", () => {
  const logitech = (model: string) =>
    mapCandidate(record({ brand: "Logitech", model }), RETRIEVED);
  const seedModels = ["G903 Hero", "G403 Hero", "G502 Hero"];

  it("merges by exact name", () => {
    const [e] = resolveLogitechMerges([logitech("G502 Hero")], seedModels);
    expect(e!.mergesInto).toBe("G502 Hero");
  });

  it("merges an alias when its target has no entry of its own", () => {
    const [e] = resolveLogitechMerges(
      [logitech("G903 Lightspeed")],
      seedModels,
    );
    expect(e!.mergesInto).toBe("G903 Hero");
  });

  it("leaves the alias a new row when the target's own name is in the list", () => {
    const out = resolveLogitechMerges(
      [logitech("G403"), logitech("G403 Hero")],
      seedModels,
    );
    expect(out.map((e) => e.mergesInto)).toEqual([null, "G403 Hero"]);
  });

  it("leaves a Logitech model with no seed row as a new row", () => {
    expect(
      resolveLogitechMerges([logitech("G Pro Wireless")], seedModels)[0]!
        .mergesInto,
    ).toBeNull();
  });

  it("never merges another brand", () => {
    const other = mapCandidate(record({ model: "G502 Hero" }), RETRIEVED);
    expect(
      resolveLogitechMerges([other], seedModels)[0]!.mergesInto,
    ).toBeNull();
  });

  it("throws when two entries claim one seed row", () => {
    expect(() =>
      resolveLogitechMerges(
        [logitech("G502 Hero"), logitech("G502 Hero")],
        seedModels,
      ),
    ).toThrow(/both merge into the seed row G502 Hero/);
  });

  it("only aliases onto models that exist in the seed", () => {
    for (const target of Object.values(LOGITECH_ALIASES))
      expect(seed.map((r) => r.model)).toContain(target);
  });
});

describe("buildCatalogue", () => {
  it("throws on a duplicate before merging anything", () => {
    expect(() => buildCatalogue([record(), record()], [], RETRIEVED)).toThrow(
      /duplicate/,
    );
  });
});

describe("the trackball guard", () => {
  const kensington = record({ brand: "Kensington", model: "Expert Mouse" });

  it("fails the import for a non-Logitech trackball name", () => {
    expect(() => buildCatalogue([kensington], [], RETRIEVED)).toThrow(
      /Kensington Expert Mouse/,
    );
  });

  it("passes when the slug is on the allowlist", () => {
    const entries = buildCatalogue([kensington], [], RETRIEVED, [
      "kensington-expert-mouse",
    ]);
    expect(entries).toHaveLength(1);
  });

  it("exempts Logitech (its form factors come from the facts file)", () => {
    const m575 = mapCandidate(
      record({ brand: "Logitech", model: "ERGO M575" }),
      RETRIEVED,
    );
    expect(() => assertNoUnflaggedTrackballs([m575], [])).not.toThrow();
  });

  it("passes the real candidate list", () => {
    expect(() =>
      assertNoUnflaggedTrackballs(catalogue as unknown as CatalogueEntry[]),
    ).not.toThrow();
  });
});

describe("TRACKBALL_NAME_PATTERN", () => {
  it("catches trackball names and not ordinary mice", () => {
    expect(TRACKBALL_NAME_PATTERN.test("Logitech ERGO M575")).toBe(true);
    expect(TRACKBALL_NAME_PATTERN.test("Kensington Expert Mouse")).toBe(true);
    expect(TRACKBALL_NAME_PATTERN.test("Razer Viper V3 Pro")).toBe(false);
  });
});

describe("the committed src/db/seed/catalogue.json", () => {
  const entries = catalogue as unknown as CatalogueEntry[];

  it("carries connectivity on every entry, with the counts the fixture names", () => {
    const n = (v: string | null) =>
      entries.filter((e) => e.connectivity === v).length;
    for (const e of entries) {
      expect([null, "wired", "wireless"]).toContain(e.connectivity);
    }
    expect({
      wired: n("wired"),
      wireless: n("wireless"),
      unknown: n(null),
    }).toEqual(N.candidateConnectivity);
  });

  it("holds the approved candidates, no slug twice", () => {
    expect(entries).toHaveLength(N.candidates);
    expect(() => assertNoDuplicates(entries)).not.toThrow();
  });

  it("uses only contract values, every one of them", () => {
    for (const e of entries) {
      const label = `${e.brand} ${e.model}`;
      expect(DATA_SOURCES, label).toContain(e.dataSource);
      if (e.shape) expect(SHAPES, label).toContain(e.shape);
      if (e.handCompatibility)
        expect(HAND_COMPATIBILITY, label).toContain(e.handCompatibility);
      if (e.humpPlacement)
        expect(HUMP_PLACEMENTS, label).toContain(e.humpPlacement);
      if (e.frontFlare) expect(FRONT_FLARES, label).toContain(e.frontFlare);
      if (e.sideCurvature)
        expect(SIDE_CURVATURES, label).toContain(e.sideCurvature);
      expect(e.sourceUrl.startsWith("https://"), label).toBe(true);
      expect(e.lengthMm > 0 && e.widthMm > 0 && e.heightMm > 0, label).toBe(
        true,
      );
    }
  });

  it("satisfies the rubric's consistency rules (the table's CHECK constraints)", () => {
    for (const e of entries) {
      const label = `${e.brand} ${e.model}`;
      if (e.handCompatibility === "ambidextrous" && e.shape !== null)
        expect(e.shape, label).toBe("symmetrical");
      if (e.thumbRest === true) expect(e.shape, label).toBe("ergonomic");
    }
  });

  it("marks exactly the inferred rows and merges its Logitech rows", () => {
    expect(entries.filter((e) => e.descriptorsInferred)).toHaveLength(
      N.inferred,
    );
    expect(entries.filter((e) => e.mergesInto)).toHaveLength(N.merged);
    expect(
      entries.filter((e) => e.mergesInto && e.mergesInto !== e.model),
    ).toEqual([expect.objectContaining({ model: "G903 Lightspeed" })]);
  });
});
