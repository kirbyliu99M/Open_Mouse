import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { faqGroups, percent } from "../../src/lib/faq";
import { en as faqEn, zhTW as faqZh } from "../../src/lib/copy/faq";
import {
  lightestOfShape,
  statsByShape,
  statsBySize,
} from "../../src/lib/guides";
import {
  FEATURED_PAIRS,
  formatMm,
  handSizeChart,
  idealHandLengthMm,
  indexablePairs,
  isIndexablePair,
  medianOf,
  pairDiff,
  pairSegment,
  parsePairSegment,
  similarMice,
  targetMouseLengthMm,
} from "../../src/lib/mice/compare";
import type { MiceListRow } from "../../src/lib/mice/list";
import { BASE_WEIGHTS, LENGTH_FACTOR } from "../../src/server/fit/coefficients";

function row(slug: string, over: Partial<MiceListRow> = {}): MiceListRow {
  return {
    slug,
    brand: "Brand",
    model: slug,
    size: "medium",
    shape: "symmetrical",
    connectivity: "wireless",
    lengthMm: 120,
    widthMm: 62,
    heightMm: 38,
    weightG: 60,
    ...over,
  };
}

describe("length targets", () => {
  it("uses the engine's LENGTH_FACTOR both ways", () => {
    expect(targetMouseLengthMm(190, "palm")).toBe(
      Math.round(190 * LENGTH_FACTOR.palm),
    );
    expect(idealHandLengthMm(125, "claw")).toBe(
      Math.round(125 / LENGTH_FACTOR.claw),
    );
    // Inverse within rounding.
    const h = idealHandLengthMm(
      targetMouseLengthMm(185, "fingertip"),
      "fingertip",
    );
    expect(Math.abs(h - 185)).toBeLessThanOrEqual(1);
  });

  it("charts 160 to 210 mm in 5 mm steps, palm longest, fingertip shortest", () => {
    const chart = handSizeChart();
    expect(chart.map((r) => r.handLengthMm)).toEqual([
      160, 165, 170, 175, 180, 185, 190, 195, 200, 205, 210,
    ]);
    for (const r of chart) {
      expect(r.target.palm).toBeGreaterThan(r.target.claw);
      expect(r.target.claw).toBeGreaterThan(r.target.fingertip);
    }
  });
});

