import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { requireDatabaseUrl } from "./config";
import * as schema from "./schema";

// Lazy so the placeholder page builds without credentials or a database call.
export function getDb() {
  const sql = neon(requireDatabaseUrl(process.env, "DATABASE_URL"));
  return drizzle(sql, { schema });
}
