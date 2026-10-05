import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { FitResponse } from "../../src/lib/contracts/fit";
import {
  buildAnalysisInput,
  type AnalysisInput,
} from "../../src/server/analysis/input";
import { buildPrompt } from "../../src/server/analysis/analyse";
import {
  ANALYSIS_PROMPT_VERSION,
  canonicalize,
  computeCacheKey,
  InMemoryAnalysisCache,
  type CachedAnalysis,
} from "../../src/server/analysis/cache";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

const CACHED: CachedAnalysis = {
  output: {
    headline: "h",
    whyTopPick: "w",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [],
  },
  source: "model",
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("computeCacheKey", () => {
  it("uses prompt version 6", () => {
    expect(ANALYSIS_PROMPT_VERSION).toBe(6);
  });
  it("is deterministic for the same fit and measurements (identical input -> same key)", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    expect(computeCacheKey(fit, measurements)).toBe(
      computeCacheKey(fit, measurements),
    );
  });

  it("matches sha256(promptVersion + the canonical first prompt) exactly, so ANALYSIS_PROMPT_VERSION participates", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    const prompt = buildPrompt(
      canonicalize(buildAnalysisInput(fit, measurements)) as AnalysisInput,
    );
    const key = computeCacheKey(fit, measurements);
    expect(key).toBe(
      sha256(`${ANALYSIS_PROMPT_VERSION}
${prompt}`),
    );
    expect(key).not.toBe(
      sha256(`${ANALYSIS_PROMPT_VERSION + 1}
${prompt}`),
    );
  });

  it("is a 64-character hex sha256 digest", () => {
    const key = computeCacheKey(makeFit(), makeMeasurements());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of an object's own key insertion order (gripStyle, same values, different literal order)", () => {
    const measurements = makeMeasurements();
    const fitA = makeFit({
      gripStyle: { stated: "palm", predicted: "claw", used: "claw" },
    });
    const fitB = makeFit({
      gripStyle: {
        used: "claw",
        predicted: "claw",
        stated: "palm",
      } as FitResponse["gripStyle"],
    });
    expect(computeCacheKey(fitA, measurements)).toBe(
      computeCacheKey(fitB, measurements),
    );
  });

  it("does not vary with engineVersion alone — it is never part of what the model sees", () => {
    // engineVersion never reaches AnalysisInput/promptData (analyse.ts
    // asserts this directly in its own test suite); a build tag changing
    // with every shown value unchanged must not be treated as a new prompt.
    const measurements = makeMeasurements();
    const a = computeCacheKey(
      makeFit({ engineVersion: "fit-v0-provisional" }),
      measurements,
    );
    const b = computeCacheKey(
      makeFit({ engineVersion: "fit-v9-different" }),
      measurements,
    );
    expect(a).toBe(b);
  });

  it("changes when grip used changes", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    const base = computeCacheKey(fit, measurements);
    expect(
      computeCacheKey(
        makeFit({
          gripStyle: { stated: "palm", predicted: "claw", used: "palm" },
        }),
        measurements,
      ),
    ).not.toBe(base);
  });

  it("does not change when only a slug changes (slugs never reach the prompt)", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    const base = computeCacheKey(fit, measurements);
    expect(
      computeCacheKey(
        makeFit({
          results: [
            {
              ...fit.results[0]!,
              mouse: { ...fit.results[0]!.mouse, slug: "different-slug" },
            },
          ],
        }),
        measurements,
      ),
    ).toBe(base);
  });

  it("changes when a top-3 model name changes", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    const base = computeCacheKey(fit, measurements);
    expect(
      computeCacheKey(
        makeFit({
          results: [
            {
              ...fit.results[0]!,
              mouse: { ...fit.results[0]!.mouse, model: "A Different Mouse" },
            },
          ],
        }),
        measurements,
      ),
    ).not.toBe(base);
  });

  // H1 (security fix, reviewer's scenario): the prompt carries the
  // weight-preference range via each entry's `weight` sub-score reason
  // params (minG/maxG/deltaG — see `src/server/fit/subscores.ts`). A prior
  // version of computeCacheKey ignored these entirely, so two requests for
  // the same scan with different weight preferences but the same top-3
  // mice collided on the same cache key — the second request then got
  // prose written for the FIRST preference, quoting a number (e.g. "25")
  // that never appeared in the second request's own input.
  it("H1: two different weight preferences with the same top-3 mice produce different keys", () => {
    const measurements = makeMeasurements();
    const narrowPref = makeFit({
      results: [
        {
          ...makeFit().results[0]!,
          subscores: {
            ...makeFit().results[0]!.subscores,
            weight: {
              score: 90,
              weight: 1 / 6,
              reason: {
                code: "weight_in_range",
                params: { minG: 20, maxG: 25 },
              },
            },
          },
        },
      ],
    });
    const widePref = makeFit({
      results: [
        {
          ...makeFit().results[0]!,
          subscores: {
            ...makeFit().results[0]!.subscores,
            weight: {
              score: 90,
              weight: 1 / 6,
              reason: {
                code: "weight_in_range",
                params: { minG: 195, maxG: 200 },
              },
            },
          },
        },
      ],
    });
    // Same top-3 slug, same total/confidence — only the weight preference
    // (reflected in the reason params the model is shown) differs.
    expect(narrowPref.results[0]!.mouse.slug).toBe(
      widePref.results[0]!.mouse.slug,
    );
    expect(computeCacheKey(narrowPref, measurements)).not.toBe(
      computeCacheKey(widePref, measurements),
    );
  });

  // H1: `includeVertical` changes which mice are excluded (see
  // `src/server/fit/exclusions.ts`), which reaches the model via
  // `AnalysisInput.excluded` — a prior version of computeCacheKey never
  // looked at `excluded` at all.
  it("H1: toggling includeVertical (a different excluded list) produces a different key", () => {
    const measurements = makeMeasurements();
    const fitA = makeFit(); // fixture's default excluded: one vertical mouse
    const fitB = makeFit({ excluded: [] }); // includeVertical: true -> nothing excluded
    expect(computeCacheKey(fitA, measurements)).not.toBe(
      computeCacheKey(fitB, measurements),
    );
  });

  it("hashes the one-decimal-mm value the model actually sees, not the raw float", () => {
    const fit = makeFit();
    // oneDecimal(180.44) === oneDecimal(180.36) === 180.4
    const a = computeCacheKey(fit, makeMeasurements({ handLengthMm: 180.44 }));
    const b = computeCacheKey(fit, makeMeasurements({ handLengthMm: 180.36 }));
    expect(a).toBe(b);
    // oneDecimal(180.46) === 180.5 -- a genuinely different shown value.
    const c = computeCacheKey(fit, makeMeasurements({ handLengthMm: 180.46 }));
    expect(a).not.toBe(c);
  });
});

