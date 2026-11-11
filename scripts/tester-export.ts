/**
 * Exports every tester shot (candidate 未拍板; contract
 * src/lib/contracts/tester.ts) to a folder OUTSIDE the repository:
 * `shots.csv`, `records.jsonl` and `photos/<shotId>.jpg` (from the private
 * Blob store). Needs `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` (read from
 * .env.local like the other scripts).
 *
 *   npx tsx scripts/tester-export.ts [outDir]
 *   npx tsx scripts/tester-export.ts [outDir] --prune-only   # offline
 *
 * Default outDir: ../accuracy-collection-2026-11-08/export/ beside the
 * repository root (`git rev-parse --show-toplevel`). Refuses any folder
 * inside the repository (links resolved), before anything is read.
 *
 * Each run rewrites both files from the server and applies the same
 * retention locally: a photo whose shot day is older than
 * `TESTER_PHOTO_RETENTION_DAYS` (or that the server no longer has, or whose
 * participant was deleted) is deleted from `photos/`. `--prune-only` does
 * the age part offline, from the folder's own `records.jsonl` (no database,
 * no Blob store), e.g. on a machine that keeps a copy.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";
import { get } from "@vercel/blob";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "../src/db/config";
import * as schema from "../src/db/schema";
import { createTesterAdmin } from "../src/server/tester/drizzle-repo";
import {
  localPhotoCutoffDay,
  parseExportArgs,
  photosToKeep,
  pruneExportFolder,
  pruneLocalPhotos,
  resolveExportDir,
  writeExportFiles,
} from "./tester-lib";

type AdminDb = Parameters<typeof createTesterAdmin>[0];

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

async function main() {
  const root = repoRoot();
  const args = parseExportArgs(process.argv.slice(2));
  const outDir = resolveExportDir(args.outDir, root);
  if (args.pruneOnly) {
    const removed = pruneExportFolder(outDir, new Date());
    console.log(
      `Pruned ${outDir} offline: ${removed} photos past retention or without a row removed.`,
    );
    return;
  }
  nextEnv.loadEnvConfig(root);
  const db = drizzle(neon(requireDatabaseUrl(process.env, "DATABASE_URL")), {
    schema,
  });
  const admin = createTesterAdmin(db as unknown as AdminDb);
  const rows = await admin.listAll();
  mkdirSync(join(outDir, "photos"), { recursive: true });

  const keep = photosToKeep(rows, localPhotoCutoffDay(new Date()));
  const pruned = pruneLocalPhotos(outDir, keep);

  let downloaded = 0;
  if (keep.size > 0 && !process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("Set BLOB_READ_WRITE_TOKEN to export the photos.");
  for (const row of rows) {
    if (!keep.has(row.shotId) || !row.photoPathname) continue;
    const file = join(outDir, "photos", `${row.shotId}.jpg`);
    if (existsSync(file)) continue;
    const found = await get(row.photoPathname, { access: "private" });
    if (!found || found.statusCode !== 200) {
      console.warn(`Photo missing for shot ${row.shotId}.`);
      continue;
    }
    const bytes = new Uint8Array(
      await new Response(found.stream).arrayBuffer(),
    );
    writeFileSync(file, bytes);
    downloaded++;
  }

  writeExportFiles(outDir, rows);
  console.log(
    `Exported ${rows.length} shots to ${outDir}: ${downloaded} photos downloaded, ${pruned} old or deleted photos removed.`,
  );
}

main().catch((error: unknown) => {
  // The message only: never a connection string or a record.
  console.error(error instanceof Error ? error.message : "Export failed.");
  process.exit(1);
});
