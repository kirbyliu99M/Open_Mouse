import { describe, expect, it } from "vitest";
import { FIXTURES } from "../../src/components/results/fixtures";
import { buildShareCardInput } from "../../src/components/results/share/input";
import {
  fitResponseSchema,
  type FitResponse,
} from "../../src/lib/contracts/fit";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";

// Hard rule 2: variants are display-only. A response with variants gives the
// same analysis input and share-card input as the same response without them.
const VARIANT_WEIGHT = 1234.5;
const VARIANTS = [
  { slug: "acme-se", model: "Variant SE Unique", weightG: VARIANT_WEIGHT },
  { slug: "acme-4k", model: "Variant 4K Unique", weightG: null },
];

function withAndWithout(): { plain: FitResponse; rich: FitResponse } {
  const results = [1, 2, 3, 4].map((rank) =>
    makeEntry({
      rank,
      mouse: { ...makeEntry().mouse, slug: `m-${rank}`, model: `M${rank}` },
    }),
  );
  const plain = makeFit({ results });
  const rich = makeFit({
    results: results.map((e) => ({ ...e, variants: VARIANTS })),
  });
  return { plain, rich };
}

describe("variants and hard rule 2", () => {
  it("the fixture really carries variants and still parses", () => {
    const { rich } = withAndWithout();
    expect(() => fitResponseSchema.parse(rich)).not.toThrow();
    expect(rich.results[0]!.variants).toHaveLength(2);
  });

  it("gives the same analysis input with and without variants", () => {
    const { plain, rich } = withAndWithout();
    const m = makeMeasurements();
    const a = buildAnalysisInput(plain, m);
    const b = buildAnalysisInput(rich, m);
    expect(b).toEqual(a);
    const json = JSON.stringify(b);
    expect(json).not.toContain("variants");
    expect(json).not.toContain("Unique");
  });

  it("no variant number enters the numeral allow-list", () => {
    const { plain, rich } = withAndWithout();
    const m = makeMeasurements();
    const allowed = collectNumbers(buildAnalysisInput(rich, m));
    expect(allowed.has(VARIANT_WEIGHT)).toBe(false);
    expect([...allowed].sort()).toEqual(
      [...collectNumbers(buildAnalysisInput(plain, m))].sort(),
    );
  });

  it.each(["zh-TW", "en"] as const)(
    "the share card input does not carry variants (%s)",
    (lang) => {
      const { plain, rich } = withAndWithout();
      const a = buildShareCardInput(plain, lang, null);
      const b = buildShareCardInput(rich, lang, null);
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).not.toContain("Unique");
      expect(b).not.toHaveProperty("variants");
    },
  );

  it("holds on the demo fixture too", () => {
    const base = FIXTURES["many-results"];
    const rich = {
      ...base,
      results: base.results.map((e) => ({ ...e, variants: VARIANTS })),
    };
    const m = makeMeasurements();
    expect(buildAnalysisInput(rich, m)).toEqual(buildAnalysisInput(base, m));
  });
});
