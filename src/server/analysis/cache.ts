/**
 * Analysis cache — scoped to a scan, then keyed by the exact input the model
 * would be shown, so repeat requests for that scan do not re-prompt Gemini.
 * Cache rows are deleted with their scan; results are never reused across
 * scans. `./drizzle-cache` has the DB-backed implementation (`analysis_cache`
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
 *
 * SECURITY (H1, red team finding): a prior version of `computeCacheKey`
 * hashed only `gripUsed`, measurements rounded to 1 mm, and the top-3
 * slugs — not the weight-preference range, not `excluded` (which
 * `includeVertical` changes), not the per-mouse totals/sub-scores/reason
 * params actually shown to the model. Two requests for the same scan with
 * different weight preferences (e.g. 20-25 g, then 195-200 g) but the same
 * top-3 mice landed on the SAME cache key, so the second request served
 * prose written for the first preference — a number ("25") not present in
 * the second request's own input, violating AGENTS.md hard rule 2. Fixed by
 * hashing the exact first prompt text the model is sent (see
 * `computeCacheKey`), so any change to what the model sees is a cache miss
 * and nothing it never sees splits the cache.
 */
import { createHash } from "node:crypto";
import type { FitResponse } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { buildPrompt } from "./analyse";
import { buildAnalysisInput, type AnalysisInput } from "./input";
import type { AnalysisOutput } from "./schema";

/**
 * Bump whenever what the model is shown or told changes (`buildPrompt` in
 * `./analyse`, `buildAnalysisInput` in `./input`), so a cached answer
 * written under the old prompt is a miss rather than served again.
 *
 * Bumped to 4 for the no-medical-claims prompt and validation rule, so older
 * cached model prose cannot be served under the new policy.
 *
 * Bumped to 5 (G4) although `buildPrompt` itself did not change: the rules a
 * model answer must pass did (Chinese numerals now count under the
 * no-new-numerals rule, more Chinese medical terms are rejected, and the
 * low-confidence caveat must not deny it is provisional), and a palm grip with
 * no thumb rest now shows the model the `thumb_rest_missing` text instead of
 * `thumb_neutral`. Prose accepted under the old rules must not be served as if
 * it had passed the new ones.
 */
export const ANALYSIS_PROMPT_VERSION = 5;

/**
 * Recursively sorts every plain object's own keys so `JSON.stringify`'s
 * output does not depend on property insertion order — two objects with the
 * same values written in a different key order must hash identically.
 * Arrays keep their element order: order is meaningful there (e.g.
 * `topPicks` is rank order, and reordering it IS a different input).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

/**
 * `cacheKey = sha256(promptVersion + the exact first prompt the model is
 * sent)`.
 *
 * The prompt text *is* what the model sees, so keying on it is exact in
 * both directions: anything that changes what the model is shown or told
 * (weight-preference range, exclusions, totals, sub-score reasons — H1)
 * changes the key, and nothing the model never sees (slugs, the engine
 * version) fragments the cache. A hand-picked subset of fields is how H1
 * happened. `buildPrompt` is deterministic for a given input (fixed object
 * literal order in `promptData`), and the retry prompt only adds the
 * violation note to this same text, so the first prompt identifies the
 * request. Scoped to one scan by the cache itself.
 */
export function computeCacheKey(
  fit: FitResponse,
  measurements: HandMeasurements,
): string {
  // Canonical key order first, so two inputs with equal values but different
  // object literal order (never produced by the engine, but cheap to rule
  // out) share a key.
  const input = canonicalize(
    buildAnalysisInput(fit, measurements),
  ) as AnalysisInput;
  const prompt = buildPrompt(input);
  return createHash("sha256")
    .update(
      `${ANALYSIS_PROMPT_VERSION}
${prompt}`,
    )
    .digest("hex");
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
