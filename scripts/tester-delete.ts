/**
 * Deletes every tester shot of one participant, with its photos in the
 * private Blob store AND in the local export folder (candidate 未拍板;
 * contract src/lib/contracts/tester.ts): what Kirby runs when a tester asks
 * for deletion. Dry run by default.
 *
 *   npx tsx scripts/tester-delete.ts P07                # shows what would go
 *   npx tsx scripts/tester-delete.ts P07 --yes          # deletes it
 *   npx tsx scripts/tester-delete.ts P07 --out <dir>    # another export folder
 *
 * Needs `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` (read from .env.local).
 * Server photos first, then rows, then the local copy: if a step fails, the
 * same command works again.
 */
import { execFileSync } from "node:child_process";
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "../src/db/config";
import * as schema from "../src/db/schema";
import { createTesterAdmin } from "../src/server/tester/drizzle-repo";
import {
  parseParticipantArg,
  removeParticipantLocally,
  resolveExportDir,
} from "./tester-lib";

type AdminDb = Parameters<typeof createTesterAdmin>[0];

async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const outDir = outAt >= 0 ? args[outAt + 1] : undefined;
  const participant = parseParticipantArg(
    args.find((a, i) => !a.startsWith("--") && i !== outAt + 1),
  );
  const really = args.includes("--yes");
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const exportDir = resolveExportDir(outDir, root);
  nextEnv.loadEnvConfig(root);
  const db = drizzle(neon(requireDatabaseUrl(process.env, "DATABASE_URL")), {
    schema,
  });
  const admin = createTesterAdmin(db as unknown as AdminDb);
  const rows = await admin.listParticipant(participant);
  const photos = rows.flatMap((r) =>
    r.photoPathname ? [r.photoPathname] : [],
  );
  const local = removeParticipantLocally(exportDir, participant, true);
  console.log(
    `${participant}: server ${rows.length} shots, ${photos.length} photos; ` +
      `local export ${local.rows} shots, ${local.photos} photos` +
      (really ? "" : " (dry run; add --yes to delete)"),
  );
  if (!really) return;
  if (photos.length > 0) {
    if (!process.env.BLOB_READ_WRITE_TOKEN)
      throw new Error("Set BLOB_READ_WRITE_TOKEN to delete the photos.");
    await del(photos);
  }
  const deleted = rows.length ? await admin.deleteParticipant(participant) : 0;
  const removed = removeParticipantLocally(exportDir, participant, false);
  console.log(
    `Deleted ${deleted} shots and ${photos.length} photos on the server, ` +
      `${removed.rows} shots and ${removed.photos} photos in ${exportDir}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Delete failed.");
  process.exit(1);
});