describe("formatMm and medianOf", () => {
  it("prints whole numbers bare and others to one decimal", () => {
    expect(formatMm(60)).toBe("60");
    expect(formatMm(63.95)).toBe("64.0");
    expect(formatMm(127.1)).toBe("127.1");
  });
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("pair segments", () => {
  it("orders the two slugs alphabetically", () => {
    expect(pairSegment("razer-x", "logitech-y")).toBe("logitech-y-vs-razer-x");
    expect(pairSegment("logitech-y", "razer-x")).toBe("logitech-y-vs-razer-x");
  });
  it("parses either order and names the canonical one", () => {
    expect(parsePairSegment("razer-x-vs-logitech-y")).toEqual({
      a: "razer-x",
      b: "logitech-y",
      canonical: "logitech-y-vs-razer-x",
    });
  });
  it("rejects a malformed or self pair", () => {
    for (const bad of [
      "a",
      "a-vs-a",
      "a-vs-b-vs-c",
      "A-vs-b",
      "a--x-vs-b",
      "-vs-b",
    ]) {
      expect(parsePairSegment(bad), bad).toBeNull();
    }
  });
  it("is unambiguous: no catalogue slug contains -vs-", () => {
    const seed = JSON.parse(
      readFileSync("src/db/seed/catalogue.json", "utf8"),
    ) as {
      slug: string;
    }[];
    expect(seed.some((r) => r.slug.includes("-vs-"))).toBe(false);
  });
  it("writes every featured pair in canonical order with seeded slugs", () => {
    const seed = new Set(
      (
        JSON.parse(readFileSync("src/db/seed/catalogue.json", "utf8")) as {
          slug: string;
        }[]
      ).map((r) => r.slug),
    );
    for (const [a, b] of FEATURED_PAIRS) {
      expect(a < b, `${a} / ${b}`).toBe(true);
      expect(seed.has(a), a).toBe(true);
      expect(seed.has(b), b).toBe(true);
    }
  });
});

describe("similarMice and indexablePairs", () => {
  const a = row("a");
  const near = row("near", { brand: "Other", lengthMm: 121 });
  const far = row("far", { brand: "Other", lengthMm: 140, widthMm: 72 });
  const twin = row("a-se"); // same brand, same size: skipped
  const ergo = row("ergo", {
    brand: "Other",
    shape: "ergonomic",
    lengthMm: 120,
  });
  const rows = [a, near, far, twin, ergo];

  it("ranks by size, keeps shapes apart and skips identical same-brand twins", () => {
    expect(similarMice(rows, a, 3).map((r) => r.slug)).toEqual([
      "near",
      "ergo",
      "far",
    ]);
  });

  it("lists each mouse's nearest pairs once, canonical", () => {
    const pairs = indexablePairs(rows, 1);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toContain("a-vs-near");
    for (const p of pairs) expect(parsePairSegment(p)?.canonical).toBe(p);
  });

  it("isIndexablePair agrees with indexablePairs on every pair", () => {
    const listed = new Set(indexablePairs(rows));
    for (const x of rows) {
      for (const y of rows) {
        if (x.slug >= y.slug) continue;
        expect(isIndexablePair(rows, x, y), `${x.slug}/${y.slug}`).toBe(
          listed.has(pairSegment(x.slug, y.slug)),
        );
      }
    }
  });

  it("computes b minus a, and no weight difference without both weights", () => {
    expect(pairDiff(a, far)).toEqual({
      lengthMm: 20,
      widthMm: 10,
      heightMm: 0,
      weightG: 0,
    });
    expect(pairDiff(a, row("x", { weightG: null })).weightG).toBeNull();
  });
});

describe("guide figures", () => {
  const rows = [
    row("s1", { size: "small", lengthMm: 110, weightG: 50 }),
    row("s2", { size: "small", lengthMm: 114, weightG: null }),
    row("m1", { size: "medium", shape: "ergonomic", weightG: 70 }),
    row("m2", { size: "medium", shape: "ergonomic", weightG: 45 }),
  ];
  it("counts and takes medians per size and shape", () => {
    const bySize = statsBySize(rows);
    expect(bySize.small).toMatchObject({
      count: 2,
      medianLengthMm: 112,
      medianWeightG: 50,
    });
    expect(bySize.large.count).toBe(0);
    expect(statsByShape(rows).ergonomic.medianWeightG).toBe(57.5);
  });
  it("lists the lightest of a shape with a weight, lightest first", () => {
    expect(lightestOfShape(rows, "ergonomic").map((r) => r.slug)).toEqual([
      "m2",
      "m1",
    ]);
    expect(lightestOfShape(rows, "symmetrical").map((r) => r.slug)).toEqual([
      "s1",
    ]);
  });
});

describe("FAQ", () => {
  const facts = {
    lengthFactor: LENGTH_FACTOR,
    weights: BASE_WEIGHTS,
    catalogue: { mice: 409, brands: 23 },
  };

  it("fills every number from the engine and the catalogue", () => {
    const text = JSON.stringify(faqGroups(faqEn, facts));
    expect(text).toContain(percent(LENGTH_FACTOR.palm));
    expect(text).toContain(percent(BASE_WEIGHTS.length));
    expect(text).toContain("409 gaming mice");
  });

  it("has the same questions in both languages, each answered", () => {
    const zh = faqGroups(faqZh, facts).flatMap((g) => g.entries);
    const en = faqGroups(faqEn, facts).flatMap((g) => g.entries);
    expect(zh).toHaveLength(en.length);
    for (const e of [...zh, ...en]) {
      expect(e.question.length).toBeGreaterThan(3);
      expect(e.answer.length).toBeGreaterThan(20);
    }
  });

  it("has no hand-typed digits outside the answers that take numbers", () => {
    // Fixed facts the notice already states (A4, 24 hours, 90 days) are allowed.
    const fixed = [faqEn, faqZh].map((c) =>
      JSON.stringify({
        ...c,
        gripChangesSize: null,
        scoring: null,
        catalogue: null,
      }),
    );
    for (const t of fixed) {
      const digits = t.replace(/A4|24|90/g, "").match(/\d/g);
      expect(digits).toBeNull();
    }
  });

  it("drops the counts when the catalogue cannot be read", () => {
    const text = JSON.stringify(
      faqGroups(faqEn, { ...facts, catalogue: null }),
    );
    expect(text).toContain(faqEn.catalogueNoCount);
  });
});
