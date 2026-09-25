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
 * hashing the *exact* `AnalysisInput` object `buildAnalysisInput` produces —
 * the same object `collectNumbers` walks in `./analyse.ts` to build the
 * no-new-numerals allow-list — so any change to what the model sees is a
 * cache miss, full stop.
 */
import { createHash } from "node:crypto";
import type { FitResponse } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { buildAnalysisInput } from "./input";
import type { AnalysisOutput } from "./schema";

/**
 * Bump whenever what the model is shown or told changes (`buildPrompt` in
 * `./analyse`, `buildAnalysisInput` in `./input`), so a cached answer
 * written under the old prompt is a miss rather than served again.
 *
 * Bumped to 3 for the H1 fix above: the cache key's shape itself changed,
 * so every row cached under the old (unsafe) key must be treated as stale.
 */
export const ANALYSIS_PROMPT_VERSION = 3;

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
 * `cacheKey = sha256(promptVersion + canonical JSON of the exact
 * AnalysisInput the model would be shown)`.
 *
 * Deliberately re-derives the same `AnalysisInput` `handleAnalysisRequest`
 * builds via `buildAnalysisInput` (a pure function of `fit` and
 * `measurements`, so recomputing it here is cheap and always consistent
 * with what actually gets sent to the model) rather than hashing a
 * hand-picked subset of `fit`/`measurements` fields — a hand-picked subset
 * is exactly how H1 happened: a field that isn't in the model's input can
 * still change what the model is TOLD (weight-preference range, `excluded`)
 * without anyone noticing the cache key needed to change too. Hashing the
 * real `AnalysisInput` makes that class of bug structurally impossible: the
 * key can only go stale in the same way the no-new-numerals check
 * (`collectNumbers` in `./numerals.ts`, called on this exact object in
 * `./analyse.ts`) could, and that check already has its own coverage.
 *
 * `fit.engineVersion` is deliberately NOT part of the key: it never reaches
 * `AnalysisInput` (see `buildAnalysisInput`) or the prompt (`analyse.ts`
 * asserts this), so it is never part of what the model is shown or told. An
 * engine version bump that actually changes what a hand scores as will
 * necessarily change `targets`/`topPicks`/subscore params too, which DOES
 * change the key; a version bump with no observable effect on the input is,
 * correctly, not treated as a different prompt.
 *
 * Order-independent w.r.t. any object's own key order (see `canonicalize`),
 * scoped to one scan by the cache itself.
 */
export function computeCacheKey(
  fit: FitResponse,
  measurements: HandMeasurements,
): string {
  const input = buildAnalysisInput(fit, measurements);
  const payload = JSON.stringify(
    canonicalize({ promptVersion: ANALYSIS_PROMPT_VERSION, input }),
  );
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
