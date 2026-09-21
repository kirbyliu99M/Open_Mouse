import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import {
  describeMigrationError,
  requireDatabaseUrl,
  requirePreviewDatabaseUrl,
} from "../src/db/config";

async function main() {
  nextEnv.loadEnvConfig(process.cwd());

  // Marketplace injects the isolated branch URL before the preview build.
  // Production migrations are explicit, never triggered by a PR build.
  if (
    process.argv.includes("--preview") &&
    process.env.VERCEL_ENV !== "preview"
  ) {
    console.log("Skipping preview migration outside the preview environment.");
    return;
  }

  const connection =
    process.env.VERCEL_ENV === "preview"
      ? requirePreviewDatabaseUrl(process.env)
      : requireDatabaseUrl(process.env, "DATABASE_URL_UNPOOLED");
  const sql = neon(connection);
  console.log(`Database endpoint: ${new URL(connection).hostname}`);
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  // Also prove the generated table can be queried with the HTTP driver.
  await sql`SELECT id FROM scaffold_checks LIMIT 1`;
  console.log(
    "Migrations applied; scaffold_checks query passed over Neon HTTP.",
  );
}

main().catch((error: unknown) => {
  // Report the real failure with connection strings and credentials redacted.
  console.error(describeMigrationError(error));
  process.exitCode = 1;
});
