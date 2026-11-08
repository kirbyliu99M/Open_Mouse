/**
 * The hidden tester page's code stays out of every other page (candidate;
 * contract src/lib/contracts/tester.ts):
 *  1. nothing imports the tester client lane (`src/client/tester/`) or its
 *     copy except the tester page's own route folder (`src/app/scan/tester/`)
 *     and tests, so `/scan/easy` cannot carry it in its first-load bundle;
 *  2. the easy-scan camera imports tester mode as a TYPE only, and
 *     `testerMode.ts` holds types only (no runtime code to bundle);
 *  3. no public page links to `/scan/tester`, and the sitemap does not list
 *     it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SITEMAP_PATHS } from "../../src/lib/seo";

interface Found {
  readonly spec: string;
  readonly kind: "static" | "type" | "dynamic";
}

/** The same import scanner as error-photo-boundary.test.ts (kept local: importing a test file runs its tests). */
function importsOf(source: string): Found[] {
  const found: Found[] = [];
  for (const m of source.matchAll(
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
  )) {
    found.push({ spec: m[3]!, kind: m[2] ? "type" : "static" });
  }
  for (const m of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push({ spec: m[1]!, kind: "dynamic" });
  }
  return found;
}

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (abs: string) => relative(ROOT, abs).split("\\").join(posix.sep);

function resolveSpecifier(file: string, spec: string): string | null {
  if (spec.startsWith("@/")) return rel(join(SRC, spec.slice(2)));
  if (spec.startsWith(".")) return rel(resolve(dirname(file), spec));
  return null;
}

function isTesterLane(path: string): boolean {
  return (
    path.startsWith("src/client/tester/") ||
    path === "src/lib/copy/tester" ||
    path === "src/lib/copy/tester.ts"
  );
}

const MAY_IMPORT_TESTER = (path: string) =>
  path.startsWith("src/client/tester/") ||
  path.startsWith("src/app/scan/tester/");

describe("the tester lane is reached only from /scan/tester", () => {
  it("no other source file imports the tester client or its copy", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const from = rel(file);
      if (MAY_IMPORT_TESTER(from)) continue;
      for (const { spec } of importsOf(readFileSync(file, "utf8"))) {
        const target = resolveSpecifier(file, spec);
        if (target && isTesterLane(target))
          offenders.push(`${from} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the easy-scan camera imports tester mode as a type only", () => {
    const file = join(SRC, "client/camera/EasyScanCamera.tsx");
    const found = importsOf(readFileSync(file, "utf8")).filter((i) =>
      i.spec.endsWith("testerMode"),
    );
    expect(found).toEqual([{ spec: "./testerMode", kind: "type" }]);
  });

  it("testerMode.ts declares types only", () => {
    const source = readFileSync(
      join(SRC, "client/camera/testerMode.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /\bexport\s+(const|let|var|function|class|default|enum)\b/,
    );
    for (const { kind } of importsOf(source)) expect(kind).toBe("type");
  });
});

describe("/scan/tester is not advertised", () => {
  it("is not in the sitemap's fixed paths", () => {
    expect(SITEMAP_PATHS.some((p) => p.startsWith("/scan/tester"))).toBe(false);
  });

  it("no source file outside its own lane links to it", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const from = rel(file);
      if (
        MAY_IMPORT_TESTER(from) ||
        from === "src/lib/contracts/tester.ts" ||
        from === "src/app/robots.ts"
      )
        continue;
      // A string literal naming the path (comments may mention it).
      if (/["']\/(?:en\/)?scan\/tester/.test(readFileSync(file, "utf8")))
        offenders.push(from);
    }
    expect(offenders).toEqual([]);
  });
});
