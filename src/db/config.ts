type DatabaseVariable = "DATABASE_URL" | "DATABASE_URL_UNPOOLED";

export class DatabaseConfigurationError extends Error {}

export function requireDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
  key: DatabaseVariable,
): string {
  const value = env[key]?.trim();
  const message = `Set ${key} to a valid PostgreSQL connection URL.`;
  if (!value) throw new DatabaseConfigurationError(message);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Never include the supplied connection string in errors or logs.
    throw new DatabaseConfigurationError(message);
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length <= 1 ||
    url.hostname.startsWith("ep-example")
  ) {
    throw new DatabaseConfigurationError(message);
  }
  return value;
}

export function requirePreviewDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const connection = requireDatabaseUrl(env, "DATABASE_URL_UNPOOLED");
  const productionHost = env.DATABASE_PRODUCTION_HOST?.trim().toLowerCase();
  if (!productionHost || !/^[a-z0-9-]+\.[a-z0-9.-]+$/.test(productionHost)) {
    throw new DatabaseConfigurationError(
      "Set DATABASE_PRODUCTION_HOST before running preview migrations.",
    );
  }

  const previewHost = new URL(connection).hostname.toLowerCase();
  // Pooled and unpooled Neon hosts address the same endpoint.
  if (
    previewHost.replace("-pooler.", ".") ===
    productionHost.replace("-pooler.", ".")
  ) {
    throw new DatabaseConfigurationError(
      "Preview migrations must use a separate database endpoint.",
    );
  }
  return connection;
}

const CONNECTION_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`]+/gi;

// A key is treated as a credential when its name CONTAINS one of these words,
// case-insensitively, with any prefix or suffix — `DB_PASS`, `Pg_Password`,
// `my_api_token`, `MY_SECRET_2`, `POSTGRES_URL_NON_POOLING`, `db_dsn`,
// `SENTRY_DSN` all match via `pass`/`token`/`secret`/`url`/`dsn`. This
// replaces a fixed alias list: a list only ever covers the exact names it was
// written for, and the next `DB_PASS` (or whatever a driver/env var happens
// to call it) simply isn't in it. The `[\w-]*` on both sides of each fragment
// *is* "contains, with any prefix or suffix" — not a growing list of full
// names.
//
// `url` and `dsn` are included on the same fail-toward-redacting principle:
// a `DATABASE_URL`-style key is exactly the field most likely to carry a
// credential, and its value may be malformed, truncated, or otherwise not
// URL-shaped in a way that defeats CONNECTION_URL below — the key name is
// the more reliable signal. Over-redacting `baseUrl=…` in a log line is an
// acceptable cost; under-redacting a connection string is not.
//
// Deliberately excludes a bare "key": Postgres unique-constraint names look
// like `users_email_key`, and those must stay readable in migration errors.
// The compounds that really mean a credential — `api_key`, `access_key`,
// `private_key` — are still covered as explicit alternatives.
const CREDENTIAL_WORD =
  "pass|pwd|secret|token|credential|auth|url|dsn|api[_-]?key|access[_-]?key|private[_-]?key";
const CREDENTIAL_KEY = String.raw`[\w-]*(?:${CREDENTIAL_WORD})[\w-]*`;

// Matches a credential-shaped `key = value` / `key: value` assignment —
// quoted key or not, any separator spacing. The key itself is restricted to
// CREDENTIAL_KEY (rather than "any identifier", filtered afterwards) so a
// non-credential word before `:` or `=` — `relation:`, `config:` — never
// starts a match at all; letting it match and then discarding it in the
// replacer would still let its unquoted value (see below) swallow a real
// secret sitting right after it, hiding it from ever being tested.
//
// The value is one of, tried in order: a double-, single- or backtick-quoted
// string using the standard escape-aware form `(?:\\.|[^"\\])*` (an escaped
// quote inside the value does not end it — the earlier bug's exact failure),
// or, unquoted, a run up to the next real separator (whitespace, `,`, `;`,
// `&`) that *includes* any stray quote/backtick found inside it. The four
// branches each commit to a distinct leading character (`"`, `'`, `` ` ``, or
// "none of those"), so they never overlap and this stays linear-time with no
// backtracking blowup.
// `\b` immediately before the key match matters for more than style: without
// it, the greedy `[\w-]*` prefix inside CREDENTIAL_KEY would be re-attempted
// at *every* position inside a long run of word characters that never
// contains a credential fragment (e.g. a long hex/base64 blob), and each of
// those attempts individually backtracks across the rest of the run — O(n)
// attempts x O(n) backtrack each = O(n^2). Requiring a real word boundary to
// even start collapses that back to O(n) total.
const KEY_VALUE_PAIR = new RegExp(
  String.raw`(["'\`]?)\b(${CREDENTIAL_KEY})\b\1?` + // key, optionally quoted (", ' or `)
    String.raw`(\s*[:=]\s*)` + // `=` or `:`, with optional surrounding whitespace
    String.raw`(?:` +
    String.raw`"(?:\\.|[^"\\])*"` + // double-quoted, escape-aware
    String.raw`|'(?:\\.|[^'\\])*'` + // single-quoted, escape-aware
    String.raw`|\`(?:\\.|[^\`\\])*\`` + // backtick-quoted, escape-aware
    String.raw`|[^\s,;&]+` + // unquoted, up to the next real separator
    String.raw`)`,
  "gi",
);

function redactCredentialValue(
  _match: string,
  _keyQuote: string,
  key: string,
  separator: string,
): string {
  return `${key}${separator}[redacted]`;
}

/**
 * Makes a driver or SQL error safe for build logs while keeping it useful.
 * Connection URLs and credential pairs are replaced; everything else — the
 * failing statement, Postgres error text, constraint names — survives, because
 * a migration failure you cannot read is a migration failure you cannot fix.
 *
 * Redaction is fail-toward-safe: an ambiguous or over-eager match costs a
 * slightly less useful log line, never a leaked credential.
 */
export function redactSecrets(message: string): string {
  return message
    .replace(CONNECTION_URL, "[redacted-url]")
    .replace(KEY_VALUE_PAIR, redactCredentialValue);
}

export function describeMigrationError(error: unknown): string {
  if (error instanceof DatabaseConfigurationError) return error.message;
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const safe = redactSecrets(detail).trim();
  return safe
    ? `Migration failed: ${safe}`
    : "Migration failed with no error detail. Check the database configuration and branch access.";
}
