import { describe, expect, it } from "vitest";
import {
  requireDatabaseUrl,
  requirePreviewDatabaseUrl,
} from "../../src/db/config";

describe("database configuration", () => {
  const valid =
    "postgresql://test:synthetic-secret@db.invalid/app?sslmode=require";

  it("uses the requested connection without falling back to another environment", () => {
    expect(
      requireDatabaseUrl({ DATABASE_URL: ` ${valid} ` }, "DATABASE_URL"),
    ).toBe(valid);
    expect(() =>
      requireDatabaseUrl({ DATABASE_URL: valid }, "DATABASE_URL_UNPOOLED"),
    ).toThrow("DATABASE_URL_UNPOOLED");
  });

  it.each([
    undefined,
    "",
    "   ",
    "not-a-url",
    "https://test:synthetic-secret@db.invalid/app",
    "postgresql://db.invalid/app",
    "postgresql://test:synthetic-secret@db.invalid/",
    "postgresql://user:password@ep-example.region.aws.neon.tech/neondb",
  ])(
    "rejects missing, malformed or placeholder configuration (%s)",
    (value) => {
      expect(() =>
        requireDatabaseUrl({ DATABASE_URL: value }, "DATABASE_URL"),
      ).toThrow("Set DATABASE_URL");
    },
  );

  it("does not expose credentials in validation errors", () => {
    const unsafe = "https://test:synthetic-secret@db.invalid/app";
    expect(() =>
      requireDatabaseUrl({ DATABASE_URL: unsafe }, "DATABASE_URL"),
    ).toThrow(/^Set DATABASE_URL to a valid PostgreSQL connection URL\.$/);
  });
});

describe("preview database isolation", () => {
  const env = {
    DATABASE_URL_UNPOOLED:
      "postgresql://test:synthetic-secret@ep-preview.region.neon.tech/app",
    DATABASE_PRODUCTION_HOST: "ep-production.region.neon.tech",
  };

  it("accepts a different preview endpoint", () => {
    expect(requirePreviewDatabaseUrl(env)).toBe(env.DATABASE_URL_UNPOOLED);
  });

  it.each([undefined, "", "postgresql://secret@production/app"])(
    "requires a production hostname for comparison (%s)",
    (hostname) => {
      expect(() =>
        requirePreviewDatabaseUrl({
          ...env,
          DATABASE_PRODUCTION_HOST: hostname,
        }),
      ).toThrow("DATABASE_PRODUCTION_HOST");
    },
  );

  it.each([
    "ep-preview.region.neon.tech",
    "EP-PREVIEW-POOLER.REGION.NEON.TECH",
  ])(
    "refuses the production endpoint even when a pooled hostname is supplied (%s)",
    (hostname) => {
      expect(() =>
        requirePreviewDatabaseUrl({
          ...env,
          DATABASE_PRODUCTION_HOST: hostname,
        }),
      ).toThrow("separate database endpoint");
    },
  );
});
