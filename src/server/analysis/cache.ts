/**
 * Analysis cache — keyed so identical fit results never re-prompt Gemini.
 * A DB-backed table comes later (out of scope for M5); this defines the
 * interface and an in-memory implementation for tests and local dev.
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
 * `cacheKey = sha256(engineVersion + gripUsed + rounded measurements (1 mm) +
 * top-3 slugs)`. Deterministic and order-independent w.r.t. object key order.
 */
export function computeCacheKey(
  fit: FitResponse,
  measurements: HandMeasurements,
): string {
  const payload = JSON.stringify({
    engineVersion: fit.engineVersion,
    gripUsed: fit.gripStyle.used,
    measurements: roundedMeasurements(measurements),
    top3Slugs: fit.results.slice(0, 3).map((r) => r.mouse.slug),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export interface AnalysisCache {
  get(key: string): Promise<AnalysisOutput | null>;
  set(key: string, value: AnalysisOutput): Promise<void>;
}

/** In-memory `AnalysisCache` for tests and local dev; not shared across instances. */
export class InMemoryAnalysisCache implements AnalysisCache {
  private readonly store = new Map<string, AnalysisOutput>();

  async get(key: string): Promise<AnalysisOutput | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: AnalysisOutput): Promise<void> {
    this.store.set(key, value);
  }
}
