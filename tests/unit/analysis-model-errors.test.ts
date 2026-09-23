import { afterEach, describe, expect, it, vi } from "vitest";
import { analysisResponseSchema } from "../../src/lib/contracts/analysis";
import {
  analyse,
  buildFallbackOutput,
} from "../../src/server/analysis/analyse";
import { InMemoryAnalysisCache } from "../../src/server/analysis/cache";
import { FakeTextModel } from "../../src/server/analysis/client";
import { handleAnalysisRequest } from "../../src/server/analysis/handler";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

/**
 * A model call that THROWS — as opposed to one that returns unusable text.
 *
 * Every earlier test's fake model returned a bad answer; none ever threw, so
 * the path where the call itself fails was never exercised. On 2026-09-23 the
 * live API rejected the request config, the error escaped `analyse()`, and
 * every analysis in production became a 500. This is that exact error.
 */
const LIVE_API_ERROR = new Error(
  '{"error":{"code":400,"message":"Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.","status":"INVALID_ARGUMENT"}}',
);

const throwingModel = (error: unknown) =>
  new FakeTextModel({
    answer: () => {
      throw error;
    },
  });

describe("a model call that throws", () => {
  afterEach(() => vi.restoreAllMocks());

  it("analyse() returns the deterministic fallback instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const input = buildAnalysisInput(makeFit(), makeMeasurements());
    const client = throwingModel(LIVE_API_ERROR);

    const result = await analyse(input, client);

    expect(result.source).toBe("fallback");
    expect(result.output).toEqual(buildFallbackOutput(input));
  });

  it("does not retry a failed call — rephrasing the prompt cannot fix it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = throwingModel(LIVE_API_ERROR);

    await analyse(buildAnalysisInput(makeFit(), makeMeasurements()), client);

    expect(client.calls).toHaveLength(1);
  });

  it.each([
    ["an API error", LIVE_API_ERROR],
    ["a network error", new TypeError("fetch failed")],
    ["a non-Error rejection", "timeout"],
  ])(
    "the route answers 200 with honest provenance for %s",
    async (_label, error) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const cache = new InMemoryAnalysisCache();

      const response = await handleAnalysisRequest(
        {
          fit: makeFit(),
          measurements: makeMeasurements(),
          rateLimitKey: "ip-1",
        },
        { client: throwingModel(error), cache, limiter: { allow: () => true } },
      );

      expect(response.status).toBe(200);
      const body = analysisResponseSchema.parse(response.body);
      expect(body.source).toBe("fallback");
      expect(body.cached).toBe(false);
    },
  );

  it("does not cache the fallback served after a failed call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = new InMemoryAnalysisCache();
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "ip-1",
    };
    const deps = { cache, limiter: { allow: () => true } };

    await handleAnalysisRequest(request, {
      ...deps,
      client: throwingModel(LIVE_API_ERROR),
    });
    const healthy = new FakeTextModel({ answer: () => "not json" });
    await handleAnalysisRequest(request, { ...deps, client: healthy });

    // Had the fallback been cached, the second request would never reach
    // the model. It must, so a transient failure is not frozen in place.
    expect(healthy.calls.length).toBeGreaterThan(0);
  });
});
