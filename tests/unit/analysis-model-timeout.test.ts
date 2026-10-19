import { afterEach, describe, expect, it, vi } from "vitest";
import { analysisResponseSchema } from "../../src/lib/contracts/analysis";
import {
  analyse,
  buildFallbackOutput,
} from "../../src/server/analysis/analyse";
import { InMemoryAnalysisCache } from "../../src/server/analysis/cache";
import {
  FakeTextModel,
  type TextModelArgs,
} from "../../src/server/analysis/client";
import { handleAnalysisRequest } from "../../src/server/analysis/handler";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { ANALYSIS_MODEL_TIMEOUT_MS } from "../../src/server/analysis/model-config";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A model that never answers and ignores the abort signal entirely. */
const hangingModel = () =>
  new FakeTextModel({ answer: () => new Promise<string>(() => {}) });

describe("the model call deadline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is 20 seconds, inside the route's 30-second maxDuration", () => {
    expect(ANALYSIS_MODEL_TIMEOUT_MS).toBe(20_000);
  });

  it("serves the fallback when the model never answers", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = buildAnalysisInput(makeFit(), makeMeasurements(), "en");
    const client = hangingModel();

    const result = await analyse(input, client, { modelTimeoutMs: 30 });

    expect(result.source).toBe("fallback");
    expect(result.output).toEqual(buildFallbackOutput(input));
    expect(client.calls).toHaveLength(1);
    const line = JSON.parse(String(spy.mock.calls[0]![0]));
    expect(line).toMatchObject({
      event: "analysis.model_call_failed",
      status: "timeout",
    });
  });

  it("hands the client a signal that aborts at the deadline", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let seen: AbortSignal | undefined;
    const client = new FakeTextModel({
      answer: (args: TextModelArgs) => {
        seen = args.signal;
        return new Promise<string>((_, reject) => {
          args.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      },
    });

    const result = await analyse(
      buildAnalysisInput(makeFit(), makeMeasurements(), "en"),
      client,
      { modelTimeoutMs: 30 },
    );

    expect(result.source).toBe("fallback");
    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(true);
  });

  it("does not retry once the deadline has passed", async () => {
    const client = new FakeTextModel({
      answer: async () => {
        await sleep(60);
        return "not json";
      },
    });

    const result = await analyse(
      buildAnalysisInput(makeFit(), makeMeasurements(), "en"),
      client,
      { modelTimeoutMs: 20 },
    );

    expect(result.source).toBe("fallback");
    expect(client.calls).toHaveLength(1);
  });

  it("still retries inside the deadline", async () => {
    const client = new FakeTextModel({ answer: () => "not json" });

    await analyse(
      buildAnalysisInput(makeFit(), makeMeasurements(), "en"),
      client,
    );

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(client.calls[1]!.signal).toBe(client.calls[0]!.signal);
  });

  it("answers 200 as a fallback and writes nothing to the cache on a timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = new InMemoryAnalysisCache();
    const set = vi.spyOn(cache, "set");
    const request = {
      fit: makeFit(),
      measurements: makeMeasurements(),
      scanId: "scan-a",
      rateLimitKey: "ip-1",
      locale: "en" as const,
    };

    // The handler passes no timeout of its own, so run analyse's default
    // deadline down with fake timers is not possible (AbortSignal.timeout
    // ignores them); a client that rejects at the deadline stands in.
    const timedOut = new FakeTextModel({
      answer: () =>
        Promise.reject(new DOMException("timed out", "TimeoutError")),
    });
    const response = await handleAnalysisRequest(request, {
      client: timedOut,
      cache,
      limiter: { allow: () => true },
      globalLimiter: { allow: () => true },
    });

    expect(response.status).toBe(200);
    const body = analysisResponseSchema.parse(response.body);
    expect(body.source).toBe("fallback");
    expect(set).not.toHaveBeenCalled();
  });
});
