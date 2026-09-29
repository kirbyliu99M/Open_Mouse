import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it, vi } from "vitest";
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

function neverAllow(): RateLimiter {
  return { allow: () => false };
}

describe("handleAnalysisRequest", () => {
  it("calls the model for scan B after caching identical fit data for scan A", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    const request = {
      scanId: "scan-a",
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "user-1",
    };
    const deps = {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    };

    expect((await handleAnalysisRequest(request, deps)).body).toMatchObject({
      cached: false,
    });
    expect(
      (await handleAnalysisRequest({ ...request, scanId: "scan-b" }, deps))
        .body,
    ).toMatchObject({ cached: false });
    expect(client.calls).toHaveLength(2);
    expect((await handleAnalysisRequest(request, deps)).body).toMatchObject({
      cached: true,
    });
    expect(client.calls).toHaveLength(2);
  });
  it("returns 429 when the rate limiter rejects the request", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const response = await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        scanId: "scan-a",
        rateLimitKey: "user-1",
      },
      {
        client,
        cache: new InMemoryAnalysisCache(),
        limiter: neverAllow(),
        globalLimiter: alwaysAllow(),
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
      scanId: "scan-a",
      rateLimitKey: "user-1",
    };
    const deps = {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    };

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
      scanId: "scan-a",
      rateLimitKey: "user-1",
    };
    const deps = {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    };

    const first = await handleAnalysisRequest(request, deps);
    expect(first.body).toMatchObject({ cached: false, source: "fallback" });
    expect(client.calls).toHaveLength(2); // one attempt + one retry

    const key = computeCacheKey(request.fit, request.measurements);
    expect(await cache.get(request.scanId, key)).toBeNull();

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
      scanId: "scan-a",
      rateLimitKey: "user-1",
    };
    const response = await handleAnalysisRequest(request, {
      client: null,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ cached: false, source: "fallback" });
    const key = computeCacheKey(request.fit, request.measurements);
    expect(await cache.get(request.scanId, key)).toBeNull();
  });

  it("stores the result under the same key computeCacheKey would produce", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    const fit = makeFit();
    const measurements = makeMeasurements();
    await handleAnalysisRequest(
      { scanId: "scan-a", fit, measurements, rateLimitKey: "user-1" },
      {
        client,
        cache,
        limiter: alwaysAllow(),
        globalLimiter: alwaysAllow(),
      },
    );
    const key = computeCacheKey(fit, measurements);
    expect(await cache.get("scan-a", key)).not.toBeNull();
  });

  it("a 200 body — fresh, cached, and no-model-configured — always validates against analysisResponseSchema", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      scanId: "scan-a",
      rateLimitKey: "user-1",
    };
    const deps = {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    };

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
        globalLimiter: alwaysAllow(),
      },
    );
    expect(analysisResponseSchema.safeParse(noModel.body).success).toBe(true);
  });

  it("consults the limiter on a cache miss with a model configured, immediately before the model call", async () => {
    const calls: string[] = [];
    // One shared log, so the test proves the ORDER — limit before spend —
    // and not merely that both happened.
    const events: string[] = [];
    const limiter: RateLimiter = {
      allow: (key) => {
        calls.push(key);
        events.push("limiter");
        return true;
      },
    };
    const client = new FakeTextModel({
      answer: () => {
        events.push("model");
        return CLEAN_ANSWER;
      },
    });
    const response = await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        scanId: "scan-a",
        rateLimitKey: "user-1",
      },
      {
        client,
        cache: new InMemoryAnalysisCache(),
        limiter,
        globalLimiter: alwaysAllow(),
      },
    );
    expect(calls).toEqual(["user-1"]);
    expect(events).toEqual(["limiter", "model"]);
    expect(response.status).toBe(200);
    expect(client.calls).toHaveLength(1);
  });

  it("refuses a cache-miss model call with the unchanged 429 body and status once the limiter says no", async () => {
    const limiter: RateLimiter = neverAllow();
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const response = await handleAnalysisRequest(
      {
        fit: makeFit(),
        measurements: makeMeasurements(),
        scanId: "scan-a",
        rateLimitKey: "user-1",
      },
      {
        client,
        cache: new InMemoryAnalysisCache(),
        limiter,
        globalLimiter: alwaysAllow(),
      },
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
      scanId: "scan-a",
      rateLimitKey: "user-1",
    };
    // Prime the cache with a real model answer via a permissive limiter.
    await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
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
      globalLimiter: spyLimiter,
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
        scanId: "scan-a",
        rateLimitKey: "user-1",
      },
      {
        client: null,
        cache: new InMemoryAnalysisCache(),
        limiter: spyLimiter,
        globalLimiter: spyLimiter,
      },
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
        scanId: "scan-a",
        rateLimitKey: "scan-42",
      },
      {
        client,
        cache: new InMemoryAnalysisCache(),
        limiter,
        globalLimiter: alwaysAllow(),
      },
    );
    expect(seen).toEqual(["scan-42"]);
  });
});

