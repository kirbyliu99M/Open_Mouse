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

// Any key whose name matches a credential alias (case-insensitive), however
// its value is quoted. Rather than special-casing each quoting style we saw
// leak (bare, double-quoted, single-quoted, backslash-escaped, JSON `"k":"v"`),
// this matches the *key* generically and then consumes the value up to its
// real terminator — the matching quote, if any, otherwise whitespace/`,`/`;`
// — so a value containing `=`, `:`, `@`, `&` or spaces inside quotes is still
// fully consumed instead of leaking its tail past the first such character.
const CREDENTIAL_KEY =
  "postgres_password|pgpassword|password|passwd|pwd|database_url|api[_-]?key|secret|token";
const CREDENTIAL_PAIR = new RegExp(
  String.raw`(["']?)\b(${CREDENTIAL_KEY})\b\1?` + // optional quote around the key, e.g. "password"
    String.raw`(\s*[:=]\s*)` + // `=` or `:`, with optional surrounding whitespace
    // the value: quoted (optionally backslash-escaped) and matched lazily up
    // to its own closing quote, or — with no quote — a run of non-separator
    // characters
    String.raw`(?:(\\?["'])(?:(?!\4)[\s\S])*\4|[^\s,;'"\`]+)`,
  "gi",
);

function redactCredentialPair(
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
    .replace(CREDENTIAL_PAIR, redactCredentialPair);
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
