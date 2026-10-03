import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KEY_RULES,
  LOG_ROUTES,
  REDACTION_CATEGORIES,
  formatLogLine,
  log,
  scrubString,
  shortHash,
} from "../../src/server/log";
import {
  MEASUREMENT_DEFINITIONS,
  handMeasurementsSchema,
} from "../../src/lib/contracts/measurement";

/**
 * src/server/log.ts is the only way the server writes a log line, and the
 * logs outlive the app's data promises, so what can NOT appear in one is
 * tested here field by field, at the top level and nested.
 */
const line = (fields: Record<string, unknown>) =>
  JSON.parse(formatLogLine("info", "test.event", fields)) as Record<
    string,
    unknown
  >;
const text = (fields: Record<string, unknown>) =>
  formatLogLine("info", "test.event", fields);

const SCAN_ID = "0b5c1f7e-3a4d-4e6f-8a9b-1c2d3e4f5a6b";
const SECRETS = {
  measurement: "187.4",
  ipv4: "203.0.113.45",
  ipv6: "2001:db8:85a3::8a2e:370:7334",
  cookie: "om_session=abc123SESSIONVALUE",
  token: "ya29.a0AfH6SMBsecrettokenvalue",
  email: "kirby.liu@example.org",
  prompt: "Write about a 187.4 mm hand",
};

describe("the shape of a log line", () => {
  it("is one JSON object with level, event, route and ms first, then the fields", () => {
    const out = formatLogLine("warn", "analysis.cache_failed", {
      route: LOG_ROUTES.analysis,
      ms: 41.6,
      op: "get",
      code: "23502",
    });
    expect(out).not.toContain("\n");
    expect(JSON.parse(out)).toEqual({
      level: "warn",
      event: "analysis.cache_failed",
      route: "/api/scans/[scanId]/analysis",
      ms: 42,
      op: "get",
      code: "23502",
    });
    expect(Object.keys(JSON.parse(out)).slice(0, 4)).toEqual([
      "level",
      "event",
      "route",
      "ms",
    ]);
  });

  it("writes null, not a missing key, for a route or duration that is unknown", () => {
    expect(line({})).toEqual({
      level: "info",
      event: "test.event",
      route: null,
      ms: null,
    });
    expect(line({ ms: Number.NaN, route: 5 })).toMatchObject({
      route: null,
      ms: null,
    });
  });

  it("does not let a field overwrite level, event, route or ms", () => {
    // Passed through a cast: a caller cannot do this in typed code either.
    const out = JSON.parse(
      formatLogLine("info", "real.event", {
        route: "/real",
        ms: 1,
        ...({ level: "fake", event: "fake.event" } as object),
      }),
    );
    expect(out).toMatchObject({
      level: "info",
      event: "real.event",
      route: "/real",
      ms: 1,
    });
  });
});

describe("log.info / warn / error", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes exactly one line each: info to stdout, warn and error to stderr", () => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    log.info("a.info", { n: 1 });
    log.warn("a.warn");
    log.error("a.error", { route: LOG_ROUTES.health });
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0]![0]))).toMatchObject({
      level: "info",
      event: "a.info",
      n: 1,
    });
    expect(JSON.parse(String(warn.mock.calls[0]![0])).level).toBe("warn");
    expect(JSON.parse(String(error.mock.calls[0]![0])).route).toBe(
      "/api/health",
    );
  });

  it("never throws into a request, even for a value that cannot be read", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hostile = {
      get boom(): string {
        throw new Error("getter " + SECRETS.email);
      },
    };
    expect(() => log.error("bad", { hostile })).not.toThrow();
    const printed = JSON.parse(
      String((console.error as ReturnType<typeof vi.fn>).mock.calls[0]![0]),
    );
    expect(printed.event).toBe("log.serialize_failed");
    expect(JSON.stringify(printed)).not.toContain("example.org");
  });
});

