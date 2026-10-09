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
// to call it) simply isn't in it. The prefix/suffix wildcards on each
// fragment *are* "contains, with any prefix or suffix" — not a growing list
// of full names.
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

// BOUNDED, not unbounded. Real credential key names are short — nothing in
// this codebase or a typical driver/env var is anywhere near 64 characters —
// so a bounded repetition caps the backtracking cost of the prefix/suffix at
// a constant per candidate position. That is what makes matching linear in
// the input length BY CONSTRUCTION: a property to state, not a claim to hope
// holds.
//
// This replaces an earlier version using unbounded `[\w-]*`, which the
// 2026-09-23 re-review found quadratic on ordinary prose, not just
// adversarial input ("Invalid password, please retry" was enough to show
// it). The `\b` anchor before the key (below) stops the *leading* `[\w-]*`
// from restarting at every position in a long word run, but with an
// unbounded *trailing* `[\w-]*`, every position within that single attempt
// where a fragment happens to match (there can be many, in a run built from
// repeated fragment words) triggered its own full backtracking search for a
// `:`/`=` that was never going to appear — O(matches found) x O(remaining
// length) = O(n^2) overall. Bounding both sides to a constant caves that
// enumeration down to a constant number of candidate splits, each doing a
// constant amount of work, independent of the input length.
const CREDENTIAL_KEY = String.raw`[\w-]{0,64}(?:${CREDENTIAL_WORD})[\w-]{0,64}`;

// A bare scheme word before whitespace ("Bearer", "Basic", "Token",
// "Digest") is not itself the secret — the real credential is the token
// after it. Without this, the generic unquoted branch below stops at the
// first whitespace and only redacts the scheme word, leaking the token:
// `Authorization: Bearer <token>` became `Authorization: [redacted] <token>`.
// This is a real shape here (`src/server/scans/expire-cron.ts` compares
// against `` `Bearer ${cronSecret}` ``), and matching it also covers
// `Proxy-Authorization` / any other key that merely *contains* "auth".
const AUTH_SCHEME_VALUE = String.raw`(?:bearer|basic|token|digest)\s+[^\s,;&]+`;

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
// quote inside the value does not end it — an earlier bug's exact failure),
// an auth-scheme word followed by its token (see AUTH_SCHEME_VALUE above),
// or, unquoted, a run up to the next real separator (whitespace, `,`, `;`,
// `&`) that *includes* any stray quote/backtick found inside it. Each
// branch commits to a distinct leading shape (`"`, `'`, `` ` ``, a literal
// scheme word, or "none of those"), so they never overlap.
//
// `\b` immediately before the key match, combined with CREDENTIAL_KEY's
// bounded quantifiers above, is what keeps this linear: it stops the
// leading `[\w-]{0,64}` from being (re-)attempted at internal positions
// inside a long run of word characters that never contains a credential
// fragment (e.g. a long hex/base64 blob), so only genuine word-boundary
// starts pay the (now constant) cost of the key match.
const KEY_VALUE_PAIR = new RegExp(
  String.raw`(["'\`]?)\b(${CREDENTIAL_KEY})\b\1?` + // key, optionally quoted (", ' or `)
    String.raw`(\s*[:=]\s*)` + // `=` or `:`, with optional surrounding whitespace
    String.raw`(?:` +
    String.raw`"(?:\\.|[^"\\])*"` + // double-quoted, escape-aware
    String.raw`|'(?:\\.|[^'\\])*'` + // single-quoted, escape-aware
    String.raw`|\`(?:\\.|[^\`\\])*\`` + // backtick-quoted, escape-aware
    String.raw`|${AUTH_SCHEME_VALUE}` + // "Bearer <token>" and friends
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
    .replace(KEY_VALUE_PAIR, redactCredentialValue)
    .replace(PG_KEY_DETAIL, redactPgKeyDetail)
    .replace(PG_FAILING_ROW, "Failing row contains ([redacted])");
}

// Postgres error details carry column values in two shapes the key=value
// pattern above cannot see: "Key (col)=(value) already exists." (unique and
// foreign keys) and "Failing row contains (v1, v2, …)." (check and not-null;
// no column names). A Key value is redacted when a column name looks like a
// credential; a failing row is always redacted, since nothing says which
// value is which. The constraint name, which is what debugging needs, stays.
const PG_KEY_DETAIL = /Key \(([^()]*)\)=\(((?:[^()]|\([^()]*\))*)\)/g;
const PG_FAILING_ROW = /Failing row contains \((?:[^()]|\([^()]*\))*\)/g;
const CREDENTIAL_COLUMN = new RegExp(
  String.raw`\b(?:${CREDENTIAL_KEY})\b`,
  "i",
);

function redactPgKeyDetail(match: string, columns: string): string {
  return CREDENTIAL_COLUMN.test(columns)
    ? `Key (${columns})=([redacted])`
    : match;
}

/**
 * Drizzle wraps a failed statement as "Failed query: …" and keeps the
 * Postgres error (code, constraint, detail) in `cause`; without it a seed
 * failure says nothing about why. Walks the cause chain, a few levels deep.
 */
function causeDetails(error: Error): string[] {
  const out: string[] = [];
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 3 && cause instanceof Error; depth += 1) {
    const pg = cause as Error & {
      code?: unknown;
      constraint?: unknown;
      detail?: unknown;
      column?: unknown;
    };
    const extra = (["code", "constraint", "column", "detail"] as const)
      .filter((k) => typeof pg[k] === "string" && pg[k] !== "")
      .map((k) => `${k}=${String(pg[k])}`);
    const piece = [cause.message, ...extra].filter(Boolean).join(" ");
    if (piece) out.push(piece);
    cause = cause.cause;
  }
  return out;
}

export function describeMigrationError(error: unknown): string {
  if (error instanceof DatabaseConfigurationError) return error.message;
  const detail =
    error instanceof Error
      ? [error.message, ...causeDetails(error)]
          .filter(Boolean)
          .join(" | cause: ")
      : typeof error === "string"
        ? error
        : "";
  const safe = redactSecrets(detail).trim();
  return safe
    ? `Migration failed: ${safe}`
    : "Migration failed with no error detail. Check the database configuration and branch access.";
}
