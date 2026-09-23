import { describe, expect, it } from "vitest";
import { analysisResponseSchema } from "../../src/lib/contracts/analysis";
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
    expect(first.body).toMatchObject({ cached: false, source: "model" });
    expect(client.calls).toHaveLength(1);

    const second = await handleAnalysisRequest(request, deps);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ cached: true, source: "model" });
    // No second model call — the cache served it.
    expect(client.calls).toHaveLength(1);
    if ("output" in first.body && "output" in second.body) {
      expect(second.body.output).toEqual(first.body.output);
    }
  });

  it("does not cache a fallback result — the next request still calls the model", async () => {
    // Every attempt fails schema validation, so analyse() falls back both
    // times: source must be "fallback" and, per issue #28 acceptance
    // criterion 2, a fallback must never be cached.
    const client = new FakeTextModel({
      answer: () => JSON.stringify({ oops: true }),
    });
    const cache = new InMemoryAnalysisCache();
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "user-1",
    };
    const deps = { client, cache, limiter: alwaysAllow() };

    const first = await handleAnalysisRequest(request, deps);
    expect(first.body).toMatchObject({ cached: false, source: "fallback" });
    expect(client.calls).toHaveLength(2); // one attempt + one retry

    const key = computeCacheKey(request.fit, request.measurements);
    expect(await cache.get(key)).toBeNull();

    // Nothing was cached, so the second request calls the model again.
    const second = await handleAnalysisRequest(request, deps);
    expect(second.body).toMatchObject({ cached: false, source: "fallback" });
    expect(client.calls).toHaveLength(4);
  });

  it("with no model configured (client is null), returns a fallback and never touches the cache", async () => {
    const cache = new InMemoryAnalysisCache();
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "user-1",
    };
    const response = await handleAnalysisRequest(request, {
      client: null,
      cache,
      limiter: alwaysAllow(),
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cached: false, source: "fallback" });
    const key = computeCacheKey(request.fit, request.measurements);
    expect(await cache.get(key)).toBeNull();
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

  it("a 200 body — fresh, cached, and no-model-configured — always validates against analysisResponseSchema", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "user-1",
    };
    const deps = { client, cache, limiter: alwaysAllow() };

    const fresh = await handleAnalysisRequest(request, deps);
    expect(analysisResponseSchema.safeParse(fresh.body).success).toBe(true);

    const cached = await handleAnalysisRequest(request, deps);
    expect(analysisResponseSchema.safeParse(cached.body).success).toBe(true);

    const noModel = await handleAnalysisRequest(
      { ...request, rateLimitKey: "user-2" },
      {
        client: null,
        cache: new InMemoryAnalysisCache(),
        limiter: alwaysAllow(),
      },
    );
    expect(analysisResponseSchema.safeParse(noModel.body).success).toBe(true);
  });

  it("consults the limiter on a cache miss with a model configured, immediately before the model call", async () => {
    const calls: string[] = [];
    const limiter: RateLimiter = {
      allow: (key) => {
        calls.push(key);
        return true;
      },
    };
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const response = await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        rateLimitKey: "user-1",
      },
      { client, cache: new InMemoryAnalysisCache(), limiter },
    );
    expect(calls).toEqual(["user-1"]);
    expect(response.status).toBe(200);
    expect(client.calls).toHaveLength(1);
  });

  it("refuses a cache-miss model call with the unchanged 429 body and status once the limiter says no", async () => {
    const limiter: RateLimiter = { allow: () => false };
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const response = await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        rateLimitKey: "user-1",
      },
      { client, cache: new InMemoryAnalysisCache(), limiter },
    );
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: "Too many analysis requests. Try again shortly.",
    });
    // Refused before the model was ever called — no quota-free model spend.
    expect(client.calls).toHaveLength(0);
  });

  it("never consults the limiter on a cache hit", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "user-1",
    };
    // Prime the cache with a real model answer via a permissive limiter.
    await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
    });

    const calls: string[] = [];
    const spyLimiter: RateLimiter = {
      allow: (key) => {
        calls.push(key);
        return false; // would refuse if ever consulted
      },
    };
    const response = await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: spyLimiter,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cached: true, source: "model" });
    expect(calls).toHaveLength(0);
  });

  it("never consults the limiter when no model is configured", async () => {
    const calls: string[] = [];
    const spyLimiter: RateLimiter = {
      allow: (key) => {
        calls.push(key);
        return false; // would refuse if ever consulted
      },
    };
    const response = await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        rateLimitKey: "user-1",
      },
      { client: null, cache: new InMemoryAnalysisCache(), limiter: spyLimiter },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cached: false, source: "fallback" });
    expect(calls).toHaveLength(0);
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
