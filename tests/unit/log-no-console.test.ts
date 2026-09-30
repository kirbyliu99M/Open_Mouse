import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The server writes logs through src/server/log.ts, which redacts what must
 * never reach a log. A direct `console.*` call in server code or in an API
 * route would bypass that, so none may exist outside log.ts itself.
 */
const ROOTS = [join("src", "server"), join("src", "app", "api")];
const LOG_MODULE = join("src", "server", "log.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Drops comments and string literals' contents are kept: `console` in a comment is fine. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("server code logs through src/server/log.ts only", () => {
  const files = ROOTS.flatMap(sourceFiles).filter(
    (file) => file !== LOG_MODULE,
  );

  it("finds the server files (the scan would be vacuous otherwise)", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((file) => file.endsWith("handler.ts"))).toBe(true);
  });

  it("has no console.* call outside log.ts", () => {
    const offenders = files.filter((file) =>
      /\bconsole\s*\.\s*\w+/.test(withoutComments(readFileSync(file, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("the module itself is the one place that writes to the console", () => {
    expect(readFileSync(LOG_MODULE, "utf8")).toMatch(
      /console\.(error|warn|log)/,
    );
  });
});
