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
 * CAT-1 (2026-10-09): it now also reads logitech-facts.json (hand, shape and
 * form factor were never seeded before) and catalogue.json (the 409 approved
 * candidates, written by scripts/import-catalogue.ts). A candidate that is the
 * same product as a logitech.json row only fills that row's null descriptors;
 * the rest become rows of their own. See src/server/catalogue/catalogue-rows.ts.
 * Every run also sets category, listed, form_factor, image_path and
 * data_source on every row.
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
import type { CatalogueEntry } from "../src/server/catalogue/candidate-map";
import type { FactsFile } from "../src/server/catalogue/catalogue-rows";
import { resolveConnection } from "./db-connection";

const IMAGES_DIR = "public/images/mice";

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

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
    {
      facts: readJson<FactsFile>("src/db/seed/logitech-facts.json"),
      entries: readJson<CatalogueEntry[]>("src/db/seed/catalogue.json"),
      imageExists: (slug) => existsSync(`${IMAGES_DIR}/${slug}.webp`),
    },
  );
  console.log(seedSummaryLine(summary));
}

main().catch((error: unknown) => {
  console.error(
    describeMigrationError(error).replace("Migration failed", "Seed failed"),
  );
  process.exitCode = 1;
});
