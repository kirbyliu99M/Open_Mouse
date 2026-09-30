/**
 * Structured server log: one JSON object per line, `{ level, event, route,
 * ms, ...fields }`, written to stdout (info) or stderr (warn, error) where
 * Vercel collects it. This is the only place under `src/server` and
 * `src/app/api` that may call `console.*` (tests/unit/log-no-console.test.ts
 * enforces that).
 *
 * The logs outlive the app's deletion behaviour and are read by people who
 * are not the user, so redaction is built in rather than left to each call
 * site. Nothing below can be switched off by a caller. What never reaches a
 * log line (each has a test in tests/unit/log.test.ts):
 *
 *  - hand measurements and calibration evidence (any key ending in `Mm` or
 *    `Deg`, plus `measurements`, `calibration`, `landmarks`, ...), and any
 *    "<number> mm" written inside a string;
 *  - IP addresses (keys such as `ip`, `clientIp`, `x-forwarded-for`,
 *    `rateLimitKey`; IPv4 and IPv6 literals inside strings);
 *  - cookies and session ids;
 *  - tokens, secrets, passwords, API keys, authorization headers, JWTs,
 *    bearer tokens, connection strings;
 *  - email addresses (key `email...` or an address inside a string);
 *  - a scan id in full: the key `scanId` and any UUID inside a string are
 *    replaced by the first 8 hex characters of their SHA-256 (enough to
 *    correlate two lines, not enough to open the scan);
 *  - the text of a Gemini prompt or response, and free-text fields such as
 *    `message`, `stack`, `body`: an error object is reduced to its class name
 *    and a short `code` / `status` (the SDK puts whole API response bodies in
 *    `error.message`; see analyse.ts).
 *
 * The rules match on the field NAME (and, for strings, on what the text looks
 * like). A sensitive value under an innocent name, holding a bare number, can
 * not be recognised: pass named, non-sensitive facts (`status`, `code`,
 * `op`), never a request or a result object.
 */
import { createHash } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

/** Route names used in log lines, so one event always carries the same route. */
export const LOG_ROUTES = {
  analysis: "/api/scans/[scanId]/analysis",
  health: "/api/health",
} as const;

export const REDACTED = "[redacted]";

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 300;
const MAX_KEYS = 40;
const MAX_ITEMS = 20;
/** Keys the log line itself owns; a caller's field of the same name is dropped. */
const RESERVED_KEYS = new Set(["level", "event", "route", "ms"]);

/** First 8 hex characters of SHA-256: a correlation handle, not an identifier. */
export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface KeyRule {
  category: string;
  matches(normalizedKey: string): boolean;
}

const has = (set: ReadonlySet<string>) => (key: string) => set.has(key);
const includesAny =
  (...parts: string[]) =>
  (key: string) =>
    parts.some((part) => key.includes(part));

/** The redaction rules by field name. Order does not matter; any match redacts. */
export const KEY_RULES: readonly KeyRule[] = [
  {
    category: "measurement",
    matches: (key) =>
      /(mm|deg)$/.test(key) ||
      has(
        new Set([
          "measurements",
          "measurement",
          "calibration",
          "landmarks",
          "keypoints",
          "homography",
          "cardscaleratio",
          "minsidecoverage",
        ]),
      )(key),
  },
  {
    category: "ip",
    matches: (key) =>
      has(
        new Set([
          "ip",
          "clientip",
          "remoteip",
          "remoteaddr",
          "remoteaddress",
          "callerip",
          "userip",
          "sourceip",
          "originip",
          "xforwardedfor",
          "xvercelforwardedfor",
          "xrealip",
          "forwarded",
          "forwardedfor",
          "ratelimitkey",
        ]),
      )(key) || key.endsWith("ipaddress"),
  },
  {
    category: "cookie",
    matches: (key) =>
      key.includes("cookie") ||
      has(new Set(["session", "sessionid", "sessiontoken"]))(key),
  },
  {
    category: "token",
    matches: (key) =>
      includesAny(
        "token",
        "secret",
        "password",
        "passwd",
        "authorization",
        "apikey",
        "privatekey",
        "accesskey",
        "bearer",
        "credential",
        "connectionstring",
      )(key) ||
      has(new Set(["auth", "jwt", "dsn", "databaseurl", "dburl", "connstr"]))(
        key,
      ),
  },
  {
    category: "email",
    matches: (key) => key.includes("email") || key === "mail",
  },
  {
    // Not dropped: hashed, see redactField.
    category: "scanId",
    matches: (key) => key.endsWith("scanid"),
  },
  {
    category: "model-text",
    matches: (key) =>
      includesAny(
        "prompt",
        "systeminstruction",
        "rawresponse",
        "responsetext",
        "modeloutput",
        "completion",
      )(key) ||
      has(
        new Set([
          "response",
          "raw",
          "output",
          "body",
          "requestbody",
          "responsebody",
          "payload",
          "text",
          "content",
          "candidates",
          "answer",
          "generated",
        ]),
      )(key),
  },
  {
    category: "error-detail",
    matches: has(
      new Set([
        "message",
        "errormessage",
        "stack",
        "detail",
        "details",
        "cause",
        "query",
        "params",
        "sql",
        "statement",
      ]),
    ),
  },
];

/** Category names, for docs and tests. */
export const REDACTION_CATEGORIES = KEY_RULES.map((rule) => rule.category);