// One row per redaction category: field names to try, each with a value that
// must not survive. Every category in log.ts must appear here (tested below).
const KEY_CASES: Record<string, { keys: string[]; value: unknown }> = {
  measurement: {
    keys: [
      ...Object.keys(handMeasurementsSchema.shape),
      ...Object.keys(MEASUREMENT_DEFINITIONS),
      "measurements",
      "calibration",
      "landmarks",
      "referenceMm",
      "edgeFitResidualMm",
      "thumbAngleDeg",
      "cardScaleRatio",
    ],
    value: 187.4,
  },
  ip: {
    keys: [
      "ip",
      "IP",
      "clientIp",
      "client_ip",
      "remoteAddress",
      "x-forwarded-for",
      "x-vercel-forwarded-for",
      "x-real-ip",
      "forwarded",
      "rateLimitKey",
      "ipAddress",
    ],
    value: SECRETS.ipv4,
  },
  cookie: {
    keys: [
      "cookie",
      "Cookie",
      "cookies",
      "set-cookie",
      "sessionId",
      "session_id",
      "sessionToken",
      "session",
    ],
    value: SECRETS.cookie,
  },
  token: {
    keys: [
      "token",
      "accessToken",
      "access_token",
      "refresh_token",
      "id_token",
      "csrfToken",
      "secret",
      "clientSecret",
      "password",
      "authorization",
      "Authorization",
      "apiKey",
      "api_key",
      "GEMINI_API_KEY",
      "privateKey",
      "credential",
      "databaseUrl",
      "connectionString",
      "DATABASE_URL",
      "jwt",
    ],
    value: SECRETS.token,
  },
  email: {
    keys: ["email", "Email", "userEmail", "emailAddress", "mail"],
    value: SECRETS.email,
  },
  "model-text": {
    keys: [
      "prompt",
      "systemInstruction",
      "rawResponse",
      "response",
      "responseText",
      "modelOutput",
      "output",
      "completion",
      "candidates",
      "text",
      "content",
      "body",
      "payload",
      "answer",
    ],
    value: SECRETS.prompt,
  },
  "free-text": {
    keys: [
      "error",
      "errors",
      "err",
      "errorMsg",
      "err_msg",
      "msg",
      "description",
      "reason",
      "exception",
    ],
    value: "the query for the 187.4 hand failed on (secret-row)",
  },
  "error-detail": {
    keys: [
      "message",
      "errorMessage",
      "stack",
      "detail",
      "details",
      "cause",
      "query",
      "params",
      "sql",
      "statement",
    ],
    value: "duplicate key value violates unique constraint (Key)=(secret-row)",
  },
};

describe("fields that are always redacted, by name", () => {
  it("has a case for every redaction category except scanId, and no unknown one", () => {
    expect(Object.keys(KEY_CASES).concat("scanId").sort()).toEqual(
      [...REDACTION_CATEGORIES].sort(),
    );
  });

  const cases = Object.entries(KEY_CASES).flatMap(
    ([category, { keys, value }]) =>
      keys.map((key) => [category, key, value] as const),
  );

  it.each(cases)("%s: `%s` at the top level", (_category, key, value) => {
    const out = line({ [key]: value });
    expect(out[key]).toBe("[redacted]");
    expect(text({ [key]: value })).not.toContain(String(value));
  });

  it.each(cases)(
    "%s: `%s` nested in objects and arrays",
    (_category, key, value) => {
      const fields = {
        request: { headers: { deep: [{ safe: "ok", [key]: value }] } },
        list: [{ [key]: value }, 1],
      };
      const printed = text(fields);
      expect(printed).not.toContain(String(value));
      const out = line(fields) as {
        request: { headers: { deep: Array<Record<string, unknown>> } };
        list: Array<Record<string, unknown>>;
      };
      expect(out.request.headers.deep[0]).toEqual({
        safe: "ok",
        [key]: "[redacted]",
      });
      expect(out.list[0]![key]).toBe("[redacted]");
    },
  );

  it("redacts a whole object or array under a sensitive name, not just its leaves", () => {
    const out = line({
      measurements: { handLengthMm: 187.4, nested: { x: 1 } },
      cookies: ["a=1", "b=2"],
      headers: { cookie: "a=1" },
    });
    expect(out.measurements).toBe("[redacted]");
    expect(out.cookies).toBe("[redacted]");
    expect(out.headers).toEqual({ cookie: "[redacted]" });
  });

  it("leaves ordinary facts alone", () => {
    expect(
      line({
        status: "429",
        code: "23502",
        op: "get",
        cached: false,
        count: 3,
      }),
    ).toMatchObject({
      status: "429",
      code: "23502",
      op: "get",
      cached: false,
      count: 3,
    });
  });
});

