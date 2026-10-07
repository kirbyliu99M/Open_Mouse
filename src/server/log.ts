/**
 * Structured server log: one JSON object per line, `{ level, event, route,
 * ms, ...fields }`, written to stdout (info) or stderr (warn, error) where
 * Vercel collects it; an error line is also sent to Sentry as a message.
 * This is the only place under `src/server` and
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
 * Also: fields named `error`, `msg`, `description`, `reason` and the like keep
 * only a short lower-case token ("timeout", "proceed_without_limit"), never a
 * sentence; `key=value` pairs (`password=`, `token=`, `api_key=`, ...) inside a
 * string lose the value; object KEY names are scrubbed like any text; bytes
 * (Buffer, typed arrays) print as a size; and everything is bounded: a string
 * is cut at 2000 characters before any pattern runs, a line visits at most 500
 * values, and the finished line is at most 8 KB (fields are dropped from the
 * end and the line says so).
 *
 * The rules match on the field NAME (and, for strings, on what the text looks
 * like). A sensitive value under an innocent name, holding a bare number, can
 * not be recognised: pass named, non-sensitive facts (`status`, `code`,
 * `op`), never a request or a result object.
 */
import { createHash } from "node:crypto";
import * as Sentry from "@sentry/nextjs";

export type LogLevel = "info" | "warn" | "error";

/** Route names used in log lines, so one event always carries the same route. */
export const LOG_ROUTES = {
  analysis: "/api/scans/[scanId]/analysis",
  health: "/api/health",
} as const;

export const REDACTED = "[redacted]";

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 300;
/**
 * Text longer than this is cut BEFORE any pattern runs, so the cost of
 * scrubbing one string is bounded whatever a caller passes in (several
 * patterns are quadratic on a long unbroken run of key characters).
 */
const MAX_INPUT_LENGTH = 512;
/**
 * All the text one line may run patterns over, in characters. Each string (and
 * each key name) draws on it; once it is spent, further strings are replaced
 * by a marker unread. Bounds the total cost of a line whatever its shape:
 * 500 values of 512 characters each would otherwise cost seconds.
 */
const MAX_TEXT_BUDGET = 16_384;
const BUDGET_SPENT = "[text budget exhausted]";
/** Values visited in one line, counting every entry, so a shared reference cannot fan out. */
const MAX_NODES = 500;
/** The finished line, in bytes; over it, whole fields are dropped and the line says so. */
export const MAX_LINE_BYTES = 8192;
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
    // Field names that carry a sentence. Only a short lower-case token (an
    // enumerated reason such as "timeout") is kept, see redactField; any other
    // string or number is dropped, an Error is reduced as usual.
    category: "free-text",
    matches: has(
      new Set([
        "error",
        "errors",
        "err",
        "errormsg",
        "errmsg",
        "msg",
        "description",
        "reason",
        "exception",
      ]),
    ),
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
    // password=..., "token": "...", api_key: ..., authorization: Bearer ...
    // The name is kept, the value goes.
    name: "secret-assignment",
    pattern:
      /(password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|authorization|cookie|session[_-]?id)["']?\s*[=:＝：]\s*(?:(?:Bearer|Basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&"'}\]]+)/gi,
    replace: (match) => `${/^[A-Za-z_-]+/.exec(match)![0]}=[redacted]`,
  },
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
    pattern: /\b\d+(?:[.,]\d+)?\s?mm\b/gi,
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
  let cut = false;
  if (out.length > MAX_INPUT_LENGTH) {
    // Drop the half-word left at the cut too: a fragment of an address or key
    // matches no pattern and would otherwise survive.
    out = out.slice(0, MAX_INPUT_LENGTH).replace(/\S+$/, "");
    cut = true;
  }
  for (const rule of STRING_RULES) {
    out =
      typeof rule.replace === "string"
        ? out.replace(rule.pattern, rule.replace)
        : out.replace(rule.pattern, rule.replace);
  }
  if (out.length > MAX_STRING_LENGTH) {
    return `${out.slice(0, MAX_STRING_LENGTH)}…`;
  }
  return cut ? `${out}…` : out;
}

/** `scrubString`, charged against the line's text budget. */
function scrubWithin(state: RedactState, text: string): string {
  if (state.chars <= 0) return BUDGET_SPENT;
  state.chars -= Math.min(text.length, MAX_INPUT_LENGTH);
  return scrubString(text);
}

