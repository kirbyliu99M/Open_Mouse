import nextEnv from "@next/env";
import {
  requireDatabaseUrl,
  requirePreviewDatabaseUrl,
} from "../src/db/config";

/**
 * Shared by migrate and seed. With --preview, runs only inside a Vercel preview
 * build and refuses the production endpoint; otherwise uses the unpooled URL
 * explicitly. Returns null when the step should be skipped.
 */
export function resolveConnection(step: string): string | null {
  nextEnv.loadEnvConfig(process.cwd());
  if (
    process.argv.includes("--preview") &&
    process.env.VERCEL_ENV !== "preview"
  ) {
    console.log(`Skipping preview ${step} outside the preview environment.`);
    return null;
  }
  return process.env.VERCEL_ENV === "preview"
    ? requirePreviewDatabaseUrl(process.env)
    : requireDatabaseUrl(process.env, "DATABASE_URL_UNPOOLED");
}
