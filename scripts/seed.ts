/**
 * Upserts the first-party catalogue into `mice`. Idempotent: re-running
 * refreshes dimensions and provenance.
 *
 * When src/db/seed/logitech-descriptors.json exists (written by
 * scripts/classify-descriptors.ts or by scripts/descriptors-from-geometry.ts),
 * it is authoritative for every model it lists: descriptor columns
 * are overwritten unconditionally with that run's values, nulls included, so
 * a model that regresses to needsReview clears a stale value from an earlier
 * run rather than being stuck with it. A model with **no** entry in the file
 * (no producer lists it, or there is no descriptors file at all) has its
 * descriptor columns left untouched — that upsert never references them, so
 * whatever is already in the database survives a dimensions-only re-seed.
 * Two separate upserts implement that split; see
 * src/server/catalogue/seed-rows.ts `partitionByDescriptors`.
 *
 * G9b: the file is now written by scripts/descriptors-from-geometry.ts and
 * lists 34 models with hump placement set and shape and handCompatibility
 * null. Because it is authoritative, those nulls would overwrite the
 * first-party facts in src/db/seed/logitech-facts.json. G9b must merge its
 * facts into that file, or change this precedence, before it ships. Details:
 * src/server/catalogue/geometry-descriptors.ts.
 *
 *   npm run db:seed            (explicit, e.g. production)
 *   tsx scripts/seed.ts --preview   (Vercel preview builds, after migrate)
 */
import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { describeMigrationError } from "../src/db/config";
import {
  seedCatalogue,
  seedSummaryLine,
} from "../src/server/catalogue/seed-catalogue";
import {
  DESCRIPTORS_SEED_PATH,
  type DescriptorRecord,
  type SpecRecord,
} from "../src/server/catalogue/seed-rows";
import { resolveConnection } from "./db-connection";

async function main() {
  const connection = resolveConnection("seed");
  if (!connection) return;
  const records = JSON.parse(
    readFileSync("src/db/seed/logitech.json", "utf8"),
  ) as SpecRecord[];
  const descriptors = existsSync(DESCRIPTORS_SEED_PATH)
    ? (JSON.parse(
        readFileSync(DESCRIPTORS_SEED_PATH, "utf8"),
      ) as DescriptorRecord[])
    : [];

  const summary = await seedCatalogue(
    drizzle(neon(connection)),
    records,
    descriptors,
  );
  console.log(seedSummaryLine(summary));
}

main().catch((error: unknown) => {
  console.error(
    describeMigrationError(error).replace("Migration failed", "Seed failed"),
  );
  process.exitCode = 1;
});