function redactError(
  error: Error,
  state: RedactState,
): Record<string, unknown> {
  // Class name plus at most a short code / status. Never message, stack, cause.
  const out: Record<string, unknown> = { name: scrubWithin(state, error.name) };
  for (const key of ["code", "status"] as const) {
    const value = (error as unknown as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "number") {
      out[key] = typeof value === "string" ? scrubWithin(state, value) : value;
    }
  }
  return out;
}

/** A short lower-case identifier: an enumerated value, never a sentence. */
const ENUM_TOKEN = /^[a-z][a-z0-9_.:-]{0,39}$/;

function redactField(key: string, value: unknown, state: RedactState): unknown {
  const category = categoryOfKey(key);
  if (category === null) return undefined;
  if (category === "free-text") {
    // Nothing to hide in an absent or empty value: keep it as it is.
    if (
      value === null ||
      value === undefined ||
      value === false ||
      value === 0
    ) {
      return undefined;
    }
    if (typeof value === "string") {
      return ENUM_TOKEN.test(value) ? undefined : REDACTED;
    }
    if (Array.isArray(value)) {
      // Same limits as any other array: at most MAX_ITEMS entries, each one
      // counted against the line's value budget, however long `value` claims
      // to be.
      const items = value.slice(0, MAX_ITEMS).map((item) => {
        state.nodes += 1;
        if (state.nodes > MAX_NODES) return "[truncated]";
        return typeof item === "string" && ENUM_TOKEN.test(item)
          ? item
          : REDACTED;
      });
      if (value.length > MAX_ITEMS) {
        items.push(`[+${value.length - MAX_ITEMS} more]`);
      }
      return items;
    }
    // An Error or another object is reduced by the normal walk.
    if (typeof value === "object" && value !== null) return undefined;
    return REDACTED;
  }
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
export interface RedactState {
  seen: WeakSet<object>;
  /** Characters of text still allowed to be scanned in this line. */
  chars: number;
  nodes: number;
}

export function redact(
  value: unknown,
  depth = 0,
  state: RedactState = {
    seen: new WeakSet(),
    nodes: 0,
    chars: MAX_TEXT_BUDGET,
  },
): unknown {
  if ((state.nodes += 1) > MAX_NODES) return "[truncated]";
  const seen = state.seen;
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case "string":
      return scrubWithin(state, value);
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
    if (object instanceof Error) return redactError(object, state);
    if (object instanceof Date) {
      return Number.isNaN(object.getTime()) ? null : object.toISOString();
    }
    // Bytes (a Buffer is a Uint8Array): the content is never printed.
    if (
      ArrayBuffer.isView(object) ||
      object instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== "undefined" &&
        object instanceof SharedArrayBuffer)
    ) {
      return `[binary ${(object as ArrayBufferView).byteLength} bytes]`;
    }
    if (Array.isArray(object)) {
      const items = object
        .slice(0, MAX_ITEMS)
        .map((item) => redact(item, depth + 1, state));
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
      const replaced = redactField(key, item, state);
      // The name is text too: an address, an email or an id used as a key.
      const clean = scrubWithin(state, key);
      let name = clean;
      for (let n = 2; name in out; n += 1) name = `${clean}#${n}`;
      out[name] =
        replaced !== undefined ? replaced : redact(item, depth + 1, state);
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

/**
 * Serialises `line`; if it is over `MAX_LINE_BYTES`, drops fields from the end
 * (never level, event, route, ms) until it fits and says how many went, so the
 * line stays valid JSON and never silently loses data.
 */
function capLine(line: Record<string, unknown>): string {
  const whole = JSON.stringify(line);
  const size = Buffer.byteLength(whole);
  if (size <= MAX_LINE_BYTES) return whole;
  const entries = Object.entries(line);
  const fixed = Object.fromEntries(entries.slice(0, 4));
  const extra = entries.slice(4);
  for (let keep = extra.length - 1; keep >= 0; keep -= 1) {
    const candidate = JSON.stringify({
      ...fixed,
      ...Object.fromEntries(extra.slice(0, keep)),
      truncated: { droppedFields: extra.length - keep, originalBytes: size },
    });
    if (Buffer.byteLength(candidate) <= MAX_LINE_BYTES) return candidate;
  }
  return JSON.stringify({
    ...fixed,
    truncated: { droppedFields: extra.length, originalBytes: size },
  });
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
    return capLine(line);
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
  if (level === "error") {
    console.error(line);
    // The finished, redacted line, never the caller's fields: Sentry gets
    // exactly what the log got. A no-op when Sentry is off.
    Sentry.captureMessage(event, {
      level: "error",
      extra: JSON.parse(line) as Record<string, unknown>,
    });
  } else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
