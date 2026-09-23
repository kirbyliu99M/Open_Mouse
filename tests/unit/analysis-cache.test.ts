import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ANALYSIS_PROMPT_VERSION,
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

describe("computeCacheKey", () => {
  it("is deterministic for the same fit and measurements", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    expect(computeCacheKey(fit, measurements)).toBe(
      computeCacheKey(fit, measurements),
    );
  });

  it("rounds measurements to the nearest 1 mm before hashing", () => {
    const fit = makeFit();
    const a = computeCacheKey(fit, makeMeasurements({ handLengthMm: 180.4 }));
    const b = computeCacheKey(fit, makeMeasurements({ handLengthMm: 180.49 }));
    const c = computeCacheKey(fit, makeMeasurements({ handLengthMm: 179.4 }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("changes when engineVersion, grip used, or top-3 slugs change", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    const base = computeCacheKey(fit, measurements);

    expect(
      computeCacheKey(makeFit({ engineVersion: "fit-v1" }), measurements),
    ).not.toBe(base);

    expect(
      computeCacheKey(
        makeFit({
          gripStyle: { stated: "palm", predicted: "claw", used: "palm" },
        }),
        measurements,
      ),
    ).not.toBe(base);

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
    ).not.toBe(base);
  });

  it("includes ANALYSIS_PROMPT_VERSION, so a prompt change invalidates old answers", () => {
    const fit = makeFit();
    const measurements = makeMeasurements();
    const payloadWith = (promptVersion: number) =>
      JSON.stringify({
        promptVersion,
        engineVersion: fit.engineVersion,
        gripUsed: fit.gripStyle.used,
        measurements: { handLengthMm: 180, palmLengthMm: 105, palmWidthMm: 85 },
        top3Slugs: fit.results.slice(0, 3).map((r) => r.mouse.slug),
      });
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const key = computeCacheKey(fit, measurements);
    expect(key).toBe(sha(payloadWith(ANALYSIS_PROMPT_VERSION)));
    expect(key).not.toBe(sha(payloadWith(ANALYSIS_PROMPT_VERSION + 1)));
  });

  it("is a 64-character hex sha256 digest", () => {
    const key = computeCacheKey(makeFit(), makeMeasurements());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
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
      makeFit({ engineVersion: "fit-v1" }),
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
