import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { guardDemoRouteFromProduction } from "../../src/app/scan/demo-guard";

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

describe("guardDemoRouteFromProduction", () => {
  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  });

  it("calls notFound() (throws) when VERCEL_ENV is production — the demo routes (/scan/submit-demo, /scan/measured-demo, /results/demo, …) must not exist there", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => guardDemoRouteFromProduction()).toThrow();
  });

  it("does nothing outside production (preview, development, or unset)", () => {
    for (const value of ["preview", "development", undefined] as const) {
      if (value === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = value;
      expect(() => guardDemoRouteFromProduction()).not.toThrow();
    }
  });
});

// ── Which pages must be guarded ─────────────────────────────────────────────
//
// The guard only works if each demo page actually calls it, and nothing else
// notices a page that forgets to. This check is opt-OUT: every `page.tsx`
// under `src/app` must call the guard unless it is on the list of product
// pages below. A demo page cannot slip out of the check by being named
// `-lab` or `-fixture`, or by having no special name at all: a page that is
// neither listed as a product page nor guarded fails.
//
// Adding a product page is a deliberate edit to PRODUCT_ROUTES. Adding or
// renaming a demo page is a deliberate edit to DEMO_ROUTES.

/** Pages a real user reaches in production. They must NOT call the guard. */
const PRODUCT_ROUTES = [
  "/",
  "/account",
  "/how-it-works",
  "/results/[scanId]",
  "/scan",
  "/scan/easy",
  "/sheet",
];

/**
 * Whole subtrees that are product pages: the learning kit (`/learn/**`, and the
 * QR landing pages `/l/**`). They are `noindex`, not demos, and are meant to be
 * reachable in production. A prefix matches the route itself and anything
 * below it, on whole segments (`/l` does not match `/learn`).
 */
const PRODUCT_ROUTE_PREFIXES = ["/learn", "/l"];

/** Dev and demo pages: 404 in production. Pinned in full. */
const DEMO_ROUTES = [
  "/results/demo",
  "/scan/easy/hand-mismatch-demo",
  "/scan/easy/length-failure-demo",
  "/scan/easy/measured-demo",
  "/scan/grip-race-demo",
  "/scan/hand-explicit-demo",
  "/scan/measured-demo",
  "/scan/paper-edge-measured-demo",
  "/scan/paper-edge-preview",
  "/scan/submit-demo",
];

const PAGE_FILE = /(^|\/)page\.(tsx|ts|jsx|js|mdx)$/;

/** `src/app` page files, relative to it and with `/` separators. */
function pageFiles(): string[] {
  return (
    readdirSync("src/app", { recursive: true, encoding: "utf8" }) as string[]
  )
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => PAGE_FILE.test(path))
    .sort();
}

/** `results/[scanId]/page.tsx` → `/results/[scanId]`; route groups `(x)` are not part of the URL. */
function routeOf(file: string): string {
  const segments = file
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  return "/" + segments.join("/");
}

const isProductRoute = (route: string) =>
  PRODUCT_ROUTES.includes(route) ||
  PRODUCT_ROUTE_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(prefix + "/"),
  );

// ── Reading a page's source ─────────────────────────────────────────────────

const GUARD = "guardDemoRouteFromProduction";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Local names that are the real guard: imported by that name from a `demo-guard` module. */
function importedGuardNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/(^|\/)demo-guard$/.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === GUARD) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/** The body of the page component: the file's default export. `null` if it cannot be found. */
function defaultExportBody(file: ts.SourceFile): ts.Block | null {
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      return statement.body ?? null;
    }
  }
  for (const statement of file.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    const expression = statement.expression;
    if (
      (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
      ts.isBlock(expression.body)
    ) {
      return expression.body;
    }
    if (ts.isIdentifier(expression)) {
      const named = file.statements.find(
        (s): s is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(s) && s.name?.text === expression.text,
      );
      return named?.body ?? null;
    }
  }
  return null;
}

/**
 * True when the page component's FIRST statement is a call to the real guard.
 * Anywhere later, inside a nested function, after an early return, or in a
 * comment does not count: those run too late or not at all.
 */
function guardsFirst(source: string): boolean {
  const file = parse(source);
  const body = defaultExportBody(file);
  const first = body?.statements[0];
  if (!first || !ts.isExpressionStatement(first)) return false;
  const call = first.expression;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    importedGuardNames(file).has(call.expression.text) &&
    call.arguments.length === 0
  );
}

/** True when the file calls anything named like the guard, anywhere. */
function callsGuardAnywhere(source: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === GUARD
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return found;
}

