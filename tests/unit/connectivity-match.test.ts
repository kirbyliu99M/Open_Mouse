import { describe, expect, it } from "vitest";
import {
  buildCsvIndex,
  datasetModel,
  looseKey,
  lookupCsvConnectivity,
  matchSiteTitle,
  pageTextLines,
  type DatasetRow,
} from "../../src/server/catalogue/connectivity-match";

const row = (
  Brand: string,
  Model: string,
  Connectivity: string,
): DatasetRow => ({
  Brand,
  Model,
  Connectivity,
});

describe("looseKey", () => {
  it("lowercases and drops everything but letters and digits", () => {
    expect(looseKey("Pro X2 SUPERSTRIKE")).toBe("prox2superstrike");
    expect(looseKey("Gear\nXM2w 4k")).toBe("gearxm2w4k");
  });
});

describe("datasetModel", () => {
  it("strips the Gear prefix for the Endgame brand only", () => {
    expect(datasetModel(row("Endgame", "Gear\nXM2w 4k", ""))).toBe("XM2w 4k");
    expect(datasetModel(row("Endgame", "Gear XM1", ""))).toBe("XM1");
    expect(datasetModel(row("Acme", "Gear One", ""))).toBe("Gear One");
  });
});

describe("lookupCsvConnectivity", () => {
  const index = buildCsvIndex([
    row("Endgame", "Gear\nXM2w 4k", "Wireless"),
    row("Endgame", "Gear\nXM2 8k", "Wired"),
    row("Acme", "Gear One", "Wired"),
    row("Pulsar", "Twin", "Wired"),
    row("Other", "Twin", "Wireless"),
    row("Solo", "Unique", "Wireless"),
  ]);

  it("matches Endgame Gear rows by the candidate's brand-normalised model", () => {
    expect(lookupCsvConnectivity(index, "Endgame Gear", "XM2w 4k")).toBe(
      "Wireless",
    );
    expect(lookupCsvConnectivity(index, "Endgame", "XM2 8k")).toBe("Wired");
  });

  it("matches brand and model first", () => {
    expect(lookupCsvConnectivity(index, "Pulsar", "Twin")).toBe("Wired");
    expect(lookupCsvConnectivity(index, "Other", "Twin")).toBe("Wireless");
  });

  it("falls back to the model alone only when every same-model row agrees", () => {
    expect(lookupCsvConnectivity(index, "Different Brand", "Unique")).toBe(
      "Wireless",
    );
    expect(
      lookupCsvConnectivity(index, "Different Brand", "Twin"),
    ).toBeUndefined();
  });

  it("does not strip Gear from other brands, and misses cleanly", () => {
    expect(lookupCsvConnectivity(index, "Acme", "Gear One")).toBe("Wired");
    expect(lookupCsvConnectivity(index, "Acme", "One")).toBeUndefined();
    expect(lookupCsvConnectivity(index, "Nobody", "Nothing")).toBeUndefined();
  });
});

describe("matchSiteTitle", () => {
  const titles = [
    { title: "ASUS ROG Gladius III Core", slug: "asus-gladius-iii-core" },
    {
      title: "Pulsar X2H CrazyLight Medium",
      slug: "pulsar-x2h-crazylight-medium",
    },
    { title: "Pulsar X2 Mini", slug: "pulsar-x2-mini" },
    { title: "Acme Super Mini", slug: "acme-super-mini" },
    { title: "Other Super Mini", slug: "other-super-mini" },
    { title: "Acme Xmini", slug: "acme-xmini" },
  ];

  it("takes the title equal to brand + model", () => {
    expect(matchSiteTitle(titles, "ASUS", "ROG Gladius III Core")).toBe(
      "asus-gladius-iii-core",
    );
  });

  it("takes a word-boundary suffix with exactly one hit", () => {
    expect(matchSiteTitle(titles, "ROG", "Gladius III Core")).toBe(
      "asus-gladius-iii-core",
    );
  });

  it("does not match a title that is a suffix of a longer model", () => {
    expect(matchSiteTitle(titles, "Pulsar", "Pro X2 Mini")).toBeNull();
    expect(matchSiteTitle(titles, "Pulsar", "X2 Mini Pro")).toBeNull();
  });

  it("does not match inside a word", () => {
    expect(matchSiteTitle(titles, "Acme", "Mini")).toBeNull();
    expect(matchSiteTitle(titles, "Whoever", "Xmini")).toBe("acme-xmini");
  });

  it("returns null when the suffix is ambiguous or absent", () => {
    expect(matchSiteTitle(titles, "Third", "Super Mini")).toBeNull();
    expect(matchSiteTitle(titles, "Pulsar", "Nope")).toBeNull();
  });

  it("returns null when two titles equal brand + model", () => {
    expect(
      matchSiteTitle(
        [
          { title: "A B", slug: "one" },
          { title: "a-b", slug: "two" },
        ],
        "A",
        "B",
      ),
    ).toBeNull();
  });
});

describe("pageTextLines", () => {
  it("turns tags into line breaks, unescapes and drops blanks", () => {
    expect(
      pageTextLines(
        "<td><span>Wired</span><!----></td><td> <span>Yes &amp; USB</span></td>",
      ),
    ).toEqual(["Wired", "Yes & USB"]);
  });
});
