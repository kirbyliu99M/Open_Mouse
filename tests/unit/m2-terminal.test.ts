import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { m2Terminal } from "../../src/lib/m2/terminal";

const scriptRoot = resolve("/repo-under-test/open-mouse");
const cwd = join(scriptRoot, "work");
const reports = join(cwd, "..", "reports", "out.json");

const terminal = m2Terminal({
  cwd,
  scriptRoot,
  username: "kirby",
  named: [resolve(reports)],
});

describe("m2Terminal: the same filter as learn:sort", () => {
  it("a path it was not told about is <path>, on either platform's spelling", () => {
    expect(terminal.show("no such file 'D:\\other\\thing.txt'")).toBe(
      "no such file '<path>'",
    );
    expect(terminal.show("no such file '/data/other/thing.txt'")).toBe(
      "no such file '<path>'",
    );
    expect(terminal.show("at file:///home/bob/x/y.mjs failed")).toBe(
      "at <path> failed",
    );
  });

  it("stack frames become one note", () => {
    expect(
      terminal.show(
        "Error: boom\n    at f (/data/x/y.js:1:1)\n    at g (/data/x/z.js:2:2)",
      ),
    ).toBe("Error: boom\n    (stack frames omitted)");
  });

  it("the account name is ~, this checkout and the working folder are '.'", () => {
    expect(terminal.show("hello kirby")).toBe("hello ~");
    expect(terminal.show(`'${join(scriptRoot, "node_modules", "x")}'`)).toMatch(
      /^'\.[\\/]node_modules[\\/]x'$/,
    );
    expect(terminal.show(`'${join(cwd, "a.json")}'`)).toMatch(
      /^'\.[\\/]a\.json'$/,
    );
  });

  it("a path named on the command line is shown relative, not as <path>", () => {
    const shown = terminal.show(`writing '${resolve(reports)}'`);
    expect(shown).toContain("../reports/out.json");
    expect(shown).not.toContain("<path>");
  });

  it("a failure is its message only", () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = (text: string) => seen.push(text);
    try {
      const err = new Error("EPERM: scandir '/data/other/x'");
      err.stack = `${err.message}\n    at f (/data/x/y.js:1:1)`;
      terminal.failure(err);
    } finally {
      console.error = original;
    }
    expect(seen).toEqual(["EPERM: scandir '<path>'"]);
  });
});
