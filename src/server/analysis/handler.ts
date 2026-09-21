/**
 * `handleAnalysisRequest` — a pure handler: fit response + measurements in,
 * a Response-like object out. No Next.js/route concerns here; the route
 * file (later, after #11) just calls this and adapts the result. Deps are
 * all injected so this is testable without a network, a database or a
 * clock.
 */
import type { FitResponse } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { analyse } from "./analyse";
import type { AnalysisCache } from "./cache";
import { computeCacheKey } from "./cache";
import type { TextModel } from "./client";
import { buildAnalysisInput } from "./input";
import type { AnalysisOutput } from "./schema";

/** Per-key rate limit, injected so the handler stays pure. */
export interface RateLimiter {
  /** Returns true when the request at `key` is allowed to proceed. */
  allow(key: string): boolean | Promise<boolean>;
}

export interface AnalysisRequestDeps {
  client: TextModel;
  cache: AnalysisCache;
  limiter: RateLimiter;
}

export interface AnalysisRequest {
  fit: FitResponse;
  measurements: HandMeasurements;
  /** Identity the rate limit is scoped to — e.g. scanId or caller IP. */
  rateLimitKey: string;
}

export type AnalysisResponseBody =
  | { output: AnalysisOutput; cached: boolean }
  | { error: string };

export interface AnalysisResponseLike {
  status: number;
  body: AnalysisResponseBody;
}

export async function handleAnalysisRequest(
  request: AnalysisRequest,
  deps: AnalysisRequestDeps,
): Promise<AnalysisResponseLike> {
  const allowed = await deps.limiter.allow(request.rateLimitKey);
  if (!allowed) {
    return {
      status: 429,
      body: { error: "Too many analysis requests. Try again shortly." },
    };
  }

  const cacheKey = computeCacheKey(request.fit, request.measurements);
  const cached = await deps.cache.get(cacheKey);
  if (cached) {
    return { status: 200, body: { output: cached, cached: true } };
  }

  const input = buildAnalysisInput(request.fit, request.measurements);
  const output = await analyse(input, deps.client);
  await deps.cache.set(cacheKey, output);
  return { status: 200, body: { output, cached: false } };
}
