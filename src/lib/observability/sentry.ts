/**
 * The Sentry options shared by the browser, Node and edge runtimes
 * (src/instrumentation-client.ts, sentry.server.config.ts,
 * sentry.edge.config.ts), and the scrubbing every event, breadcrumb and span
 * passes through before it leaves.
 *
 * Sentry's defaults collect far more than this app may send: request bodies
 * (the POSTed hand measurements), cookies and headers, local variables in
 * stack frames, database query parameters and Gemini prompts and responses.
 * `DATA_COLLECTION` turns every one of them off. What is left is the error
 * itself, its stack, and the URLs and span names of what ran; `scrubText`
 * then removes from that text what src/server/log.ts keeps out of a log line:
 * scan ids (a scan id in a URL opens the scan), millimetre values, email
 * addresses, IP addresses, secret assignments, bearer tokens, JWTs, long
 * opaque tokens and connection strings.
 *
 * No Session Replay: it records the page, and the scan page shows the camera
 * (hard rule 5). No `setUser`.
 *
 * Client-safe on purpose (no `node:` imports): the browser bundle uses it too,
 * which is why it does not reuse log.ts's rules (that module hashes with
 * node:crypto).
 */
import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/nextjs";

type DataCollection = NonNullable<BrowserOptions["dataCollection"]>;
type StreamedSpanJSON = Parameters<
  NonNullable<BrowserOptions["beforeSendSpan"]>
>[0];

/**
 * The DSN is public by design (it only lets a client send events), so one
 * `NEXT_PUBLIC_` variable serves all three runtimes. Unset — local runs, CI,
 * the e2e suite — means Sentry is off and nothing is sent.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

/** Share of requests traced. Below 1 to stay inside the free span quota. */
export const TRACES_SAMPLE_RATE = 0.8;

export const DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  // The user agent is what tells one phone's failure from another's.
  httpHeaders: { request: { allow: ["user-agent"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

const TEXT_RULES: readonly [RegExp, string | ((match: string) => string)][] = [
  [
    // password=..., "token": "...", api_key: ..., cookie: ... (as in log.ts).
    // The name is kept, the value goes.
    /(password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|authorization|cookie|session[_-]?id)["']?\s*[=:＝：]\s*(?:(?:Bearer|Basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&"'}\]]+)/gi,
    (match) => `${/^[A-Za-z_-]+/.exec(match)![0]}=[redacted]`,
  ],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "[id]",
  ],
  [
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>/]*@[^\s"'<>]+|postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
    "[redacted-url]",
  ],
  [
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    "[redacted-token]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]"],
  [
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    "[redacted-email]",
  ],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]"],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, "[redacted-ip]"],
  [/\b\d+(?:[.,]\d+)?\s?mm\b/gi, "[redacted-measurement]"],
  [
    // API keys and other opaque secrets: a long unbroken run of key
    // characters. Exactly 32 lowercase hex is a Sentry trace id, kept so an
    // error can still be matched to its trace.
    /\b(?![0-9a-f]{32}\b)[A-Za-z0-9_-]{32,}\b/g,
    "[redacted-token]",
  ],
];

/** Redacts scan ids, measurements, contact and credential patterns in one string. */
export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_RULES) {
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement);
  }
  return out;
}

const MAX_DEPTH = 6;

/** `scrubText` applied to every string inside a JSON-like value; returns a copy. */
export function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = scrubDeep(item, depth + 1);
  }
  return out;
}

/**
 * `beforeSend`. Only the fields that carry text from the app or the user are
 * scrubbed; ids Sentry itself assigns (event, trace, span) look like long hex
 * runs and are left alone.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.server_name;
  if (event.message) event.message = scrubText(event.message);
  if (event.transaction) event.transaction = scrubText(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.request) {
    const { url, method, headers } = event.request;
    event.request = {
      ...(url ? { url: scrubText(url) } : {}),
      ...(method ? { method } : {}),
      ...(headers?.["user-agent"]
        ? { headers: { "user-agent": headers["user-agent"] } }
        : {}),
    };
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  if (event.extra) event.extra = scrubDeep(event.extra) as typeof event.extra;
  if (event.tags) event.tags = scrubDeep(event.tags) as typeof event.tags;
  // Next's `onRequestError` puts the concrete request path (a scan id with it)
  // in `contexts.nextjs`. The trace context holds only Sentry's own ids.
  if (event.contexts) {
    const { trace, ...rest } = event.contexts;
    event.contexts = {
      ...(scrubDeep(rest) as typeof rest),
      ...(trace ? { trace } : {}),
    };
  }
  return event;
}

/** `beforeBreadcrumb`: messages and data (fetch URLs among them) scrubbed. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    ...(breadcrumb.message ? { message: scrubText(breadcrumb.message) } : {}),
    ...(breadcrumb.data
      ? { data: scrubDeep(breadcrumb.data) as Breadcrumb["data"] }
      : {}),
  };
}

/** `beforeSendSpan`: the span name and its string attributes scrubbed. */
export function scrubSpan(span: StreamedSpanJSON): StreamedSpanJSON {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(span.attributes)) {
    attributes[key] = typeof value === "string" ? scrubText(value) : value;
  }
  return {
    ...span,
    name: scrubText(span.name),
    attributes: attributes as StreamedSpanJSON["attributes"],
  };
}

/** The options every runtime passes to `Sentry.init`. */
export const SENTRY_OPTIONS = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_DSN !== undefined,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  dataCollection: DATA_COLLECTION,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSendSpan: scrubSpan,
};