describe("canonicalize", () => {
  it("sorts object keys recursively but preserves array element order", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(canonicalize([3, 1, 2]))).toBe(
      JSON.stringify([3, 1, 2]),
    );
  });
});

describe("InMemoryAnalysisCache", () => {
  it("keeps the same key under two scan IDs independent", async () => {
    const cache = new InMemoryAnalysisCache();
    await cache.set("scan-a", "shared-key", CACHED);
    expect(await cache.get("scan-b", "shared-key")).toBeNull();
    expect(await cache.get("scan-a", "shared-key")).toEqual(CACHED);
  });

  it("distinguishes scan ID and key pairs that concatenate identically", async () => {
    const cache = new InMemoryAnalysisCache();
    await cache.set("ab", "c", CACHED);
    const other = {
      ...CACHED,
      output: { ...CACHED.output, headline: "other" },
    };
    await cache.set("a", "bc", other);
    expect(await cache.get("ab", "c")).toEqual(CACHED);
    expect(await cache.get("a", "bc")).toEqual(other);
  });
  it("misses before a set, hits after", async () => {
    const cache = new InMemoryAnalysisCache();
    const key = computeCacheKey(makeFit(), makeMeasurements());
    expect(await cache.get("scan-a", key)).toBeNull();
    await cache.set("scan-a", key, CACHED);
    expect(await cache.get("scan-a", key)).toEqual(CACHED);
  });

  it("misses for a different key", async () => {
    const cache = new InMemoryAnalysisCache();
    await cache.set(
      "scan-a",
      computeCacheKey(makeFit(), makeMeasurements()),
      CACHED,
    );
    const otherKey = computeCacheKey(
      makeFit({
        results: [
          {
            ...makeFit().results[0]!,
            mouse: { ...makeFit().results[0]!.mouse, model: "Other Mouse" },
          },
        ],
      }),
      makeMeasurements(),
    );
    expect(await cache.get("scan-a", otherKey)).toBeNull();
  });

  it("stores and returns the provenance alongside the output", async () => {
    const cache = new InMemoryAnalysisCache();
    const key = computeCacheKey(makeFit(), makeMeasurements());
    await cache.set("scan-a", key, CACHED);
    const result = await cache.get("scan-a", key);
    expect(result?.source).toBe("model");
    expect(result?.output).toEqual(CACHED.output);
  });
});
