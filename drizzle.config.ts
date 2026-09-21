import { defineConfig } from "drizzle-kit";

// Generation and migration checks are offline; applying SQL uses the HTTP driver.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
});
