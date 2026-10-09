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

    it("redacts a real connection string held by DATABASE_URL", () => {
      // Belt and suspenders: CONNECTION_URL catches the value because it's
      // URL-shaped, and (since Kirby's 2026-09-23 adjudication) DATABASE_URL
      // is now also a credential-shaped key in its own right (contains
      // "url"). Either path alone would redact this; both firing is fine.
      const message = `DATABASE_URL=postgresql://u:${SECRET}@h/db (config)`;
      const out = redactSecrets(message);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("secret-XYZ");
      expect(out).toContain("(config)");
    });

    // Kirby's 2026-09-23 adjudication: include `url` and `dsn` as content
    // fragments, fail toward redacting, because a *_URL/*_DSN key is exactly
    // the field most likely to carry a credential and its value may be
    // malformed or truncated in a way that defeats CONNECTION_URL's
    // URL-shape pattern -- the key name is the more reliable signal here.
    it.each([
      "DATABASE_URL",
      "POSTGRES_URL_NON_POOLING",
      "db_dsn",
      "SENTRY_DSN",
    ])(
      "redacts a bare, non-URL-shaped value under %s (key content alone, not the value's shape)",
      (key) => {
        // Deliberately NOT URL-shaped -- proves the key-content rule covers
        // it even when CONNECTION_URL's value-shape pattern would not.
        const message = `config: ${key}=${SECRET} (retry 1)`;
        const out = redactSecrets(message);
        expect(out).not.toContain(SECRET);
        expect(out).not.toContain("secret-XYZ");
        expect(out).toContain("config:");
        expect(out).toContain("(retry 1)");
      },
    );

    it("keeps the Postgres detail alongside a redacted quoted secret", () => {
      const message = `syntax error at or near "CREATE" (42601); config was password="${SECRET}"`;
      const out = redactSecrets(message);
      expect(out).not.toContain(SECRET);
      expect(out).toContain('syntax error at or near "CREATE" (42601)');
    });

    it("leaves a unique-constraint name that merely ends in _key untouched (no bare 'key' trigger)", () => {
      const message =
        'duplicate key value violates unique constraint "users_email_key"';
      expect(redactSecrets(message)).toBe(message);
    });

    it("leaves a real Postgres detail with no credential in it completely untouched", () => {
      const message =
        'relation "phantom_table" does not exist while running 0003_index.sql';
      expect(redactSecrets(message)).toBe(message);
    });

    it("keeps a unique-constraint name and SQL state next to a redacted secret in the same message", () => {
      const message = `duplicate key value violates unique constraint "users_email_key" (23505); retry with api_key="${SECRET}"`;
      const out = redactSecrets(message);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("secret-XYZ");
      expect(out).toContain(
        'duplicate key value violates unique constraint "users_email_key" (23505)',
      );
    });
  });

  // The 2026-09-23 re-review of PR #31 reproduced these four against HEAD
  // a430a7c: a fixed-alias list can never anticipate every key spelling
  // (Pg_Password, DB_PASS), and the escape-aware quoted-value handling had a
  // gap where an escaped quote *inside* a quoted value ended the match early,
  // leaking everything after it.
  describe("2026-09-23 re-review findings", () => {
    const RE_SECRET = "Zq9-SYNTH-7Kx";

    it.each<[string, string]>([
      ["backtick-quoted value, every alias", `password=\`${RE_SECRET}\``],
      [
        "escaped quote INSIDE a quoted value must not end the match early",
        `password="ab\\"${RE_SECRET}"`,
      ],
      [
        "alias variant not in any fixed list: Pg_Password",
        `Pg_Password=${RE_SECRET}`,
      ],
      ["key not in any fixed list at all: DB_PASS", `DB_PASS=${RE_SECRET}`],
    ])("redacts %s", (_label, message) => {
      const out = redactSecrets(message);
      expect(out).not.toContain(RE_SECRET);
      expect(out).not.toContain("SYNTH-7Kx");
    });
  });

  // 2026-09-23 second re-review: `Authorization: Bearer <token>` leaked the
  // token, because the generic unquoted branch stops at the whitespace right
  // after the scheme word and only redacts "Bearer" itself. Real shape in
  // this project: src/server/scans/expire-cron.ts compares against exactly
  // `Bearer ${cronSecret}`.
  describe("2026-09-23: auth-scheme values (Bearer/Basic/Token/Digest)", () => {
    const AUTH_SECRET = "Zq9-SYNTH-7Kx";

    it.each<[string, string]>([
      ["Authorization, Bearer", `Authorization: Bearer ${AUTH_SECRET}`],
      [
        "authorization (lowercase), Bearer",
        `authorization: Bearer ${AUTH_SECRET}`,
      ],
      [
        "Proxy-Authorization, Bearer",
        `Proxy-Authorization: Bearer ${AUTH_SECRET}`,
      ],
      ["Authorization, Basic", `Authorization: Basic ${AUTH_SECRET}`],
      ["Authorization, Token", `Authorization: Token ${AUTH_SECRET}`],
      ["Authorization, Digest", `Authorization: Digest ${AUTH_SECRET}`],
    ])("redacts the token after the scheme word: %s", (_label, message) => {
      const out = redactSecrets(message);
      expect(out).not.toContain(AUTH_SECRET);
      expect(out).not.toContain("SYNTH-7Kx");
      // the scheme word itself is not the thing we need back, but the key
      // and structure should still read as an authorization line
      expect(out.toLowerCase()).toContain("authorization");
    });
  });

  // Combinatorial coverage: the earlier suite was a hand-picked list of
  // examples, which is exactly why four real leaking forms slipped past it.
  // This generates every combination of key shape (a content word with an
  // arbitrary prefix and/or suffix) x quote style (none, ", ', `, each with
  // and without an escaped inner quote) x separator (`=`/`:`, each with and
  // without surrounding spaces), and asserts the secret is absent from every
  // single one of them.
  describe("combinatorial: key shape x quote style x separator", () => {
    const CREDENTIAL_WORDS = [
      "pass",
      "pwd",
      "secret",
      "token",
      "credential",
      "auth",
      "url",
      "dsn",
      "api_key",
      "access_key",
      "private_key",
    ];
    const PREFIXES = ["", "DB_", "my_", "Pg-"];
    const SUFFIXES = ["", "_2", "-value"];

    function buildKeyShapes(): string[] {
      const shapes = new Set<string>();
      for (const word of CREDENTIAL_WORDS) {
        for (const prefix of PREFIXES) {
          for (const suffix of SUFFIXES) {
            shapes.add(`${prefix}${word}${suffix}`);
          }
        }
      }
      return [...shapes];
    }

    function escapeInsert(secret: string, quoteChar: string): string {
      const mid = Math.floor(secret.length / 2);
      return secret.slice(0, mid) + "\\" + quoteChar + secret.slice(mid);
    }

    const QUOTE_STYLES: Array<{ label: string; wrap: (s: string) => string }> =
      [
        { label: "unquoted", wrap: (s) => s },
        { label: "double-quoted", wrap: (s) => `"${s}"` },
        {
          label: "double-quoted, escaped inner quote",
          wrap: (s) => `"${escapeInsert(s, '"')}"`,
        },
        { label: "single-quoted", wrap: (s) => `'${s}'` },
        {
          label: "single-quoted, escaped inner quote",
          wrap: (s) => `'${escapeInsert(s, "'")}'`,
        },
        { label: "backtick-quoted", wrap: (s) => `\`${s}\`` },
        {
          label: "backtick-quoted, escaped inner quote",
          wrap: (s) => `\`${escapeInsert(s, "`")}\``,
        },
      ];

    const SEPARATORS = [
      { label: "= tight", text: "=" },
      { label: "= spaced", text: " = " },
      { label: ": tight", text: ":" },
      { label: ": spaced", text: " : " },
    ];

    const KEY_SHAPES = buildKeyShapes();
    const COMBO_SECRET = "Xk7-Combo-Marker-99";

    it(`redacts the secret in every combination (${
      KEY_SHAPES.length
    } key shapes x ${QUOTE_STYLES.length} quote styles x ${
      SEPARATORS.length
    } separators = ${
      KEY_SHAPES.length * QUOTE_STYLES.length * SEPARATORS.length
    } cases)`, () => {
      const failures: string[] = [];
      let total = 0;
      for (const key of KEY_SHAPES) {
        for (const quote of QUOTE_STYLES) {
          for (const separator of SEPARATORS) {
            total += 1;
            const message = `context before ${key}${separator.text}${quote.wrap(
              COMBO_SECRET,
            )} context after`;
            const out = redactSecrets(message);
            if (out.includes(COMBO_SECRET)) {
              failures.push(
                `key="${key}" quote="${quote.label}" separator="${separator.label}" -> ${out}`,
              );
            }
          }
        }
      }
      expect(total).toBe(
        KEY_SHAPES.length * QUOTE_STYLES.length * SEPARATORS.length,
      );
      expect(failures).toEqual([]);
    });
  });

  // ReDoS guard, testing the PROPERTY (linear in input length) rather than a
  // sample of adversarial shapes -- a sample is exactly what let the
  // 2026-09-23 re-review's quadratic regression through: none of the first
  // round's adversarial inputs happened to contain a fragment word with no
  // separator following it.
  //
  // The earlier (unbounded `[\w-]*`) version was quadratic on exactly that
  // shape: a long run of word characters built from one or more credential
  // fragments with no `:`/`=` anywhere. Every fragment match found while the
  // leading `[\w-]*` backtracked triggered its own full backtracking search,
  // by the trailing `[\w-]*`, for a separator that never appeared --
  // O(matches) x O(remaining length) = O(n^2). CREDENTIAL_KEY now bounds
  // both sides to `{0,64}`, which caps that cost at a constant per match
  // regardless of how long the surrounding run is -- a single hard time
  // budget across a size ladder (fixed budget, growing input) is what turns
  // "looks fast" into "provably not quadratic": a quadratic algorithm cannot
  // hit the same low budget at 1 MB that it hits at 80 KB.
  describe("performance (linear-time property, not a sample)", () => {
    const alternatingQuoteChars = "'\"`".repeat(20_000);
    const manyBackslashes = "\\".repeat(50_000);
    const longFragmentFreeWordRun = "x".repeat(100_000); // no pass/pwd/secret/etc/url/dsn
    const BUDGET_MS = 200;

    it.each<[string, string]>([
      ["unterminated double-quoted value", `password="${"a".repeat(100_000)}`],
      [
        "alternating stray quote characters as the value",
        `password=${alternatingQuoteChars}`,
      ],
      [
        "long run of backslashes before a stray quote",
        `token=${manyBackslashes}"`,
      ],
      [
        "long word-character run with no credential fragment, no separator",
        longFragmentFreeWordRun,
      ],
      [
        "long word-character run with no fragment, followed by a real secret",
        `${longFragmentFreeWordRun} password=${SECRET}`,
      ],
      // The re-review's exact reproduction: a repeated fragment word with no
      // separator anywhere -- ordinary prose ("Invalid password, please
      // retry") has this shape, not just adversarial input.
      [
        "2026-09-23 re-review: 'password' repeated with no separator, 100 KB",
        "password".repeat(12_500),
      ],
      [
        "2026-09-23 re-review: several fragment words repeated with no separator, 100 KB",
        "passurlauthtoken".repeat(6_250),
      ],
      // Size ladder at fixed content shape: if the cost were quadratic,
      // doubling the input would roughly quadruple the time and blow well
      // past BUDGET_MS long before 1 MB.
      ["80 KB of repeated 'password', no separator", "password".repeat(10_000)],
      [
        "160 KB of repeated 'password', no separator",
        "password".repeat(20_000),
      ],
      [
        "320 KB of repeated 'password', no separator",
        "password".repeat(40_000),
      ],
      ["1 MB of repeated 'password', no separator", "password".repeat(125_000)],
    ])(`stays within a ${BUDGET_MS}ms budget on: %s`, (_label, input) => {
      const start = performance.now();
      redactSecrets(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(BUDGET_MS);
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

  it("includes the Postgres cause of a failed query, without its secret", () => {
    const pg = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "mice_slug_unique"',
      ),
      {
        code: "23505",
        constraint: "mice_slug_unique",
        detail: `Key (slug)=(acme-test) already exists. postgresql://u:${SECRET}@h/db`,
      },
    );
    const error = new Error('Failed query: insert into "mice"', { cause: pg });
    const described = describeMigrationError(error);
    expect(described).toContain('Failed query: insert into "mice"');
    expect(described).toContain("code=23505");
    expect(described).toContain("constraint=mice_slug_unique");
    expect(described).toContain("Key (slug)=(acme-test) already exists.");
    expect(described).not.toContain(SECRET);
  });

  it.each([undefined, null, 42, {}, new Error(""), "  "])(
    "falls back to a generic message when there is no detail (%s)",
    (error) => {
      expect(describeMigrationError(error)).toMatch(/no error detail/);
    },
  );
});
