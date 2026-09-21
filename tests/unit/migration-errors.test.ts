import { describe, expect, it } from "vitest";
import {
  DatabaseConfigurationError,
  describeMigrationError,
  redactSecrets,
} from "../../src/db/config";

const SECRET = "synthetic-secret";

describe("redactSecrets", () => {
  it.each([
    `connect failed: postgresql://test:${SECRET}@ep-x.neon.tech/app?sslmode=require`,
    `connect failed: postgres://test:${SECRET}@db.invalid/app`,
    `fetch to https://test:${SECRET}@api.invalid/sql failed`,
    `bad config password=${SECRET}`,
    `bad config "PASSWORD: ${SECRET}"`,
    `token=${SECRET}; retrying`,
  ])("removes the credential from %s", (message) => {
    expect(redactSecrets(message)).not.toContain(SECRET);
  });

  it("keeps the Postgres error text that makes a failure debuggable", () => {
    const message =
      'relation "mice" already exists (42P07) while running 0001_mice.sql';
    expect(redactSecrets(message)).toBe(message);
  });

  it("keeps the surrounding context when it redacts a URL", () => {
    expect(
      redactSecrets(`timeout reaching postgresql://u:${SECRET}@h/db after 30s`),
    ).toBe("timeout reaching [redacted-url] after 30s");
  });
});

describe("describeMigrationError", () => {
  it("passes configuration errors through unchanged", () => {
    const error = new DatabaseConfigurationError("Set DATABASE_URL to x.");
    expect(describeMigrationError(error)).toBe("Set DATABASE_URL to x.");
  });

  it("surfaces a driver error with its detail but without its secret", () => {
    const error = new Error(
      `syntax error at or near "CRATE" — postgresql://u:${SECRET}@h/db`,
    );
    const described = describeMigrationError(error);
    expect(described).toContain('syntax error at or near "CRATE"');
    expect(described).not.toContain(SECRET);
    expect(described.startsWith("Migration failed: ")).toBe(true);
  });

  it.each([undefined, null, 42, {}, new Error(""), "  "])(
    "falls back to a generic message when there is no detail (%s)",
    (error) => {
      expect(describeMigrationError(error)).toMatch(/no error detail/);
    },
  );
});
