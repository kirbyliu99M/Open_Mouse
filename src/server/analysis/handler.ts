/**
 * `handleAnalysisRequest` — a pure handler: fit response + measurements in,
 * a Response-like object out. No Next.js/route concerns here; the route
 * file (later, after #11) just calls this and adapts the result. Deps are
 * all injected so this is testable without a network, a database or a
 * clock.
 */
import type { AnalysisResponse } from "../../lib/contracts/analysis";
import type { FitResponse } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { analyse } from "./analyse";
import type { AnalysisCache } from "./cache";
import { computeCacheKey } from "./cache";
import type { TextModel } from "./client";
import { buildAnalysisInput } from "./input";

/** Per-key rate limit, injected so the handler stays pure. */
export interface RateLimiter {
  /** Returns true when the request at `key` is allowed to proceed. */
  allow(key: string): boolean | Promise<boolean>;
}

export interface AnalysisRequestDeps {
  /** `null` when no model is configured — see `createAnalysisModel`. */
  client: TextModel | null;
  cache: AnalysisCache;
  limiter: RateLimiter;
}

export interface AnalysisRequest {
  scanId: string;
  fit: FitResponse;
  measurements: HandMeasurements;
  /** Identity the rate limit is scoped to — e.g. scanId or caller IP. */
  rateLimitKey: string;
}

/** The 200 body is exactly the contract's `AnalysisResponse` shape. */
export type AnalysisResponseBody = AnalysisResponse | { error: string };

export interface AnalysisResponseLike {
  status: number;
  body: AnalysisResponseBody;
}

/**
 * The cache is an optimisation, never a reason to fail: a read error is a
 * miss, a write error is skipped. Both happen for real — during a deploy
 * the code and the `analysis_cache` schema can briefly disagree, and a scan
 * deleted mid-analysis makes the insert hit its foreign key. Only the
 * Postgres error code is logged: a constraint error's detail can quote the
 * failing row, which here is prose about the user's hand.
 */
function logCacheFailure(op: "get" | "set", error: unknown): void {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "none";
  console.error(
    `analysis cache ${op} failed (code ${code}); continuing without it`,
  );
}

export async function handleAnalysisRequest(
  request: AnalysisRequest,
  deps: AnalysisRequestDeps,
): Promise<AnalysisResponseLike> {
  // The limit exists to bound *model* spend (PLAN §M5), so it is only ever
  // consulted on the one path that would actually call the model — never
  // on a cache hit and never when no model is configured. Both those paths
  // return below, before `deps.limiter.allow` is read.
  const cacheKey = computeCacheKey(request.fit, request.measurements);
  let cached: Awaited<ReturnType<typeof deps.cache.get>> = null;
  try {
    cached = await deps.cache.get(request.scanId, cacheKey);
  } catch (error) {
    logCacheFailure("get", error);
  }
  if (cached) {
    return {
      status: 200,
      body: { output: cached.output, source: cached.source, cached: true },
    };
  }

  const input = buildAnalysisInput(request.fit, request.measurements);

  if (deps.client === null) {
    const { output, source } = await analyse(input, deps.client);
    return { status: 200, body: { output, source, cached: false } };
  }

  const allowed = await deps.limiter.allow(request.rateLimitKey);
  if (!allowed) {
    return {
      status: 429,
      body: { error: "Too many analysis requests. Try again shortly." },
    };
  }

  const { output, source } = await analyse(input, deps.client);
  // Only a real model answer is cached — see the comment on `AnalysisCache`
  // in `./cache`. The fallback is free to recompute and must never be
  // served back as if a model wrote it once a key starts working again.
  if (source === "model") {
    try {
      await deps.cache.set(request.scanId, cacheKey, { output, source });
    } catch (error) {
      logCacheFailure("set", error);
    }
  }
  return { status: 200, body: { output, source, cached: false } };
}
