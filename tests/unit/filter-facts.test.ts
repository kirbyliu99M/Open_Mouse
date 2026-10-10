import { describe, expect, it, vi } from "vitest";
import { buildShareCardInput } from "../../src/components/results/share/input";
import {
  fitPreferencesSchema,
  fitResponseSchema,
  type FitEntry,
} from "../../src/lib/contracts/fit";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { loadOwnedFit } from "../../src/server/fit/core";
import { withFilterFacts } from "../../src/server/fit/filter-facts";
import type { CatalogueMouse } from "../../src/server/fit/types";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NO_PREFS = fitPreferencesSchema.parse({});

const row = (over: Partial<CatalogueMouse>): CatalogueMouse => ({
  ...sampleCatalogue[0]!,
  ...over,
});

describe("withFilterFacts", () => {
  const entry = (slug: string, extra: Partial<FitEntry> = {}): FitEntry => {
    const e = makeEntry();
    return { ...e, mouse: { ...e.mouse, slug }, ...extra };
  };

  it("copies shape and connectivity from the catalogue row", () => {
    const out = withFilterFacts(
      [entry("a")],
      [row({ slug: "a", shape: "ergonomic", connectivity: "wireless" })],
    );
    expect(out[0]!.mouse.shape).toBe("ergonomic");
    expect(out[0]!.mouse.connectivity).toBe("wireless");
  });

  it("writes null, never a guess, when the catalogue does not know", () => {
    const out = withFilterFacts(
      [entry("a"), entry("ghost")],
      [row({ slug: "a", shape: null, connectivity: undefined })],
    );
    expect(out[0]!.mouse.shape).toBeNull();
    expect(out[0]!.mouse.connectivity).toBeNull();
    expect(out[1]!.mouse.shape).toBeNull();
    expect(out[1]!.mouse.connectivity).toBeNull();
  });

  it("fills each variant's connectivity by slug and keeps the rest of it", () => {
    const out = withFilterFacts(
      [
        entry("a", {
          variants: [
            { slug: "b", model: "B", weightG: 70 },
            { slug: "c", model: "C", weightG: null },
          ],
        }),
      ],
      [
        row({ slug: "a", connectivity: "wired" }),
        row({ slug: "b", connectivity: "wireless" }),
        row({ slug: "c", connectivity: null }),
      ],
    );
    expect(out[0]!.variants).toEqual([
      { slug: "b", model: "B", weightG: 70, connectivity: "wireless" },
      { slug: "c", model: "C", weightG: null, connectivity: null },
    ]);
  });

  it("adds no variants key to an entry that had none, and changes no score", () => {
    const e = entry("a");
    const out = withFilterFacts([e], [row({ slug: "a" })]);
    expect(out[0]).not.toHaveProperty("variants");
    expect(out[0]!.total).toBe(e.total);
    expect(out[0]!.rank).toBe(e.rank);
    expect(out[0]!.subscores).toBe(e.subscores);
  });
});

describe("loadOwnedFit fills the filter facts", () => {
  it("returns shape and connectivity on every card and on same-shell variants", async () => {
    const twin: CatalogueMouse = {
      ...sampleCatalogue[0]!,
      id: "mouse-3",
      slug: "logitech-g502-se",
      model: "G502 SE",
      weightG: 130,
      connectivity: "wired",
    };
    const catalogue: CatalogueMouse[] = [
      { ...sampleCatalogue[0]!, shape: "ergonomic", connectivity: "wireless" },
      { ...sampleCatalogue[1]!, shape: "symmetrical", connectivity: null },
      { ...twin, shape: "ergonomic" },
    ];
    const { repo: fitRepo } = createFakeFitRepo(catalogue);
    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "s" },
      NO_PREFS,
      {
        scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
        fitRepo,
        now: () => new Date("2026-10-10T00:00:00Z"),
      },
    );
    if (result.status !== "ok") throw new Error("unreachable");
    const g502 = result.fit.results.find((e) =>
      e.mouse.slug.startsWith("logitech-g502"),
    )!;
    const basilisk = result.fit.results.find(
      (e) => e.mouse.slug === "razer-basilisk",
    )!;
    expect(g502.mouse.shape).toBe("ergonomic");
    expect(g502.mouse.connectivity).toBe("wireless");
    expect(g502.variants).toHaveLength(1);
    expect(g502.variants![0]!.connectivity).toBe("wired");
    expect(basilisk.mouse.shape).toBe("symmetrical");
    expect(basilisk.mouse.connectivity).toBeNull();
    expect(() => fitResponseSchema.parse(result.fit)).not.toThrow();
  });
});

// Hard rule 2: the filter's facts and the variants are display data. The LLM
// never sees or computes them.
describe("filter facts never reach the analysis or the share card", () => {
  function withAndWithout() {
    const results = [1, 2, 3, 4].map((rank) =>
      makeEntry({
        rank,
        mouse: { ...makeEntry().mouse, slug: `m-${rank}`, model: `M${rank}` },
      }),
    );
    const plain = makeFit({ results });
    const rich = makeFit({
      results: results.map((e) => ({
        ...e,
        mouse: {
          ...e.mouse,
          shape: "hybrid" as const,
          connectivity: "wireless" as const,
        },
        variants: [
          {
            slug: "x-variant",
            model: "Variant Unique",
            weightG: 987.6,
            connectivity: "wired" as const,
          },
        ],
      })),
    });
    return { plain, rich };
  }

  it("gives the same analysis input with and without the facts and variants", () => {
    const { plain, rich } = withAndWithout();
    expect(() => fitResponseSchema.parse(rich)).not.toThrow();
    const m = makeMeasurements();
    const a = buildAnalysisInput(plain, m);
    const b = buildAnalysisInput(rich, m);
    expect(b).toEqual(a);
    const json = JSON.stringify(b);
    for (const word of [
      '"shape"',
      '"connectivity"',
      '"wireless"',
      '"wired"',
      '"hybrid"',
      "variants",
      "Unique",
    ]) {
      expect(json).not.toContain(word);
    }
  });

  it("no filter fact or variant number enters the numeral allow-list", () => {
    const { plain, rich } = withAndWithout();
    const m = makeMeasurements();
    const allowed = collectNumbers(buildAnalysisInput(rich, m));
    expect(allowed.has(987.6)).toBe(false);
    expect([...allowed].sort()).toEqual(
      [...collectNumbers(buildAnalysisInput(plain, m))].sort(),
    );
  });

  it.each(["zh-TW", "en"] as const)(
    "the share card input is the same with and without them (%s)",
    (lang) => {
      const { plain, rich } = withAndWithout();
      expect(buildShareCardInput(rich, lang, null)).toEqual(
        buildShareCardInput(plain, lang, null),
      );
    },
  );
});