describe("the source check itself", () => {
  const IMPORT = `import { ${GUARD} } from "../demo-guard";\n`;
  const page = (body: string, imports = IMPORT) =>
    `${imports}export default function Page() {\n${body}\n}\n`;

  it("accepts the guard as the first statement of the default export, sync or async, function or arrow", () => {
    expect(guardsFirst(page(`${GUARD}();\nreturn null;`))).toBe(true);
    expect(
      guardsFirst(
        `${IMPORT}export default async function Page() {\n${GUARD}();\nawait 1;\n}`,
      ),
    ).toBe(true);
    expect(
      guardsFirst(
        `${IMPORT}export default () => {\n${GUARD}();\nreturn null;\n};`,
      ),
    ).toBe(true);
    expect(
      guardsFirst(
        `${IMPORT}function Page() {\n${GUARD}();\nreturn null;\n}\nexport default Page;`,
      ),
    ).toBe(true);
    expect(
      guardsFirst(
        `import { ${GUARD} as guard } from "@/app/scan/demo-guard";\nexport default function Page() {\nguard();\nreturn null;\n}`,
      ),
    ).toBe(true);
  });

  it.each([
    ["no call at all", page("return null;")],
    ["only in a comment", page(`// ${GUARD}();\nreturn null;`)],
    ["named in a string", page(`const s = "${GUARD}()";\nreturn null;`)],
    ["called second", page(`const x = 1;\n${GUARD}();\nreturn x;`)],
    ["called after an early return", page(`return null;\n${GUARD}();`)],
    [
      "called in a nested function that is never run",
      page(`function later() {\n${GUARD}();\n}\nreturn null;`),
    ],
    ["called with an argument", page(`${GUARD}(true);\nreturn null;`)],
    ["referenced, not called", page(`${GUARD};\nreturn null;`)],
    [
      "imported from somewhere else",
      page(
        `${GUARD}();\nreturn null;`,
        `import { ${GUARD} } from "./other";\n`,
      ),
    ],
    [
      "not imported at all (a local look-alike)",
      page(`${GUARD}();\nreturn null;`, `function ${GUARD}() {}\n`),
    ],
    [
      "the wrong name from demo-guard",
      page(
        `other();\nreturn null;`,
        `import { other } from "../demo-guard";\n`,
      ),
    ],
    [
      "called in a helper component, not the page",
      `${IMPORT}function Helper() {\n${GUARD}();\nreturn null;\n}\nexport default function Page() {\nreturn null;\n}`,
    ],
    ["no default export", `${IMPORT}export function Page() {\n${GUARD}();\n}`],
  ])("rejects: %s", (_label, source) => {
    expect(guardsFirst(source)).toBe(false);
  });

  it("callsGuardAnywhere sees a call, even a late or nested one, but not a comment or a string", () => {
    expect(callsGuardAnywhere(page(`${GUARD}();`))).toBe(true);
    expect(callsGuardAnywhere(page(`function f() {\n${GUARD}();\n}`))).toBe(
      true,
    );
    expect(
      callsGuardAnywhere(page(`// ${GUARD}();\nconst s = "${GUARD}()";`)),
    ).toBe(false);
    expect(callsGuardAnywhere(page("return null;"))).toBe(false);
  });

  it("routeOf and isProductRoute read paths the way Next does", () => {
    expect(routeOf("page.tsx")).toBe("/");
    expect(routeOf("scan/easy/page.tsx")).toBe("/scan/easy");
    expect(routeOf("results/[scanId]/page.tsx")).toBe("/results/[scanId]");
    expect(routeOf("(marketing)/how-it-works/page.tsx")).toBe("/how-it-works");
    expect(isProductRoute("/learn")).toBe(true);
    expect(isProductRoute("/learn/print")).toBe(true);
    expect(isProductRoute("/l/v1/[token]")).toBe(true);
    // Whole segments only: a look-alike prefix is not a product page.
    expect(isProductRoute("/lab")).toBe(false);
    expect(isProductRoute("/learning-lab")).toBe(false);
    expect(isProductRoute("/scan/anything-else")).toBe(false);
  });
});

// ── The real pages ──────────────────────────────────────────────────────────

describe("every page under src/app is a listed product page or calls guardDemoRouteFromProduction()", () => {
  const files = pageFiles();
  const productFiles = files.filter((f) => isProductRoute(routeOf(f)));
  const otherFiles = files.filter((f) => !isProductRoute(routeOf(f)));

  it("finds the pages (a moved folder or a changed file name cannot empty this check)", () => {
    expect(files.length).toBeGreaterThanOrEqual(
      PRODUCT_ROUTES.length + DEMO_ROUTES.length,
    );
  });

  it("the pages that are not product pages are exactly the pinned demo routes — new or renamed ones need a deliberate edit here", () => {
    expect(otherFiles.map(routeOf).sort()).toEqual([...DEMO_ROUTES].sort());
  });

  it("every listed product route still exists, so the list cannot go stale", () => {
    const routes = files.map(routeOf);
    for (const route of PRODUCT_ROUTES) expect(routes).toContain(route);
  });

  it.each(otherFiles)("src/app/%s calls the guard first", (file) => {
    expect(guardsFirst(readFileSync(`src/app/${file}`, "utf8"))).toBe(true);
  });

  it.each(productFiles)(
    "src/app/%s is a product page: it must not call the guard (that would 404 it in production)",
    (file) => {
      expect(callsGuardAnywhere(readFileSync(`src/app/${file}`, "utf8"))).toBe(
        false,
      );
    },
  );
});
