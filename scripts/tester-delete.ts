/**
 * Deletes every tester shot of one participant, with its photos in the
 * private Blob store (candidate 未拍板; contract src/lib/contracts/tester.ts):
 * what Kirby runs when a tester asks for deletion. Dry run by default.
 *
 *   npx tsx scripts/tester-delete.ts P07          # shows what would go
 *   npx tsx scripts/tester-delete.ts P07 --yes    # deletes it
 *
 * Needs `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` (read from .env.local).
 * Photos first, then rows: if the photo delete fails, the rows stay and the
 * same command works again.
 */
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "../src/db/config";
import * as schema from "../src/db/schema";
import { createTesterAdmin } from "../src/server/tester/drizzle-repo";
import { parseParticipantArg } from "./tester-lib";

type AdminDb = Parameters<typeof createTesterAdmin>[0];

async function main() {
  const participant = parseParticipantArg(
    process.argv.slice(2).find((a) => !a.startsWith("--")),
  );
  const really = process.argv.includes("--yes");
  nextEnv.loadEnvConfig(process.cwd());
  const db = drizzle(neon(requireDatabaseUrl(process.env, "DATABASE_URL")), {
    schema,
  });
  const admin = createTesterAdmin(db as unknown as AdminDb);
  const rows = await admin.listParticipant(participant);
  const photos = rows.flatMap((r) =>
    r.photoPathname ? [r.photoPathname] : [],
  );
  console.log(
    `${participant}: ${rows.length} shots, ${photos.length} photos${really ? "" : " (dry run; add --yes to delete)"}`,
  );
  if (!really || rows.length === 0) return;
  if (photos.length > 0) {
    if (!process.env.BLOB_READ_WRITE_TOKEN)
      throw new Error("Set BLOB_READ_WRITE_TOKEN to delete the photos.");
    await del(photos);
  }
  const deleted = await admin.deleteParticipant(participant);
  console.log(`Deleted ${deleted} shots and ${photos.length} photos.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Delete failed.");
  process.exit(1);
});
