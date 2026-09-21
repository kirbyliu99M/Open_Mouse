/**
 * Upserts the first-party catalogue into `mice`. Idempotent: re-running
 * refreshes dimensions and provenance.
 *
 * When src/db/seed/logitech-descriptors.json exists (scripts/classify-descriptors.ts
 * has run), it is authoritative for every model it lists: descriptor columns
 * are overwritten unconditionally with that run's values, nulls included, so
 * a model that regresses to needsReview clears a stale value from an earlier
 * run rather than being stuck with it. A model with **no** entry in the file
 * (the classifier hasn't run, or there is no descriptors file at all) has its
 * descriptor columns left untouched — that upsert never references them, so
 * whatever is already in the database survives a dimensions-only re-seed.
 * Two separate upserts implement that split; see
 * src/server/catalogue/seed-rows.ts `partitionByDescriptors`.
 *
 *   npm run db:seed            (explicit, e.g. production)
 *   tsx scripts/seed.ts --preview   (Vercel preview builds, after migrate)
 */
import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { describeMigrationError } from "../src/db/config";
import { mice } from "../src/db/schema";
import {
  type DescriptorRecord,
  partitionByDescriptors,
  type SpecRecord,
  toMouseRow,
} from "../src/server/catalogue/seed-rows";
import { resolveConnection } from "./db-connection";

const DESCRIPTORS_PATH = "src/db/seed/logitech-descriptors.json";

const DIMENSION_SET = {
  lengthMm: sql`excluded.length_mm`,
  widthMm: sql`excluded.width_mm`,
  heightMm: sql`excluded.height_mm`,
  weightG: sql`excluded.weight_g`,
  connectivity: sql`excluded.connectivity`,
  size: sql`excluded.size`,
  sourceUrl: sql`excluded.source_url`,
  specRetrievedAt: sql`excluded.spec_retrieved_at`,
};

const DESCRIPTOR_SET = {
  shape: sql`excluded.shape`,
  handCompatibility: sql`excluded.hand_compatibility`,
  humpPlacement: sql`excluded.hump_placement`,
  frontFlare: sql`excluded.front_flare`,
  sideCurvature: sql`excluded.side_curvature`,
  thumbRest: sql`excluded.thumb_rest`,
  ringFingerRest: sql`excluded.ring_finger_rest`,
  descriptorMethod: sql`excluded.descriptor_method`,
  descriptorModel: sql`excluded.descriptor_model`,
  descriptorSourceUrls: sql`excluded.descriptor_source_urls`,
  classifiedAt: sql`excluded.classified_at`,
};

async function main() {
  const connection = resolveConnection("seed");
  if (!connection) return;
  const records = JSON.parse(
    readFileSync("src/db/seed/logitech.json", "utf8"),
  ) as SpecRecord[];
  const descriptors = existsSync(DESCRIPTORS_PATH)
    ? (JSON.parse(readFileSync(DESCRIPTORS_PATH, "utf8")) as DescriptorRecord[])
    : [];
  const descriptorsByModel = new Map(descriptors.map((d) => [d.model, d]));
  const applied = descriptors.filter((d) => !d.needsReview).length;

  const baseRows = records.map(toMouseRow).filter((r) => r !== null);
  const skipped = records.length - baseRows.length;
  const { withDescriptors, withoutDescriptors } = partitionByDescriptors(
    baseRows,
    descriptorsByModel,
  );

  const db = drizzle(neon(connection));
  if (withoutDescriptors.length > 0) {
    await db
      .insert(mice)
      .values(withoutDescriptors)
      .onConflictDoUpdate({
        target: [mice.brand, mice.model],
        set: DIMENSION_SET,
      });
  }
  if (withDescriptors.length > 0) {
    await db
      .insert(mice)
      .values(withDescriptors)
      .onConflictDoUpdate({
        target: [mice.brand, mice.model],
        set: { ...DIMENSION_SET, ...DESCRIPTOR_SET },
      });
  }

  const [{ count }] = (
    await db.execute(sql`SELECT count(*)::int AS count FROM mice`)
  ).rows as [{ count: number }];
  console.log(
    `Seeded ${baseRows.length} mice (${skipped} skipped for missing dimensions); table now holds ${count}.` +
      (descriptors.length
        ? ` Applied descriptors for ${applied}/${descriptors.length} classified models (${descriptors.length - applied} needing review cleared, not applied).`
        : ""),
  );
}

main().catch((error: unknown) => {
  console.error(
    describeMigrationError(error).replace("Migration failed", "Seed failed"),
  );
  process.exitCode = 1;
});