describe("scan ids", () => {
  it("logs a scan id as the first 8 hex characters of its SHA-256, never in full", () => {
    const out = line({ scanId: SCAN_ID });
    expect(out.scanId).toBe(`id:${shortHash(SCAN_ID)}`);
    expect(String(out.scanId)).toMatch(/^id:[0-9a-f]{8}$/);
    expect(text({ scanId: SCAN_ID })).not.toContain(SCAN_ID);
  });

  it("gives the same handle for the same scan, so two lines can be matched", () => {
    expect(line({ scanId: SCAN_ID }).scanId).toBe(
      line({ scan_id: SCAN_ID }).scan_id,
    );
    expect(line({ scanId: SCAN_ID }).scanId).not.toBe(
      line({ scanId: SCAN_ID.replace("0b5c", "0b5d") }).scanId,
    );
  });

  it("hashes a scan id that is not a UUID, and redacts one that is not text", () => {
    expect(line({ scanId: "scan-a" }).scanId).toBe(`id:${shortHash("scan-a")}`);
    expect(line({ scanId: 12345 }).scanId).toBe("[redacted]");
  });

  it("scrubs the route and the event name too, in case a caller passes a real URL", () => {
    const out = JSON.parse(
      formatLogLine("info", `failed for ${SECRETS.email}`, {
        route: `/api/scans/${SCAN_ID}/analysis?ip=${SECRETS.ipv4}`,
      }),
    );
    expect(out.route).not.toContain(SCAN_ID);
    expect(out.route).not.toContain(SECRETS.ipv4);
    expect(out.route).toContain(shortHash(SCAN_ID));
    expect(out.event).not.toContain("example.org");
  });

  it("hashes a scan id nested anywhere", () => {
    const printed = text({ context: { scans: [{ scanId: SCAN_ID }] } });
    expect(printed).not.toContain(SCAN_ID);
    expect(printed).toContain(shortHash(SCAN_ID));
  });

  it("hashes a UUID that appears inside a string, under any key", () => {
    const printed = text({
      path: `/api/scans/${SCAN_ID}/analysis`,
      note: [`scan ${SCAN_ID.toUpperCase()} failed`],
    });
    expect(printed.toLowerCase()).not.toContain(SCAN_ID);
    expect(printed).toContain(`/api/scans/id:${shortHash(SCAN_ID)}/analysis`);
  });
});

describe("text that looks sensitive is scrubbed under any field name", () => {
  it.each([
    ["an email address", `mail ${SECRETS.email} sent`, SECRETS.email],
    ["an IPv4 address", `from ${SECRETS.ipv4} today`, SECRETS.ipv4],
    ["an IPv6 address", `from ${SECRETS.ipv6} today`, SECRETS.ipv6],
    ["a compressed IPv6 address", "loopback ::1 seen", "::1"],
    [
      "a full IPv6 address",
      "from 2001:0db8:85a3:0000:0000:8a2e:0370:7334 today",
      "0db8:85a3",
    ],
    ["a link-local IPv6 address", "from fe80::1ff:fe23:4567:890a", "1ff:fe23"],
    ["an IPv6 prefix ending in ::", "net 2001:db8:: routed", "2001:db8"],
    [
      "an IPv4-mapped IPv6 address",
      "from ::ffff:192.0.2.128 today",
      "192.0.2.128",
    ],
    ["a bearer token", "sent Bearer abc.DEF-123_xyz~+/= ok", "abc.DEF-123_xyz"],
    [
      "a JWT",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fw",
      "eyJhbGciOiJIUzI1NiJ9",
    ],
    [
      "a connection string with a password",
      "connect postgres://user:hunter2@ep-cool-123.neon.tech/db failed",
      "hunter2",
    ],
    [
      "a connection string on its own host",
      "connect postgresql://ep-cool-123.neon.tech/db failed",
      "ep-cool-123",
    ],
    ["a URL with credentials", "GET https://bob:pw@example.com/x", "bob:pw"],
    ["a measurement in millimetres", "hand is 187.4 mm long", "187.4"],
    ["a measurement without a space", "palm 96mm wide", "96mm"],
    [
      "a long API key",
      "key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
      "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
    ],
  ])("%s", (_name, input, mustNotSurvive) => {
    const printed = text({ note: input, nested: { list: [input] } });
    expect(printed).not.toContain(mustNotSurvive);
    expect(scrubString(input)).not.toContain(mustNotSurvive);
  });

  it("leaves harmless text alone", () => {
    for (const harmless of [
      "analysis model call failed",
      "12:30:45",
      "2026-09-30T12:30:45.000Z",
      "version 1.2",
      "status 429",
      "the cache is cold",
    ]) {
      expect(scrubString(harmless)).toBe(harmless);
    }
  });
});