describe("handleAnalysisRequest — site-wide daily model cap (M1)", () => {
  const request = {
    fit: makeFit(),
    measurements: makeMeasurements(),
    scanId: "scan-a",
    rateLimitKey: "user-1",
  };

  it("serves the deterministic fallback with 200 (never 429) once the global cap is hit, and never calls the model", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const response = await handleAnalysisRequest(request, {
      client,
      cache: new InMemoryAnalysisCache(),
      limiter: alwaysAllow(),
      globalLimiter: neverAllow(),
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ source: "fallback", cached: false });
    expect(client.calls).toHaveLength(0);
    expect(analysisResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it("does not cache the global-cap fallback — the next request (once the cap allows again) still calls the model", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: neverAllow(),
    });
    const key = computeCacheKey(request.fit, request.measurements);
    expect(await cache.get(request.scanId, key)).toBeNull();

    const second = await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    });
    expect(second.body).toMatchObject({ source: "model", cached: false });
    expect(client.calls).toHaveLength(1);
  });

  it("consults the global limiter only after the per-IP limiter allows, still before the model call", async () => {
    const events: string[] = [];
    const perIp: RateLimiter = {
      allow: () => {
        events.push("limiter");
        return true;
      },
    };
    const global: RateLimiter = {
      allow: () => {
        events.push("globalLimiter");
        return true;
      },
    };
    const client = new FakeTextModel({
      answer: () => {
        events.push("model");
        return CLEAN_ANSWER;
      },
    });
    const response = await handleAnalysisRequest(request, {
      client,
      cache: new InMemoryAnalysisCache(),
      limiter: perIp,
      globalLimiter: global,
    });
    expect(events).toEqual(["limiter", "globalLimiter", "model"]);
    expect(response.status).toBe(200);
  });

  it("does not consult the global limiter when the per-IP limiter already refused (still 429, not the fallback)", async () => {
    const calls: string[] = [];
    const spyGlobal: RateLimiter = {
      allow: () => {
        calls.push("called");
        return false;
      },
    };
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const response = await handleAnalysisRequest(request, {
      client,
      cache: new InMemoryAnalysisCache(),
      limiter: neverAllow(),
      globalLimiter: spyGlobal,
    });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it("never consults the global limiter on a cache hit", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = new InMemoryAnalysisCache();
    await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    });

    const calls: string[] = [];
    const spyGlobal: RateLimiter = {
      allow: () => {
        calls.push("called");
        return false; // would force a fallback if ever consulted
      },
    };
    const response = await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: spyGlobal,
    });
    expect(response.body).toMatchObject({ cached: true, source: "model" });
    expect(calls).toHaveLength(0);
  });

  it("never consults the global limiter when no model is configured", async () => {
    const calls: string[] = [];
    const spyGlobal: RateLimiter = {
      allow: () => {
        calls.push("called");
        return false;
      },
    };
    const response = await handleAnalysisRequest(request, {
      client: null,
      cache: new InMemoryAnalysisCache(),
      limiter: alwaysAllow(),
      globalLimiter: spyGlobal,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ source: "fallback" });
    expect(calls).toHaveLength(0);
  });

  // M2 (hardening finding): the cap used to be spent once per REQUEST, but
  // analyse() can make up to two real model calls per request (one attempt
  // plus one retry), so the real ceiling was ~2x the configured cap. Every
  // actual model call must now spend its own unit.
  it("M2: a clean request (no retry) spends exactly one global-limiter unit", async () => {
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    let units = 0;
    const response = await handleAnalysisRequest(request, {
      client,
      cache: new InMemoryAnalysisCache(),
      limiter: alwaysAllow(),
      globalLimiter: {
        allow: () => {
          units += 1;
          return true;
        },
      },
    });
    expect(response.body).toMatchObject({ source: "model" });
    expect(units).toBe(1);
    expect(client.calls).toHaveLength(1);
  });

  it("M2: a request whose first answer needs a retry spends two global-limiter units, one per real model call", async () => {
    const badAnswer = JSON.stringify({ oops: true }); // fails schema, forces a retry
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    let units = 0;
    const response = await handleAnalysisRequest(request, {
      client,
      cache: new InMemoryAnalysisCache(),
      limiter: alwaysAllow(),
      globalLimiter: {
        allow: () => {
          units += 1;
          return true;
        },
      },
    });
    expect(response.body).toMatchObject({ source: "model" });
    expect(units).toBe(2);
    expect(client.calls).toHaveLength(2);
  });

  it("M2: cap exhausted between the attempt and the retry stops retrying -- fallback, never a second model call", async () => {
    const badAnswer = JSON.stringify({ oops: true }); // would normally force a retry
    const client = new FakeTextModel({ answer: () => badAnswer });
    let units = 0;
    const response = await handleAnalysisRequest(request, {
      client,
      cache: new InMemoryAnalysisCache(),
      limiter: alwaysAllow(),
      globalLimiter: {
        // Allows the first attempt, then the cap is hit before the retry.
        allow: () => {
          units += 1;
          return units === 1;
        },
      },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ source: "fallback", cached: false });
    // Only the first attempt actually reached the model.
    expect(client.calls).toHaveLength(1);
    expect(units).toBe(2);
  });
});

