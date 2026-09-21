/**
 * Upserts the first-party catalogue into `mice`. Idempotent: re-running
 * refreshes dimensions and provenance and never touches classified descriptors.
 *   npm run db:seed            (explicit, e.g. production)
 *   tsx scripts/seed.ts --preview   (Vercel preview builds, after migrate)
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { describeMigrationError } from "../src/db/config";
import { mice } from "../src/db/schema";
import { type SpecRecord, toMouseRow } from "../src/server/catalogue/seed-rows";
import { resolveConnection } from "./db-connection";

async function main() {
  const connection = resolveConnection("seed");
  if (!connection) return;
  const records = JSON.parse(
    readFileSync("src/db/seed/logitech.json", "utf8"),
  ) as SpecRecord[];
  const rows = records.map(toMouseRow).filter((r) => r !== null);
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
      },
    });
  const [{ count }] = (
    await db.execute(sql`SELECT count(*)::int AS count FROM mice`)
  ).rows as [{ count: number }];
  console.log(
    `Seeded ${rows.length} mice (${skipped} skipped for missing dimensions); table now holds ${count}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    describeMigrationError(error).replace("Migration failed", "Seed failed"),
  );
  process.exitCode = 1;
});