describe("errors, and anything else that cannot be trusted to have no message", () => {
  it("reduces an Error to its class name plus a short code or status", () => {
    const leaky = Object.assign(
      new TypeError(`rejected ${SECRETS.measurement} mm for ${SECRETS.email}`),
      { code: "23502", status: 400, detail: "Failing row contains (187.4)" },
    );
    const out = line({ error: leaky });
    expect(out.error).toEqual({
      name: "TypeError",
      code: "23502",
      status: 400,
    });
    const printed = text({
      error: leaky,
      wrapped: { cause: leaky, e: [leaky] },
    });
    expect(printed).not.toContain("187.4");
    expect(printed).not.toContain("example.org");
    expect(printed).not.toContain("Failing row");
    expect(printed).not.toContain("at "); // no stack frames
  });

  it("does not print an object's own message or stack under a plain name either", () => {
    const printed = text({
      result: {
        message: "hand 187.4 mm",
        stack: "Error\n    at x (/srv/app.js:1:1)",
      },
    });
    expect(printed).not.toContain("187.4");
    expect(printed).not.toContain("/srv/app.js");
  });

  it("keeps dates readable and turns bigint, functions and symbols into safe values", () => {
    const out = line({
      when: new Date("2026-09-30T00:00:00Z"),
      big: BigInt(10),
      fn: () => 1,
      sym: Symbol("s"),
      inf: Number.POSITIVE_INFINITY,
    });
    expect(out).toMatchObject({
      when: "2026-09-30T00:00:00.000Z",
      big: "10",
      fn: "[unserializable]",
      sym: "[unserializable]",
      inf: "Infinity",
    });
  });
});

describe("bounds", () => {
  it("breaks a circular reference", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(line({ a }).a).toEqual({ name: "a", self: "[circular]" });
  });

  it("does not call a shared, non-circular reference circular", () => {
    const shared = { n: 1 };
    expect(line({ a: shared, b: shared })).toMatchObject({
      a: { n: 1 },
      b: { n: 1 },
    });
  });

  it("stops at a depth limit, and a sensitive value below it is still not printed", () => {
    let deep: Record<string, unknown> = { measurements: 187.4, ok: 1 };
    for (let i = 0; i < 12; i += 1) deep = { child: deep };
    const printed = text({ deep });
    expect(printed).toContain("[truncated]");
    expect(printed).not.toContain("187.4");
  });

  it("caps a long string, a long array and a wide object", () => {
    const longText = "lorem ipsum ".repeat(100);
    const capped = line({ note: longText }).note as string;
    expect(capped.length).toBeLessThanOrEqual(301);
    expect(capped.endsWith("…")).toBe(true);
    const items = line({ list: Array.from({ length: 50 }, (_, i) => i) })
      .list as unknown[];
    expect(items).toHaveLength(21);
    expect(items.at(-1)).toBe("[+30 more]");
    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`k${i}`, i]),
    );
    expect(Object.keys(line({ wide }).wide as object)).toHaveLength(41);
  });
});

describe("every rule is real", () => {
  it("has at least one key rule that matches each category it names", () => {
    for (const rule of KEY_RULES) {
      expect(REDACTION_CATEGORIES).toContain(rule.category);
    }
    expect(new Set(REDACTION_CATEGORIES).size).toBe(
      REDACTION_CATEGORIES.length,
    );
  });
});