describe("handleAnalysisRequest — the cache never fails a request", () => {
  const request = {
    scanId: "scan-a",
    fit: makeFit(),
    measurements: makeMeasurements(),
    rateLimitKey: "user-1",
  };
  // What a Postgres constraint error looks like: its detail quotes the row.
  // Shaped like production: Drizzle wraps the driver's error, and its own
  // message quotes the query params — here, the prose.
  const dbError = new DrizzleQueryError(
    "insert into analysis_cache ...",
    ["It's 125 mm long, right in your ideal range."],
    Object.assign(new Error("null value in column"), {
      code: "23502",
      detail:
        "Failing row contains (It's 125 mm long, right in your ideal range.)",
    }),
  );

  it("treats a failing read as a miss and still answers 200 from the model", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = {
      get: vi.fn(async () => {
        throw dbError;
      }),
      set: vi.fn(async () => {}),
    };
    const res = await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "model", cached: false });
    expect(client.calls).toHaveLength(1);
    errors.mockRestore();
  });

  it("skips a failing write and still answers 200, logging only the error code", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const cache = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw dbError;
      }),
    };
    const res = await handleAnalysisRequest(request, {
      client,
      cache,
      limiter: alwaysAllow(),
      globalLimiter: alwaysAllow(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "model", cached: false });
    const logged = errors.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("23502");
    expect(logged).not.toContain("125 mm");
    expect(logged).not.toContain("null value");
    errors.mockRestore();
  });
});
