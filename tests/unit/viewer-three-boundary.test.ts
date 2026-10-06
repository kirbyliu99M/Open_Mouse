import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * three.js must stay out of every shared chunk. Its one importer is
 * src/components/viewer/mouse-viewer.ts, and that file is reached only through
 * a dynamic import(), so the bundler puts it (and three) in async chunks that
 * no route lists in its first load. A static import of three, or of
 * mouse-viewer, from any other file would pull it into a route's own bundle or
 * a shared one.
 *
 * The e2e spec (tests/e2e/viewer.spec.ts) cannot see this: a production chunk
 * has a hashed name, so it only checks requests for /models/ and /draco/.
 *
 * The scan reads the TypeScript syntax tree, so it sees import and export
 * declarations, import() calls, require() calls and `import("...")` types, and
 * is not fooled by a comment or a string that merely contains the name.
 */
const root = process.cwd();
const VIEWER = join("src", "components", "viewer", "mouse-viewer.ts");
const SCANNED = ["src", "scripts"];

interface Reference {
  /** The module specifier text. */
  readonly specifier: string;
  /** How the file names it. */
  readonly kind: "static" | "type-only" | "dynamic" | "require" | "import-type";
  readonly line: number;
}

/** Every module this source names, and how. */
function moduleReferences(source: string, name: string): Reference[] {
  const kind = name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const found: Reference[] = [];
  const at = (node: ts.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const literal = (node: ts.Node | undefined): string | null =>
    node && ts.isStringLiteralLike(node) ? node.text : null;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier !== null)
        found.push({
          specifier,
          kind: node.importClause?.isTypeOnly ? "type-only" : "static",
          line: at(node),
        });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier !== null)
        found.push({
          specifier,
          kind: node.isTypeOnly ? "type-only" : "static",
          line: at(node),
        });
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref)) {
        const specifier = literal(ref.expression);
        if (specifier !== null)
          found.push({ specifier, kind: "require", line: at(node) });
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const specifier = literal(node.arguments[0]);
      if (specifier !== null) {
        if (callee.kind === ts.SyntaxKind.ImportKeyword)
          found.push({ specifier, kind: "dynamic", line: at(node) });
        else if (ts.isIdentifier(callee) && callee.text === "require")
          found.push({ specifier, kind: "require", line: at(node) });
      }
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      const specifier =
        ts.isLiteralTypeNode(arg) && ts.isStringLiteralLike(arg.literal)
          ? arg.literal.text
          : null;
      if (specifier !== null)
        found.push({ specifier, kind: "import-type", line: at(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const isThree = (specifier: string) =>
  specifier === "three" || specifier.startsWith("three/");
const isViewerModule = (specifier: string) =>
  /(^|\/)mouse-viewer(\.[cm]?[jt]sx?)?$/.test(specifier);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mjs|cjs|jsx?)$/.test(entry) ? [path] : [];
  });
}

describe("moduleReferences (the scan's own eyes)", () => {
  it("sees every way a file can name a module", () => {
    const refs = moduleReferences(
      `
      import { a } from "three";
      import type { T } from "three/addons/x.js";
      import "three/examples/jsm/y.js";
      export * from "three";
      export type { U } from "three";
      import fs = require("three");
      const m = await import("./mouse-viewer");
      const r = require("three");
      type X = typeof import("three");
      // import "three" in a comment
      const s = 'import "three"';
      `,
      "x.ts",
    );
    expect(refs.map((r) => `${r.kind}:${r.specifier}`)).toEqual([
      "static:three",
      "type-only:three/addons/x.js",
      "static:three/examples/jsm/y.js",
      "static:three",
      "type-only:three",
      "require:three",
      "dynamic:./mouse-viewer",
      "require:three",
      "import-type:three",
    ]);
  });

  it("recognises the viewer module by its last path segment, with or without an extension", () => {
    for (const s of [
      "./mouse-viewer",
      "../viewer/mouse-viewer",
      "@/components/viewer/mouse-viewer",
      "./mouse-viewer.ts",
    ])
      expect(isViewerModule(s), s).toBe(true);
    for (const s of ["./mouse-viewer-state", "./viewer", "three"])
      expect(isViewerModule(s), s).toBe(false);
  });

  it("tells three from lookalikes", () => {
    for (const s of [
      "three",
      "three/addons/loaders/GLTFLoader.js",
      "three/src/x",
    ])
      expect(isThree(s), s).toBe(true);
    for (const s of ["@types/three", "three-stdlib", "threejs", "./three"])
      expect(isThree(s), s).toBe(false);
  });
});

describe("three.js stays in the viewer's own async chunk", () => {
  const files = SCANNED.flatMap((dir) => sourceFiles(join(root, dir)));
  const rel = (path: string) => relative(root, path).split(sep).join("/");

  it("finds the source files (the scan would be vacuous otherwise)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain("src/components/viewer/mouse-viewer.ts");
    expect(files.map(rel)).toContain("src/components/viewer/ViewerRegion.tsx");
  });

  it("only src/components/viewer/mouse-viewer.ts names three or three/*", () => {
    const offenders: string[] = [];
    for (const path of files) {
      if (relative(root, path) === VIEWER) continue;
      for (const ref of moduleReferences(readFileSync(path, "utf8"), path))
        if (isThree(ref.specifier))
          offenders.push(
            `${rel(path)}:${ref.line} ${ref.kind} ${ref.specifier}`,
          );
    }
    expect(offenders).toEqual([]);
  });

  it("mouse-viewer.ts does import three (so the check above guards something)", () => {
    const refs = moduleReferences(
      readFileSync(join(root, VIEWER), "utf8"),
      VIEWER,
    );
    expect(refs.some((r) => r.kind === "static" && isThree(r.specifier))).toBe(
      true,
    );
  });

  it("mouse-viewer is reached only through a dynamic import() (a type-only import is erased and allowed)", () => {
    const reached: string[] = [];
    const offenders: string[] = [];
    for (const path of files) {
      for (const ref of moduleReferences(readFileSync(path, "utf8"), path)) {
        if (!isViewerModule(ref.specifier)) continue;
        reached.push(`${rel(path)} ${ref.kind}`);
        if (ref.kind === "static" || ref.kind === "require")
          offenders.push(
            `${rel(path)}:${ref.line} ${ref.kind} ${ref.specifier}`,
          );
      }
    }
    expect(offenders).toEqual([]);
    // The one real reference is ViewerRegion's import().
    expect(reached).toContain("src/components/viewer/ViewerRegion.tsx dynamic");
  });
});
