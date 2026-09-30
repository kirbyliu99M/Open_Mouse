import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { failureKind, failureMessage } from "../../src/lib/learning/errorkind";
import { makeTerminal } from "../../src/lib/learning/terminal";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A terminal that records what it was asked to print. */
function recorded() {
  const out: string[] = [];
  const err: string[] = [];
  const terminal = makeTerminal(
    {
      username: "kirby",
      paths: [
        { from: "C:\\Users\\kirby\\repo", to: "." },
        { from: "C:\\Users\\kirby\\Pictures\\S1", to: "../Pictures/S1" },
      ],
    },
    { log: (t) => out.push(t), error: (t) => err.push(t) },
  );
  return { terminal, out, err };
}

describe("makeTerminal", () => {
  it("redacts progress lines and complaints, each to its own stream", () => {
    const { terminal, out, err } = recorded();
    terminal.say("Checking 3 photos from C:\\Users\\kirby\\Pictures\\S1 …");
    terminal.warn("Not a folder: C:\\Users\\Kirby\\Desktop\\nothing");
    expect(out).toEqual(["Checking 3 photos from ../Pictures/S1 …"]);
    expect(err).toEqual(["Not a folder: C:\\Users\\~\\Desktop\\nothing"]);
  });

  it("prints a failure as its message only, never the stack", () => {
    const { terminal, out, err } = recorded();
    const failure = new Error(
      "ENOENT: no such file or directory, open 'C:\\Users\\kirby\\repo\\x.json'",
    );
    failure.stack = `${failure.message}\n    at read (C:\\Users\\kirby\\repo\\scripts\\learn-sort.ts:9:9)`;
    terminal.failure(failure);
    expect(out).toEqual([]);
    expect(err).toEqual([
      "ENOENT: no such file or directory, open '.\\x.json'",
    ]);
    expect(err.join("\n")).not.toMatch(/\n\s+at /);
  });

  it("names a thrown value that is not an Error without printing it", () => {
    const { terminal, err } = recorded();
    terminal.failure({ secret: "C:\\Users\\kirby\\x" });
    terminal.failure("plain text C:\\Users\\kirby\\repo\\y");
    expect(err[0]).toMatch(/not an Error/);
    expect(err[0]).not.toMatch(/secret|kirby/);
    expect(err[1]).toBe("plain text .\\y");
  });
});

describe("failureMessage and failureKind", () => {
  it("the message is only the message", () => {
    const e = new RangeError("bad value 12");
    expect(failureMessage(e)).toBe("bad value 12");
    expect(failureMessage(e)).not.toContain("at ");
  });

  it("the kind holds no message at all", () => {
    expect(failureKind(new RangeError("C:\\Users\\kirby\\x"))).toBe(
      "RangeError",
    );
    expect(failureKind("C:\\Users\\kirby\\x")).toBe("NonError");
  });
});

// The script's own output cannot be run end to end without photos and a
// browser, so this pins its shape: the only place it touches `console` besides
// the terminal is the CI refusal (no path in it). A new `console.log` that
// skipped the terminal would print an absolute path or the account name.
describe("scripts/learn-sort.ts prints only through the terminal", () => {
  const source = readFileSync(join(REPO, "scripts", "learn-sort.ts"), "utf8");
  const code = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");

  it("has one direct console call, the CI refusal", () => {
    expect(code.match(/\bconsole\./g)).toHaveLength(1);
    expect(code).toMatch(
      /console\.error\(\s*"learn-sort reads real hand photos/,
    );
  });

  it("uses no process.stdout or process.stderr directly", () => {
    expect(code).not.toMatch(/process\.std(out|err)/);
  });

  it("prints a failure through terminal.failure, not the error itself", () => {
    expect(code).toMatch(/\.catch\(\(err\) => \{[^}]*failure\(err\)/s);
    expect(code).not.toMatch(/\.stack\b/);
  });
});
