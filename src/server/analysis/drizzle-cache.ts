/**
 * The real `AnalysisCache`, over the `analysis_cache` table (Drizzle with
 * the `@neondatabase/serverless` HTTP driver — never `pg.Pool`, AGENTS.md).
 * Persists across serverless instances and deploys, unlike
 * `InMemoryAnalysisCache`. Not unit-tested directly — same as
 * `src/server/scans/drizzle-repo.ts` and `src/server/account/drizzle-repo.ts`,
 * this is a thin SQL layer over logic (`AnalysisCache`'s "only cache
 * `source: 'model'`" contract) that is tested through its callers and the
 * in-memory fake; there is no database in CI.
 *
 * Only ever writes `source: "model"` rows — `CachedAnalysis` in `./cache`
 * makes that a type error to violate at the call site, and the
 * `analysis_cache_source_is_model` CHECK constraint (`src/db/schema.ts`)
 * guarantees it at the database level too.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { analysisCache } from "../../db/schema";
import type { AnalysisCache, CachedAnalysis } from "./cache";

export function createDrizzleAnalysisCache(db = getDb()): AnalysisCache {
  return {
    async get(scanId: string, key: string): Promise<CachedAnalysis | null> {
      const rows = await db
        .select({ output: analysisCache.output })
        .from(analysisCache)
        .where(
          and(eq(analysisCache.scanId, scanId), eq(analysisCache.key, key)),
        )
        .limit(1);
      const row = rows[0];
      // Every row in this table has source "model" — see the module
      // comment — so there is no stored value worth re-reading here.
      return row ? { output: row.output, source: "model" } : null;
    },

    async set(
      scanId: string,
      key: string,
      value: CachedAnalysis,
    ): Promise<void> {
      // A race between two requests computing the same key concurrently is
      // harmless — either model answer is a valid cache entry for it — so
      // the second writer is a no-op rather than an overwrite or an error.
      await db
        .insert(analysisCache)
        .values({ scanId, key, output: value.output, source: value.source })
        .onConflictDoNothing({
          target: [analysisCache.scanId, analysisCache.key],
        });
    },
  };
}
