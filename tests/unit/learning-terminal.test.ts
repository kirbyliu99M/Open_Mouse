import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { failureKind, failureMessage } from "../../src/lib/learning/errorkind";
import { spawnSync } from "node:child_process";
import {
  installLastResort,
  makeTerminal,
} from "../../src/lib/learning/terminal";

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
    expect(code).toMatch(/run\(\)\.catch\(\(err\) => \{[^}]*failure\(err\)/s);
    expect(code).not.toMatch(/\.stack\b/);
  });

  it("runs everything, argument checks and folder listing included, inside run() and its catch", () => {
    // Nothing that touches the file system or the arguments may sit at the top
    // level, outside the catch: it would fail with a raw stack. Only
    // definitions (and the `realpathLoose` helper) do.
    const top = code
      .slice(0, code.indexOf("async function run()"))
      .replace(/function realpathLoose[\s\S]*?\n}\n/, "");
    for (const call of [
      "readdirSync(",
      "statSync(",
      "realpathLoose(",
      "existsSync(",
      "process.argv",
    ]) {
      expect(top).not.toContain(call);
    }
    expect(code).toMatch(/installLastResort\(failure/);
  });
});

describe("installLastResort", () => {
  it("prints what escaped through the failure printer and exits 1", () => {
    const handlers: Record<string, (x: never) => void> = {};
    const seen: unknown[] = [];
    const exits: number[] = [];
    installLastResort(
      (e) => seen.push(e),
      (c) => exits.push(c),
      {
        on: (event: string, l: (x: never) => void) => (handlers[event] = l),
      } as never,
    );
    expect(Object.keys(handlers).sort()).toEqual([
      "uncaughtException",
      "unhandledRejection",
    ]);
    const boom = new Error("boom");
    handlers.uncaughtException!(boom as never);
    handlers.unhandledRejection!("plain reason" as never);
    expect(seen).toEqual([boom, "plain reason"]);
    expect(exits).toEqual([1, 1]);
  });

  // The real thing, in a real process: an exception from a timer, and a
  // promise nobody awaits. Node's own handling would print the stack and the
  // absolute paths in it.
  it.each([
    ["an exception from a timer", "throw"],
    ["a rejected promise nobody awaits", "reject"],
  ])(
    "%s: a redacted message, no stack, exit 1",
    (_label, mode) => {
      const tsx = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
      const driver = join(
        REPO,
        "tests",
        "unit",
        "helpers",
        "last-resort-driver.ts",
      );
      const result = spawnSync(process.execPath, [tsx, driver, mode], {
        cwd: REPO,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/^escaped while reading '<path>' and /);
      // The working folder, as ".", and the home folder we were not told about, as <path>.
      expect(result.stderr).toMatch(/ and '\.[\\/]data\.json'/);
      expect(result.stderr).not.toMatch(/^\s+at /m);
      expect(result.stderr).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(result.stderr.toLowerCase()).not.toContain(REPO.toLowerCase());
      expect(result.stderr).not.toMatch(/node:internal|last-resort-driver/);
    },
    60_000,
  );
});
