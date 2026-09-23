/**
 * Analysis cache — scoped to a scan, then keyed by fit and measurements so
 * repeat requests for that scan do not re-prompt Gemini. Cache rows are
 * deleted with their scan; results are never reused across scans.
 * `./drizzle-cache` has the DB-backed implementation (`analysis_cache`
 * table); this defines the interface and an in-memory implementation for
 * tests and local dev.
 *
 * Only `source: "model"` results are ever cached (issue #28 acceptance
 * criterion 2): the fallback is deterministic and free to recompute from
 * the fit response alone, so caching it saves nothing, and it would keep
 * serving stale template text after a transient model failure clears. The
 * `source: "model"` literal on `CachedAnalysis` makes this a type error to
 * get wrong at the call site, not just a runtime convention — see
 * `handleAnalysisRequest` in `./handler`, the only caller.
 */
import { createHash } from "node:crypto";
import type { FitResponse } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import type { AnalysisOutput } from "./schema";

/** Rounds every measurement to the nearest 1 mm, sorted by key for stability. */
function roundedMeasurements(
  measurements: HandMeasurements,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(measurements).sort()) {
    const value = (measurements as unknown as Record<string, unknown>)[key];
    if (typeof value === "number") {
      out[key] = Math.round(value);
    }
  }
  return out;
}

/**
 * Bump whenever what the model is shown or told changes (`buildPrompt` in
 * `./analyse`, `buildAnalysisInput` in `./input`), so a cached answer
 * written under the old prompt is a miss rather than served again.
 */
export const ANALYSIS_PROMPT_VERSION = 2;

/**
 * `cacheKey = sha256(promptVersion + engineVersion + gripUsed + rounded
 * measurements (1 mm) + top-3 slugs)`. Deterministic and order-independent
 * w.r.t. object key order. Scoped to one scan by the cache itself.
 */
export function computeCacheKey(
  fit: FitResponse,
  measurements: HandMeasurements,
): string {
  const payload = JSON.stringify({
    promptVersion: ANALYSIS_PROMPT_VERSION,
    engineVersion: fit.engineVersion,
    gripUsed: fit.gripStyle.used,
    measurements: roundedMeasurements(measurements),
    top3Slugs: fit.results.slice(0, 3).map((r) => r.mouse.slug),
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** A cached analysis is always a real model answer — see the module comment. */
export interface CachedAnalysis {
  output: AnalysisOutput;
  source: "model";
}

export interface AnalysisCache {
  get(scanId: string, key: string): Promise<CachedAnalysis | null>;
  set(scanId: string, key: string, value: CachedAnalysis): Promise<void>;
}

/** In-memory `AnalysisCache` for tests and local dev; not shared across instances. */
export class InMemoryAnalysisCache implements AnalysisCache {
  private readonly store = new Map<string, Map<string, CachedAnalysis>>();

  async get(scanId: string, key: string): Promise<CachedAnalysis | null> {
    return this.store.get(scanId)?.get(key) ?? null;
  }

  async set(scanId: string, key: string, value: CachedAnalysis): Promise<void> {
    let entries = this.store.get(scanId);
    if (!entries) {
      entries = new Map<string, CachedAnalysis>();
      this.store.set(scanId, entries);
    }
    entries.set(key, value);
  }
}
