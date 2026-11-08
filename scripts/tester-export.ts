/**
 * Exports every tester shot (candidate 未拍板; contract
 * src/lib/contracts/tester.ts) to a folder OUTSIDE the repository:
 * `shots.csv`, `records.jsonl` and `photos/<shotId>.jpg` (from the private
 * Blob store). Needs `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` (read from
 * .env.local like the other scripts). Run from the repository root.
 *
 *   npx tsx scripts/tester-export.ts [outDir]
 *
 * Default outDir: ../accuracy-collection-2026-11-08/export/ (beside the repo).
 * Refuses any folder inside the repository, before anything is read.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";
import { get } from "@vercel/blob";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "../src/db/config";
import * as schema from "../src/db/schema";
import { createTesterAdmin } from "../src/server/tester/drizzle-repo";
import { resolveExportDir, shotsCsv } from "./tester-lib";

type AdminDb = Parameters<typeof createTesterAdmin>[0];

async function main() {
  const repoRoot = process.cwd();
  const outDir = resolveExportDir(process.argv[2], repoRoot);
  nextEnv.loadEnvConfig(repoRoot);
  const db = drizzle(neon(requireDatabaseUrl(process.env, "DATABASE_URL")), {
    schema,
  });
  const admin = createTesterAdmin(db as unknown as AdminDb);
  const rows = await admin.listAll();
  mkdirSync(join(outDir, "photos"), { recursive: true });

  const exported = new Set<string>();
  const withPhoto = rows.filter((r) => r.photoPathname);
  if (withPhoto.length > 0 && !process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("Set BLOB_READ_WRITE_TOKEN to export the photos.");
  for (const row of withPhoto) {
    const found = await get(row.photoPathname!, { access: "private" });
    if (!found || found.statusCode !== 200) {
      console.warn(`Photo missing for shot ${row.shotId}.`);
      continue;
    }
    const bytes = new Uint8Array(
      await new Response(found.stream).arrayBuffer(),
    );
    writeFileSync(join(outDir, "photos", `${row.shotId}.jpg`), bytes);
    exported.add(row.shotId);
  }

  writeFileSync(join(outDir, "shots.csv"), shotsCsv(rows, exported));
  writeFileSync(
    join(outDir, "records.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""),
  );
  console.log(
    `Exported ${rows.length} shots and ${exported.size} photos to ${outDir}`,
  );
}

main().catch((error: unknown) => {
  // The message only: never a connection string or a record.
  console.error(error instanceof Error ? error.message : "Export failed.");
  process.exit(1);
});