function categoryOfKey(key: string): string | null {
  const normalized = normalizeKey(key);
  return KEY_RULES.find((rule) => rule.matches(normalized))?.category ?? null;
}

interface StringRule {
  name: string;
  pattern: RegExp;
  replace: string | ((match: string) => string);
}

/** What text looks like when it must not be logged, whatever key it sits under. */
export const STRING_RULES: readonly StringRule[] = [
  {
    name: "uuid",
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replace: (match) => `id:${shortHash(match.toLowerCase())}`,
  },
  {
    name: "connection-string",
    pattern:
      /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*@[^\s"'<>]+|postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
    replace: "[redacted-url]",
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    replace: "[redacted-token]",
  },
  {
    name: "bearer",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replace: "Bearer [redacted-token]",
  },
  {
    name: "email",
    pattern:
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    replace: "[redacted-email]",
  },
  {
    name: "ipv4",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replace: "[redacted-ip]",
  },
  {
    // Four or more groups, or any "::" form (so a clock time is left alone).
    name: "ipv6",
    pattern:
      /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|(?<![0-9a-z])(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?(?![0-9a-z:])/gi,
    replace: "[redacted-ip]",
  },
  {
    name: "millimetres",
    pattern: /\b\d+(?:\.\d+)?\s?mm\b/gi,
    replace: "[redacted-measurement]",
  },
  {
    // API keys and other opaque secrets: a long unbroken run of key characters.
    name: "long-token",
    pattern: /\b[A-Za-z0-9_-]{32,}\b/g,
    replace: "[redacted-token]",
  },
];

/** Redacts the sensitive patterns inside one string, then bounds its length. */
export function scrubString(text: string): string {
  let out = text;
  for (const rule of STRING_RULES) {
    out =
      typeof rule.replace === "string"
        ? out.replace(rule.pattern, rule.replace)
        : out.replace(rule.pattern, rule.replace);
  }
  return out.length > MAX_STRING_LENGTH
    ? `${out.slice(0, MAX_STRING_LENGTH)}…`
    : out;
}

function redactError(error: Error): Record<string, unknown> {
  // Class name plus at most a short code / status. Never message, stack, cause.
  const out: Record<string, unknown> = { name: scrubString(error.name) };
  for (const key of ["code", "status"] as const) {
    const value = (error as unknown as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "number") {
      out[key] = typeof value === "string" ? scrubString(value) : value;
    }
  }
  return out;
}

function redactField(key: string, value: unknown): unknown {
  const category = categoryOfKey(key);
  if (category === null) return undefined;
  // The scan id is the one thing kept in a form that still correlates.
  if (category === "scanId" && typeof value === "string") {
    return `id:${shortHash(value.toLowerCase())}`;
  }
  return REDACTED;
}

/**
 * Returns a copy of `value` that is safe to serialise: sensitive fields
 * replaced, strings scrubbed, depth / width / length bounded, cycles broken.
 */
export function redact(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case "string":
      return scrubString(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "object":
      break;
    default:
      return "[unserializable]";
  }
  const object = value as object;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(object)) return "[circular]";
  seen.add(object);
  try {
    if (object instanceof Error) return redactError(object);
    if (object instanceof Date) {
      return Number.isNaN(object.getTime()) ? null : object.toISOString();
    }
    if (Array.isArray(object)) {
      const items = object
        .slice(0, MAX_ITEMS)
        .map((item) => redact(item, depth + 1, seen));
      if (object.length > MAX_ITEMS) {
        items.push(`[+${object.length - MAX_ITEMS} more]`);
      }
      return items;
    }
    if (object instanceof Map || object instanceof Set) {
      return "[unserializable]";
    }
    const out: Record<string, unknown> = {};
    const entries = Object.entries(object as Record<string, unknown>);
    for (const [key, item] of entries.slice(0, MAX_KEYS)) {
      const replaced = redactField(key, item);
      out[key] =
        replaced !== undefined ? replaced : redact(item, depth + 1, seen);
    }
    if (entries.length > MAX_KEYS)
      out["…"] = `+${entries.length - MAX_KEYS} keys`;
    return out;
  } finally {
    seen.delete(object);
  }
}

export interface LogFields {
  /** The route this event belongs to (see `LOG_ROUTES`), when there is one. */
  route?: string | null;
  /** Duration of the thing the event is about, in milliseconds. */
  ms?: number | null;
  [key: string]: unknown;
}

/** The exact line that would be written, as a JSON string (pure, for tests). */
export function formatLogLine(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): string {
  try {
    const { route, ms, ...rest } = fields;
    const line: Record<string, unknown> = {
      level,
      event: scrubString(event),
      route: typeof route === "string" ? scrubString(route) : null,
      ms: typeof ms === "number" && Number.isFinite(ms) ? Math.round(ms) : null,
    };
    const safe = redact(rest) as Record<string, unknown>;
    for (const [key, value] of Object.entries(safe)) {
      if (!RESERVED_KEYS.has(key)) line[key] = value;
    }
    return JSON.stringify(line);
  } catch {
    // A getter that throws, or anything else unforeseen: a log call must
    // never throw into a request, and must not fall back to printing the
    // fields it could not redact.
    return JSON.stringify({
      level,
      event: "log.serialize_failed",
      route: null,
      ms: null,
    });
  }
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const line = formatLogLine(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
