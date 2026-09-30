import { describe, expect, it } from "vitest";
import {
  MAX_LINE_BYTES,
  formatLogLine,
  scrubString,
  shortHash,
} from "../../src/server/log";

/**
 * Review round: the gaps found in src/server/log.ts. Each block names the
 * hole it closes; tests/unit/log.test.ts holds the original rules.
 */
const line = (fields: Record<string, unknown>) =>
  JSON.parse(formatLogLine("info", "test.event", fields)) as Record<
    string,
    unknown
  >;
const text = (fields: Record<string, unknown>) =>
  formatLogLine("info", "test.event", fields);

const UUID = "0b5c1f7e-3a4d-4e6f-8a9b-1c2d3e4f5a6b";

describe("scrubbing a long string is bounded", () => {
  // Patterns such as the email one are quadratic on a long run of key
  // characters. The text is cut before any pattern runs.
  const HOSTILE: Array<[string, string]> = [
    ["one long word", "a".repeat(200_000)],
    ["dotted word", "a.".repeat(100_000)],
    ["dashes and digits", "1-".repeat(100_000)],
    ["many at signs", "a@".repeat(100_000)],
    ["email-like with no end", "user" + ".x".repeat(100_000) + "@"],
    ["colons", "1:".repeat(100_000)],
    ["dotted numbers", "1.".repeat(100_000)],
    ["assignment look-alikes", "token=".repeat(30_000)],
    ["spaced text", "hand length ".repeat(20_000)],
  ];

  it.each(HOSTILE)("%s (200 000 characters) takes under 50 ms", (_n, input) => {
    scrubString(input); // warm up the regexes
    const started = performance.now();
    const out = scrubString(input);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(50);
    expect(out.length).toBeLessThanOrEqual(301);
  });

  it("also inside a line, as a field value, a key and the event", () => {
    const big = "a.".repeat(100_000);
    const started = performance.now();
    formatLogLine("info", big, { route: big, value: big, [big]: 1 });
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("marks a cut string and drops the half-word left at the cut", () => {
    const words = "alpha ".repeat(1000); // 6000 characters
    const out = scrubString(words);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(301);
    // A secret that straddles the cut is not printed as a fragment. The text
    // before it is one long token, so what is left after scrubbing is short and
    // the fragment would show if the half-word were kept.
    const straddle = "a".repeat(500) + " kirby.liu@example.org and more";
    const cutOut = scrubString(straddle);
    expect(cutOut).not.toContain("kirby");
    expect(cutOut).toBe("[redacted-token] …");
  });

  it("does not print a secret that begins inside the first 512 characters and ends after them", () => {
    const secret = "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
    const input = "q ".repeat(240) + secret + " tail";
    expect(scrubString(input)).not.toContain("AIza");
  });
});

describe("object keys are scrubbed like any other text", () => {
  it.each([
    ["an IPv4 address", "203.0.113.45", "203.0.113.45"],
    ["an IPv6 address", "2001:db8:85a3::8a2e:370:7334", "8a2e:370"],
    ["an email address", "kirby.liu@example.org", "example.org"],
    ["a UUID", UUID, UUID],
    ["a bearer token", "Bearer abc.def.ghi-12345", "abc.def"],
  ])("%s used as a key", (_name, key, mustNotSurvive) => {
    const printed = text({ [key]: "ok", nested: { list: [{ [key]: 1 }] } });
    expect(printed).not.toContain(mustNotSurvive);
  });

  it("keeps the value of such a key, and keeps two colliding keys apart", () => {
    const out = line({
      "203.0.113.45": "first",
      "203.0.113.46": "second",
    }) as Record<string, unknown>;
    expect(out["[redacted-ip]"]).toBe("first");
    expect(out["[redacted-ip]#2"]).toBe("second");
  });

  it("hashes a UUID key to the same handle as a UUID in a value", () => {
    const out = line({ [UUID]: 1 });
    expect(Object.keys(out)).toContain(`id:${shortHash(UUID)}`);
  });
});

describe("binary data", () => {
  it.each([
    ["a Uint8Array", new Uint8Array([1, 2, 3, 4])],
    ["a Buffer", Buffer.from("hand length 187.4 mm")],
    ["an ArrayBuffer", new ArrayBuffer(8)],
    ["a Float32Array", new Float32Array([187.4, 96.1])],
    ["a DataView", new DataView(new ArrayBuffer(16))],
    ["a SharedArrayBuffer", new SharedArrayBuffer(8)],
  ])("%s is not printed, only its size", (_name, value) => {
    const printed = text({ payloadBytes: value, nested: [value] });
    expect(printed).toContain("[binary ");
    expect(printed).not.toContain("187.4");
    expect(printed).not.toContain("96.1");
    expect(printed).not.toMatch(/"0":|"1":/); // no per-index dump
  });

  it("reports the byte length", () => {
    expect(line({ b: Buffer.alloc(12) }).b).toBe("[binary 12 bytes]");
    expect(line({ b: new Float32Array(3) }).b).toBe("[binary 12 bytes]");
  });
});

describe("fields that hold a sentence", () => {
  const SENTENCE = "Failed query: insert into scans (hand 187.4 mm) for x";

  it.each([
    "error",
    "errorMsg",
    "err_msg",
    "errMsg",
    "msg",
    "description",
    "reason",
    "exception",
    "Error",
    "REASON",
  ])("`%s` is redacted when it holds a sentence", (key) => {
    expect(line({ [key]: SENTENCE })[key]).toBe("[redacted]");
    expect(text({ [key]: SENTENCE })).not.toContain("insert into");
  });

  it("also redacts a number, and every sentence in a list", () => {
    expect(line({ msg: 187.4 }).msg).toBe("[redacted]");
    expect(line({ errors: [SENTENCE, "timeout"] }).errors).toEqual([
      "[redacted]",
      "timeout",
    ]);
  });

  it("keeps an enumerated value: a short lower-case token (the reasons in use)", () => {
    for (const reason of [
      "timeout",
      "error",
      "proceed_without_limit",
      "db.unavailable",
      "rate-limited",
    ]) {
      expect(line({ reason }).reason).toBe(reason);
    }
  });

  it.each([
    ["with a space", "timed out"],
    ["with a capital", "Timeout"],
    ["with a digit first", "5xx"],
    ["over 40 characters", "a".repeat(41)],
    ["with an at sign", "user@example.org"],
    ["empty", ""],
  ])("does not keep a value %s", (_n, value) => {
    expect(line({ reason: value }).reason).toBe("[redacted]");
  });

  it("still reduces an Error under those names to its class, code and status", () => {
    const e = Object.assign(new Error(SENTENCE), {
      code: "23502",
      status: 500,
    });
    expect(line({ error: e }).error).toEqual({
      name: "Error",
      code: "23502",
      status: 500,
    });
    expect(text({ error: e, reason: e })).not.toContain("insert into");
  });

  it("keeps the fixed facts the server logs today", () => {
    expect(
      line({
        status: "429",
        code: "23502",
        op: "set",
        action: "continue_without_cache",
        env: "RATE_LIMIT_KEY_SECRET",
        fallback: "fixed_non_secret_salt",
        reason: "timeout",
      }),
    ).toMatchObject({
      status: "429",
      code: "23502",
      op: "set",
      action: "continue_without_cache",
      env: "RATE_LIMIT_KEY_SECRET",
      fallback: "fixed_non_secret_salt",
      reason: "timeout",
    });
  });
});

describe("shared references cannot fan out", () => {
  it("stops after a fixed number of values, however the graph is shared", () => {
    // 2^30 paths if every reference were expanded in full.
    let node: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 5; i += 1)
      node = { a: node, b: node, c: node, d: node };
    const wide = { a: node, b: node, c: node, d: node, e: node, f: node };
    const printed = text({ wide });
    expect(printed.length).toBeLessThanOrEqual(MAX_LINE_BYTES);
    expect(printed).toContain("[truncated]");
    const values = printed.match(/"x"/g) ?? [];
    expect(values.length).toBeLessThan(500);
  });

  it("is quick on a graph that would take forever to expand", () => {
    let node: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 6; i += 1) {
      node = Object.fromEntries(
        Array.from({ length: 10 }, (_, k) => [`k${k}`, node]),
      );
    }
    const started = performance.now();
    formatLogLine("info", "x", { node });
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("the finished line has a size limit", () => {
  const bigField = () =>
    Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `k${i}`,
        Array.from({ length: 20 }, () =>
          "lorem ipsum dolor sit amet ".repeat(11),
        ),
      ]),
    );

  it("stays valid JSON under 8 KB and says what it dropped", () => {
    const out = formatLogLine("warn", "big.event", {
      route: "/r",
      ms: 5,
      first: "kept",
      huge: bigField(),
      last: "dropped-last",
    });
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(MAX_LINE_BYTES);
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({
      level: "warn",
      event: "big.event",
      route: "/r",
      ms: 5,
      first: "kept",
    });
    expect(parsed.truncated.droppedFields).toBeGreaterThan(0);
    expect(parsed.truncated.originalBytes).toBeGreaterThan(MAX_LINE_BYTES);
    expect(parsed.last).toBeUndefined();
  });

  it("leaves a line that fits exactly as it is", () => {
    const out = JSON.parse(text({ a: "b" }));
    expect(out.truncated).toBeUndefined();
  });

  it("keeps level, event, route and ms even when nothing else fits", () => {
    const out = JSON.parse(
      formatLogLine("error", "only.header", {
        route: "/r",
        ms: 1,
        huge: bigField(),
      }),
    );
    expect(out).toMatchObject({
      level: "error",
      event: "only.header",
      route: "/r",
      ms: 1,
    });
    expect(out.huge).toBeUndefined();
    expect(out.truncated.droppedFields).toBe(1);
  });
});

describe("key=value pairs inside a string", () => {
  it.each([
    ["password=", "login failed password=hunter2 for x", "hunter2"],
    ["password: (colon)", "password: hunter2", "hunter2"],
    ["token=", "retry token=abc123def456 now", "abc123def456"],
    ["access_token=", "access_token=ya29.a0AfH6SMB", "ya29"],
    ["refresh-token:", "refresh-token: 1//0gAbCdEf", "1//0g"],
    ["api_key=", "GET /x?api_key=AIzaSyDUMMYKEYVALUE&z=1", "AIzaSyDUMMY"],
    ["apikey=", "apikey=short", "short"],
    ["api-key:", "api-key: short-value", "short-value"],
    ["secret=", "secret=s3cr3t!", "s3cr3t"],
    ["client_secret=", "client_secret=abc", "abc"],
    ["authorization: Bearer", "authorization: Bearer abc.def.ghi", "abc.def"],
    [
      "Authorization: Basic",
      "Authorization: Basic dXNlcjpwYXNz",
      "dXNlcjpwYXNz",
    ],
    ["cookie=", "cookie=sid=abc123", "abc123"],
    ["session_id=", "session_id=abc123", "abc123"],
    ["quoted JSON", '{"password":"hunter2","x":1}', "hunter2"],
    ["quoted with spaces", `password = "correct horse"`, "correct horse"],
    ["single quoted", "token='abc def'", "abc def"],
    ["upper case", "PASSWORD=Hunter2", "Hunter2"],
    ["prefixed name", "my_token=zzz111", "zzz111"],
    ["name glued to a word", "authtoken=zzz111", "zzz111"],
    ["password inside a longer name", "dbpassword=zzz111", "zzz111"],
  ])("%s", (_name, input, mustNotSurvive) => {
    expect(scrubString(input)).not.toContain(mustNotSurvive);
    expect(text({ note: input, deep: { list: [input] } })).not.toContain(
      mustNotSurvive,
    );
  });

  it("keeps the name and what follows the value", () => {
    expect(scrubString("a password=hunter2&next=1 b")).toBe(
      "a password=[redacted]&next=1 b",
    );
    expect(scrubString("token=abc, retry")).toBe("token=[redacted], retry");
  });

  it("leaves words that only contain those letters alone", () => {
    for (const harmless of [
      "the tokenizer ran",
      "secretary of state",
      "passwordless sign-in",
      "cookies are tasty",
      "token count 3",
      "status=ok",
    ]) {
      expect(scrubString(harmless)).toBe(harmless);
    }
  });
});

describe("millimetres written with a decimal comma", () => {
  // The whole figure goes, not just the digits after the comma.
  it.each([
    ["187,4 mm", "[redacted-measurement]"],
    ["187,4mm", "[redacted-measurement]"],
    ["hand is 96,05 mm wide", "hand is [redacted-measurement] wide"],
    ["187.4 mm", "[redacted-measurement]"],
    ["187 mm", "[redacted-measurement]"],
  ])("%s", (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it("does not eat the comma of a list", () => {
    expect(scrubString("a, 5 mm, b")).toBe("a, [redacted-measurement], b");
  });
});
