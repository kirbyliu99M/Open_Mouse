import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `/scan/easy` hands the server's reading of the user agent to the client for
 * the first paint. Reading the request headers is also what makes the route
 * rendered per request instead of prerendered, so the hint always describes
 * the device that asked and no shared cache serves one device's hint to
 * another.
 *
 * That cannot be seen from a response header in the dev server (it sends
 * `no-store` for every route), so it is pinned here on the source, and in the
 * `next build` route table, where this route is `ƒ` (dynamic).
 */
const FILE = "src/app/scan/easy/page.tsx";
const source = ts.createSourceFile(
  FILE,
  readFileSync(FILE, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword,
  );

describe("/scan/easy page", () => {
  it("imports headers() from next/headers", () => {
    const imports = source.statements.filter(ts.isImportDeclaration);
    const fromHeaders = imports.find(
      (i) =>
        ts.isStringLiteral(i.moduleSpecifier) &&
        i.moduleSpecifier.text === "next/headers",
    );
    const named = fromHeaders?.importClause?.namedBindings;
    expect(named && ts.isNamedImports(named)).toBe(true);
    expect(
      ts.isNamedImports(named!) && named.elements.map((e) => e.name.text),
    ).toContain("headers");
  });

  it("awaits headers() inside its default-exported page, so the route is rendered per request", () => {
    const page = source.statements.find(
      (s): s is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(s) &&
        isExported(s) &&
        (ts.getModifiers(s) ?? []).some(
          (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
        ),
    );
    expect(page, "a default-exported function").toBeDefined();
    expect(
      (ts.getModifiers(page!) ?? []).some(
        (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
      ),
      "async",
    ).toBe(true);
    const awaited: string[] = [];
    walk(page!, (node) => {
      if (
        ts.isAwaitExpression(node) &&
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression)
      )
        awaited.push(node.expression.expression.text);
    });
    expect(awaited).toContain("headers");
  });

  it("does not opt back into static rendering", () => {
    const exported: string[] = [];
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement) && isExported(statement))
        for (const d of statement.declarationList.declarations)
          if (ts.isIdentifier(d.name)) exported.push(d.name.text);
    }
    // `dynamic = "force-static"`, `revalidate = n` and the like would undo it.
    for (const name of ["dynamic", "revalidate", "fetchCache"])
      expect(exported, name).not.toContain(name);
  });
});
