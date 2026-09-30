import { describe, expect, it } from "vitest";
import { formatLogLine, scrubString } from "../../src/server/log";

/**
 * Limits of src/server/log.ts that keep one log call cheap and bounded, and two
 * small gaps in the redaction rules: the per-string cut, the arrays under
 * sentence-like field names, the cost of a whole line, full-width separators,
 * and empty values under those names.
 */
const line = (fields: Record<string, unknown>) =>
  JSON.parse(formatLogLine("info", "test.event", fields)) as Record<
    string,
    unknown
  >;
const text = (fields: Record<string, unknown>) =>
  formatLogLine("info", "test.event", fields);

describe("the per-string cut is at 512 characters", () => {
  // "a" x N is one long token: a string that reaches the patterns is replaced
  // by "[redacted-token]", a string that is cut first has its half-word dropped
  // and is marked. So the output tells which side of the cut N is on.
  it("does not cut a string of exactly 512 characters", () => {
    expect(scrubString("a".repeat(512))).toBe("[redacted-token]");
  });

  it("cuts a string of 513 characters, drops the half-word and marks it", () => {
    expect(scrubString("a".repeat(513))).toBe("…");
  });

  it("cuts at 512, not later (a 20 000 limit would let this through)", () => {
    expect(scrubString("a".repeat(600))).toBe("…");
    expect(scrubString("a".repeat(5000))).toBe("…");
  });

  it("does not cut below 512 (a 200 limit would cut this)", () => {
    expect(scrubString("a".repeat(300))).toBe("[redacted-token]");
    expect(scrubString("word ".repeat(80))).toMatch(/^word word/);
  });
});

describe("an array under a sentence-like field name is bounded like any other", () => {
  it("prints at most 20 entries of a huge array, quickly", () => {
    const started = performance.now();
    const out = line({ errors: new Array(1e9) });
    expect(performance.now() - started).toBeLessThan(100);
    const list = out.errors as unknown[];
    expect(list).toHaveLength(21);
    expect(list.at(-1)).toBe("[+999999980 more]");
  });

  it("keeps 20 entries of a real long list", () => {
    const list = line({
      reason: Array.from({ length: 5000 }, () => "timeout"),
    }).reason as unknown[];
    expect(list).toHaveLength(21);
    expect(list[0]).toBe("timeout");
    expect(list.at(-1)).toBe("[+4980 more]");
  });

  it("counts every entry against the line's budget of values", () => {
    // 40 groups x 9 sentence-like names x 20 entries = 7200 values; the budget
    // is 500 for the whole line.
    const names = [
      "error",
      "errors",
      "err",
      "errormsg",
      "errmsg",
      "msg",
      "description",
      "reason",
      "exception",
    ];
    const nested: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      nested["group" + i] = Object.fromEntries(
        names.map((name) => [
          name,
          Array.from({ length: 20 }, () => "timeout"),
        ]),
      );
    }
    const printed = text({ nested });
    expect(printed).toContain("[truncated]");
    expect((printed.match(/"timeout"/g) ?? []).length).toBeLessThan(500);
  });
});

describe("the cost of a whole line is bounded", () => {
  // The worst string for the email pattern: a long run of address characters
  // that never reaches an "@" domain, past the per-string cut.
  const worst = "a.".repeat(1500) + "@";

  it("40 keys, 20-entry arrays and 500 values of worst-case text take under 100 ms", () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      fields[`${"k.".repeat(300)}${i}`] = Array.from(
        { length: 20 },
        () => worst,
      );
    }
    formatLogLine("info", "warm.up", { a: worst }); // compile the patterns
    const started = performance.now();
    const out = formatLogLine("info", worst, { route: worst, ...fields });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(100);
    expect(out).toContain("[text budget exhausted]");
  });

  it("spends a fixed text budget: later strings are replaced unread", () => {
    // 16 384 characters in all; each 512-character string draws 512 of them.
    // The strings scrub down to a few characters, so the line stays small.
    const list = Array.from({ length: 20 }, () => "a".repeat(512));
    const fields = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`f${i}`, list]),
    );
    const printed = text(fields);
    // Counted as a value (followed by "," or "]"); a key name can be spent too.
    const spent = (printed.match(/"\[text budget exhausted\]"(?=[,\]])/g) ?? [])
      .length;
    const read = (printed.match(/\[redacted-token\]/g) ?? []).length;
    expect(read).toBe(32);
    expect(spent).toBe(100 - 32);
  });

  it("does not spend the budget on short text", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`f${i}`, `value ${i}`]),
    );
    expect(text(fields)).not.toContain("[text budget exhausted]");
  });
});

describe("full-width separators do not hide a secret", () => {
  it.each([
    ["password＝hunter2", "hunter2"],
    ["password：hunter2", "hunter2"],
    ["token ＝ abc123", "abc123"],
    ["api_key：AIzaSyDUMMY", "AIzaSyDUMMY"],
    ["secret＝s3cr3t", "s3cr3t"],
    ["authorization：Bearer abc.def", "abc.def"],
    ['{"password"＝"hunter2"}', "hunter2"],
  ])("%s", (input, secret) => {
    expect(scrubString(input)).not.toContain(secret);
    expect(text({ note: input })).not.toContain(secret);
  });

  it("keeps the name and marks the value", () => {
    expect(scrubString("a password＝hunter2 b")).toBe(
      "a password=[redacted] b",
    );
  });
});

describe("empty values under sentence-like names are kept as they are", () => {
  it.each([
    "error",
    "errors",
    "err",
    "errorMsg",
    "msg",
    "description",
    "reason",
  ])("`%s`", (key) => {
    const out = line({ [key]: null, [`${key}2`]: 1 });
    expect(out[key]).toBeNull();
    expect(line({ [key]: false })[key]).toBe(false);
    expect(line({ [key]: 0 })[key]).toBe(0);
    // undefined becomes null like under any other name, not a marker.
    expect(line({ [key]: undefined })[key]).toBeNull();
  });

  it("still redacts a value that could carry text", () => {
    expect(line({ reason: true }).reason).toBe("[redacted]");
    expect(line({ reason: 1 }).reason).toBe("[redacted]");
    expect(line({ reason: 187.4 }).reason).toBe("[redacted]");
    expect(line({ reason: "" }).reason).toBe("[redacted]");
    expect(line({ reason: "a sentence" }).reason).toBe("[redacted]");
  });
});

describe("errors are charged against the text budget too", () => {
  it("replaces the class name of an error once the line has spent its text", () => {
    const named = () =>
      Object.assign(new Error("x"), { name: "a".repeat(512) });
    const errors = Array.from({ length: 20 }, named);
    const printed = text({ first: errors, second: errors, third: errors });
    // 60 names of 512 characters, budget for 32.
    expect(
      (printed.match(/"\[text budget exhausted\]"/g) ?? []).length,
    ).toBeGreaterThan(20);
  });
});
