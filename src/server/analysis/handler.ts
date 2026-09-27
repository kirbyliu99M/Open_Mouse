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
import { analyse, buildFallbackOutput } from "./analyse";
import type { AnalysisCache } from "./cache";
import { computeCacheKey } from "./cache";
import type { TextModel } from "./client";
import { buildAnalysisInput } from "./input";
import { globalModelCallRateLimitKey } from "./rate-limit-config";

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
  /**
   * Site-wide daily cap on real model calls (M1 hardening finding, PLAN
   * §M5). Consulted on exactly the same path as `limiter` — after it
   * allows, immediately before the model would actually be called — never
   * on a cache hit and never when no model is configured. Unlike `limiter`,
   * saying no here is never a 429: `handleAnalysisRequest` serves the
   * deterministic fallback with 200 instead, since the cap exists to bound
   * *cost*, not to punish any one caller.
   */
  globalLimiter: RateLimiter;
  /** Injectable clock; defaults to `new Date()`. Only used to scope the
   * global cap's key to the current UTC calendar day. */
  now?: () => Date;
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
function pgErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("code" in error) return String((error as { code: unknown }).code);
  return null;
}

function logCacheFailure(op: "get" | "set", error: unknown): void {
  // Drizzle wraps driver errors in DrizzleQueryError, whose own message
  // quotes the query params (the prose) — so read the code from the
  // wrapped cause, and never log a message.
  const code =
    pgErrorCode(error) ??
    pgErrorCode(
      typeof error === "object" && error !== null && "cause" in error
        ? (error as { cause: unknown }).cause
        : null,
    ) ??
    "none";
  console.error(
    `analysis cache ${op} failed (code ${code}); continuing without it`,
  );
}

export async function handleAnalysisRequest(
  request: AnalysisRequest,
  deps: AnalysisRequestDeps,
): Promise<AnalysisResponseLike> {
  // Both limits exist to bound *model* spend (PLAN §M5), so `limiter` and
  // `globalLimiter` are only ever consulted on the one path that would
  // actually call the model — never on a cache hit and never when no model
  // is configured. Both those paths return below, before either is read.
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

  // Both limiters are consulted, and both spend their budget, before the
  // model is actually called — including `globalLimiter`, whose count is
  // incremented here even if the `analyse()` call below then fails (a
  // network error, an API error) and answers with the fallback anyway
  // (PR #56 review). That's deliberately conservative: this call was
  // still going to be attempted against the model, so it still counts
  // against the day's budget even though no usable answer came back.
  // Likewise, `limiter` (the per-IP check above) has already counted this
  // request even on the branch below where the global cap then serves the
  // fallback instead of calling the model — a caller who keeps requesting
  // once the site-wide cap is hit still spends its own per-IP budget, on
  // the same reasoning: this is a known, accepted trade-off, not a bug.
  const now = deps.now ?? (() => new Date());
  const globalKey = globalModelCallRateLimitKey(now());
  const globalAllowed = await deps.globalLimiter.allow(globalKey);
  if (!globalAllowed) {
    // The site-wide daily cap is spent. Never a 429 (M1): someone else's
    // traffic hitting the cap is not this caller's fault, so the product
    // keeps working — honestly, with the same deterministic, free-to-
    // recompute fallback `analyse()` returns when no model is configured —
    // rather than erroring for everyone once the budget runs out. Not
    // cached, same as every other fallback (`source` is never "model" here).
    return {
      status: 200,
      body: {
        output: buildFallbackOutput(input),
        source: "fallback",
        cached: false,
      },
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
