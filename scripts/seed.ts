/**
 * Upserts the first-party catalogue into `mice`. Idempotent: re-running
 * refreshes dimensions and provenance and never wipes classified descriptors.
 *
 * When src/db/seed/logitech-descriptors.json exists (scripts/classify-descriptors.ts
 * has run), non-needsReview descriptors are applied alongside the dimensions.
 * The upsert uses COALESCE(excluded.x, mice.x) for every descriptor column so
 * a re-seed with no descriptor data (or an older/needsReview record) never
 * overwrites a good classification already in the database.
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
  applyDescriptors,
  type DescriptorRecord,
  type SpecRecord,
  toMouseRow,
} from "../src/server/catalogue/seed-rows";
import { resolveConnection } from "./db-connection";

const DESCRIPTORS_PATH = "src/db/seed/logitech-descriptors.json";

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

  const rows = records
    .map(toMouseRow)
    .filter((r) => r !== null)
    .map((row) => applyDescriptors(row, descriptorsByModel.get(row.model)));
  const skipped = records.length - rows.length;
  const db = drizzle(neon(connection));
  await db
    .insert(mice)
    .values(rows)
    .onConflictDoUpdate({
      target: [mice.brand, mice.model],
      set: {
        lengthMm: sql`excluded.length_mm`,
        widthMm: sql`excluded.width_mm`,
        heightMm: sql`excluded.height_mm`,
        weightG: sql`excluded.weight_g`,
        connectivity: sql`excluded.connectivity`,
        size: sql`excluded.size`,
        sourceUrl: sql`excluded.source_url`,
        specRetrievedAt: sql`excluded.spec_retrieved_at`,
        shape: sql`COALESCE(excluded.shape, ${mice.shape})`,
        handCompatibility: sql`COALESCE(excluded.hand_compatibility, ${mice.handCompatibility})`,
        humpPlacement: sql`COALESCE(excluded.hump_placement, ${mice.humpPlacement})`,
        frontFlare: sql`COALESCE(excluded.front_flare, ${mice.frontFlare})`,
        sideCurvature: sql`COALESCE(excluded.side_curvature, ${mice.sideCurvature})`,
        thumbRest: sql`COALESCE(excluded.thumb_rest, ${mice.thumbRest})`,
        ringFingerRest: sql`COALESCE(excluded.ring_finger_rest, ${mice.ringFingerRest})`,
        descriptorMethod: sql`COALESCE(excluded.descriptor_method, ${mice.descriptorMethod})`,
        descriptorModel: sql`COALESCE(excluded.descriptor_model, ${mice.descriptorModel})`,
        descriptorSourceUrls: sql`COALESCE(excluded.descriptor_source_urls, ${mice.descriptorSourceUrls})`,
        classifiedAt: sql`COALESCE(excluded.classified_at, ${mice.classifiedAt})`,
      },
    });
  const [{ count }] = (
    await db.execute(sql`SELECT count(*)::int AS count FROM mice`)
  ).rows as [{ count: number }];
  console.log(
    `Seeded ${rows.length} mice (${skipped} skipped for missing dimensions); table now holds ${count}.` +
      (descriptors.length
        ? ` Applied descriptors for ${applied}/${descriptors.length} classified models (${descriptors.length - applied} needing review skipped).`
        : ""),
  );
}

main().catch((error: unknown) => {
  console.error(
    describeMigrationError(error).replace("Migration failed", "Seed failed"),
  );
  process.exitCode = 1;
});
