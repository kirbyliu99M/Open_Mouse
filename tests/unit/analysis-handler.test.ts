import { describe, expect, it } from "vitest";
import {
  handleAnalysisRequest,
  type RateLimiter,
} from "../../src/server/analysis/handler";
import {
  InMemoryAnalysisCache,
  computeCacheKey,
} from "../../src/server/analysis/cache";
import { FakeTextModel } from "../../src/server/analysis/client";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

const CLEAN_ANSWER = JSON.stringify({
  headline: "A strong match for your hand.",
  whyTopPick: "It's 125 mm long, right in your ideal range.",
  tradeoffs: [],
  whatToAvoid: [],
  caveats: [],
});

function alwaysAllow(): RateLimiter {
  return { allow: () => true };
}

describe("handleAnalysisRequest", () => {
  it("returns 429 when the rate limiter rejects the request", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const response = await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        rateLimitKey: "user-1",
      },
      {
        client,
        cache: new InMemoryAnalysisCache(),
        limiter: { allow: () => false },
      },
    );
    expect(response.status).toBe(429);
    expect(client.calls).toHaveLength(0);
  });

  it("misses the cache on the first call, then hits it on the second", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "user-1",
    };
    const deps = { client, cache, limiter: alwaysAllow() };

    const first = await handleAnalysisRequest(request, deps);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ cached: false });
    expect(client.calls).toHaveLength(1);

    const second = await handleAnalysisRequest(request, deps);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ cached: true });
    // No second model call — the cache served it.
    expect(client.calls).toHaveLength(1);
    if ("output" in first.body && "output" in second.body) {
      expect(second.body.output).toEqual(first.body.output);
    }
  });

  it("stores the result under the same key computeCacheKey would produce", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    const fit = makeFit();
    const measurements = makeMeasurements();
    await handleAnalysisRequest(
      { fit, measurements, rateLimitKey: "user-1" },
      { client, cache, limiter: alwaysAllow() },
    );
    const key = computeCacheKey(fit, measurements);
    expect(await cache.get(key)).not.toBeNull();
  });

  it("scopes the rate limit check to the given key", async () => {
    const seen: string[] = [];
    const limiter: RateLimiter = {
      allow: (key) => {
        seen.push(key);
        return true;
      },
    };
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        rateLimitKey: "scan-42",
      },
      { client, cache: new InMemoryAnalysisCache(), limiter },
    );
    expect(seen).toEqual(["scan-42"]);
  });
});
