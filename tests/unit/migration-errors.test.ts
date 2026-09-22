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

  // Regression coverage for the 2026-09-21 Codex review (docs/reviews/m0-866451a.md):
  // "quoted secrets survive migration error logging". Every quoting style that
  // review, and a follow-up reproduction against `main`, found leaking.
  describe("quoted and aliased credentials (Codex 2026-09-21, P1)", () => {
    it.each<[string, string]>([
      ["double-quoted value", `password="${SECRET}"`],
      ["single-quoted value", `password='${SECRET}'`],
      ["JSON-style key/value, no whitespace", `{"password":"${SECRET}"}`],
      [
        "JSON-style key/value, whitespace around colon",
        `{"password" : "${SECRET}"}`,
      ],
      [
        "backslash-escaped quotes (double-encoded JSON)",
        `password=\\"${SECRET}\\"`,
      ],
      ["PGPASSWORD alias, unquoted", `PGPASSWORD=${SECRET}`],
    ])("redacts %s completely: %s", (_label, message) => {
      const out = redactSecrets(message);
      expect(out).not.toContain(SECRET);
      // also check a distinctive substring, not just the whole value, in case
      // a partial/prefix match were to slip through
      expect(out).not.toContain("secret-XYZ");
    });

    it.each([
      "password",
      "PASSWORD",
      "passwd",
      "pwd",
      "PGPASSWORD",
      "POSTGRES_PASSWORD",
      "secret",
      "token",
      "api_key",
      "apikey",
      "API-KEY",
      "DATABASE_URL",
    ])("redacts the %s alias, case-insensitively", (alias) => {
      const message = `config: ${alias}=${SECRET} (retry 1)`;
      const out = redactSecrets(message);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("secret-XYZ");
      // the non-secret context around the value survives
      expect(out).toContain("config:");
      expect(out).toContain("(retry 1)");
    });

    it("redacts a quoted value that itself contains =, @, &, and spaces", () => {
      const trickySecret = `sec=ret@x&y z`;
      const message = `bad config password="${trickySecret}" while connecting`;
      const out = redactSecrets(message);
      expect(out).not.toContain(trickySecret);
      expect(out).not.toContain("sec=ret");
      expect(out).not.toContain("@x&y");
      expect(out).toContain("while connecting");
    });

    it("redacts a full connection string under a non-credential key name", () => {
      const message = `{"someOtherConfigKey":"postgresql://u:${SECRET}@h/db"} while running 0002_index.sql`;
      const out = redactSecrets(message);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("secret-XYZ");
      expect(out).toContain("while running 0002_index.sql");
    });

    it("keeps the Postgres detail alongside a redacted quoted secret", () => {
      const message = `syntax error at or near "CREATE" (42601); config was password="${SECRET}"`;
      const out = redactSecrets(message);
      expect(out).not.toContain(SECRET);
      expect(out).toContain('syntax error at or near "CREATE" (42601)');
    });
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
