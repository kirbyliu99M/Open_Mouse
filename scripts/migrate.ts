import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { describeMigrationError } from "../src/db/config";
import { resolveConnection } from "./db-connection";

async function main() {
  const connection = resolveConnection("migration");
  if (!connection) return;
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
