/**
 * Pins how an off build carries none of the error-photo client code (review
 * F1/H8):
 *  1. next.config.ts always defines NEXT_PUBLIC_ERROR_PHOTO_ENABLED as "1" or
 *     "0", so `process.env.NEXT_PUBLIC_ERROR_PHOTO_ENABLED === "1"` is a
 *     constant the build folds (an unset NEXT_PUBLIC_ variable is not inlined,
 *     and its guarded `import()` would then still produce a chunk);
 *  2. nothing imports the error-photo client modules except the lane itself,
 *     tests, type-only imports, and the two guarded `import()` sites.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("next.config.ts defines the error-photo flag for every build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    [undefined, "0"],
    ["", "0"],
    ["true", "0"],
    ["0", "0"],
    ["1", "1"],
  ])(
    "NEXT_PUBLIC_ERROR_PHOTO_ENABLED=%s is defined as %s",
    async (raw, out) => {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_ERROR_PHOTO_ENABLED", raw as string);
      const config = (await import("../../next.config")).default;
      expect(config.env?.NEXT_PUBLIC_ERROR_PHOTO_ENABLED).toBe(out);
    },
  );
});

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** The error-photo client lane: only reachable through the guarded imports. */
function isLaneModule(path: string): boolean {
  const p = path.replaceAll("\\", "/");
  return (
    p.startsWith("src/client/error-photo/") ||
    p.startsWith("src/components/error-photo/") ||
    p === "src/lib/copy/error-photo" ||
    p === "src/lib/copy/error-photo.ts"
  );
}

/** Where a guarded `import()` of the lane may sit (behind the folded flag). */
const GUARDED_SITES = [
  "src/client/camera/EasyScanCamera.tsx",
  "src/app/privacy/page.tsx",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** The repo-relative path an import specifier names, or null for a package. */
function resolveSpecifier(file: string, spec: string): string | null {
  let abs: string;
  if (spec.startsWith("@/")) abs = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) abs = resolve(dirname(file), spec);
  else return null;
  return relative(ROOT, abs).split("\\").join(posix.sep);
}

interface Found {
  readonly spec: string;
  readonly kind: "static" | "type" | "dynamic";
}

export function importsOf(source: string): Found[] {
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

describe("the error-photo client code is reached only through the guarded imports", () => {
  it("the import scanner sees each kind (control)", () => {
    expect(
      importsOf(
        [
          'import { a } from "./x";',
          'import type { B } from "../y";',
          'import "./z.css";',
          'export { c } from "@/w";',
          'const m = await import("../v");',
        ].join("\n"),
      ),
    ).toEqual([
      { spec: "./x", kind: "static" },
      { spec: "../y", kind: "type" },
      { spec: "./z.css", kind: "static" },
      { spec: "@/w", kind: "static" },
      { spec: "../v", kind: "dynamic" },
    ]);
  });

  it("no file outside the lane imports it, except type-only and the guarded import() sites", () => {
    const offenders: string[] = [];
    let guardedImports = 0;
    for (const file of sourceFiles(SRC)) {
      const rel = relative(ROOT, file).split("\\").join(posix.sep);
      if (isLaneModule(rel)) continue;
      for (const { spec, kind } of importsOf(readFileSync(file, "utf8"))) {
        const target = resolveSpecifier(file, spec);
        if (!target || !isLaneModule(target)) continue;
        if (kind === "type") continue;
        if (kind === "dynamic" && GUARDED_SITES.includes(rel)) {
          guardedImports++;
          continue;
        }
        offenders.push(`${rel} -> ${spec} (${kind})`);
      }
    }
    expect(offenders).toEqual([]);
    expect(guardedImports).toBe(2);
  });

  it("each guarded import() sits inside the flag's own branch", () => {
    for (const site of GUARDED_SITES) {
      const source = readFileSync(join(ROOT, site), "utf8");
      const at = source.search(/\bimport\(\s*["'][^"']*error-photo/);
      expect(at, site).toBeGreaterThan(0);
      const before = source.slice(0, at);
      const guard = before.lastIndexOf(
        'if (process.env.NEXT_PUBLIC_ERROR_PHOTO_ENABLED === "1") {',
      );
      expect(guard, site).toBeGreaterThan(0);
      // No closing of that block between the guard and the import at its
      // own indentation: the import is inside it.
      const between = before.slice(guard);
      const opens = (between.match(/\{/g) ?? []).length;
      const closes = (between.match(/\}/g) ?? []).length;
      expect(opens, site).toBeGreaterThan(closes);
    }
  });
});
