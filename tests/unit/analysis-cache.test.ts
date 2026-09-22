import { describe, expect, it } from "vitest";
import {
  computeCacheKey,
  InMemoryAnalysisCache,
} from "../../src/server/analysis/cache";
import { makeFit, makeMeasurements } from "./analysis-fixtures";
import type { AnalysisOutput } from "../../src/server/analysis/schema";

const OUTPUT: AnalysisOutput = {
  headline: "h",
  whyTopPick: "w",
  tradeoffs: [],
  whatToAvoid: [],
  caveats: [],
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

  it("is a 64-character hex sha256 digest", () => {
    const key = computeCacheKey(makeFit(), makeMeasurements());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("InMemoryAnalysisCache", () => {
  it("misses before a set, hits after", async () => {
    const cache = new InMemoryAnalysisCache();
    const key = computeCacheKey(makeFit(), makeMeasurements());
    expect(await cache.get(key)).toBeNull();
    await cache.set(key, OUTPUT);
    expect(await cache.get(key)).toEqual(OUTPUT);
  });

  it("misses for a different key", async () => {
    const cache = new InMemoryAnalysisCache();
    await cache.set(computeCacheKey(makeFit(), makeMeasurements()), OUTPUT);
    const otherKey = computeCacheKey(
      makeFit({ engineVersion: "fit-v1" }),
      makeMeasurements(),
    );
    expect(await cache.get(otherKey)).toBeNull();
  });
});
