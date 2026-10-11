import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardDemoRouteFromProduction } from "../../src/app/scan/demo-guard";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
// `/scan/easy` reads the request headers and mounts the camera; neither exists
// outside a Next request, and the test only asks whether the page calls the guard.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("../../src/server/i18n/getLocale", () => ({
  getLocale: async () => "en",
}));
vi.mock("../../src/client/camera/EasyScanCamera", () => ({
  default: () => null,
}));
// The pages read the visitor's locale (server-only); the guard does not care.
vi.mock("../../src/server/i18n/getLocale", () => ({
  getLocale: async () => "en",
}));

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

/** `NODE_ENV` is typed read-only by Next's types; the test sets it on purpose. */
function setEnv(name: "NODE_ENV" | "VERCEL_ENV", value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

describe("guardDemoRouteFromProduction", () => {
  afterEach(() => {
    setEnv("NODE_ENV", ORIGINAL_NODE_ENV);
    setEnv("VERCEL_ENV", ORIGINAL_VERCEL_ENV);
  });

  it("does nothing on a local `next dev` (NODE_ENV development), whatever VERCEL_ENV is", () => {
    setEnv("NODE_ENV", "development");
    for (const vercel of [undefined, "development", "preview"] as const) {
      setEnv("VERCEL_ENV", vercel);
      expect(() => guardDemoRouteFromProduction()).not.toThrow();
    }
  });

  it("calls notFound() (throws) in production: Vercel production, a Vercel preview, and a local `next start` all build with NODE_ENV production", () => {
    setEnv("NODE_ENV", "production");
    for (const vercel of [undefined, "production", "preview"] as const) {
      setEnv("VERCEL_ENV", vercel);
      expect(() => guardDemoRouteFromProduction()).toThrow();
    }
  });

  it("is closed by default: any NODE_ENV other than development (test, unset, unknown) 404s", () => {
    setEnv("VERCEL_ENV", undefined);
    for (const value of ["test", "staging", undefined] as const) {
      setEnv("NODE_ENV", value);
      expect(() => guardDemoRouteFromProduction()).toThrow();
    }
  });

  it("a development NODE_ENV does not open a real Vercel production deployment", () => {
    // Not a case that can occur (Vercel builds with NODE_ENV production), but
    // the dev-only promise should not hang on that: production wins.
    setEnv("NODE_ENV", "development");
    setEnv("VERCEL_ENV", "production");
    expect(() => guardDemoRouteFromProduction()).toThrow();
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
  // The public "How to choose a mouse that fits" page (the kit moved to /learn/kit).
  "/learn",
  "/results/[scanId]",
  "/results/[scanId]/m/[slug]",
  "/scan/easy",
];

/**
 * The learning kit's pages (`/learn/kit/**` and the QR landing pages `/l/**`).
 * Kirby's decision, 2026-09-30: the learning data is collected by hand, on his
 * own machine, and the kit is not served in production. Since 2026-10-11
 * (candidate) it is dev only: each page 404s everywhere except a local
 * `next dev` (which `learn:sort` starts). They are listed apart from the demos
 * so the reason stays with them, and joined into DEMO_ROUTES below.
 */
const LEARNING_ROUTES = [
  "/l/v1/[token]",
  "/learn/kit",
  "/learn/kit/check",
  "/learn/kit/print",
  "/learn/kit/slates",
];

/**
 * The printed-sheet flow: `/sheet` (the printable calibration sheet) and
 * `/scan` (its photo step). Kirby's decision, 2026-10-11: hidden in
 * production, kept for the learning kit, the demos and the e2e tests. The
 * main scan flow is `/scan/easy`, which stays public (see PRODUCT_ROUTES).
 */
const PRINTED_SHEET_ROUTES = ["/scan", "/sheet"];

/** Dev and demo pages: 404 in production. Pinned in full. */
const DEMO_ROUTES = [
  ...LEARNING_ROUTES,
  ...PRINTED_SHEET_ROUTES,
  "/results/demo",
  "/scan/easy/hand-mismatch-demo",
  "/scan/easy/length-failure-demo",
  "/scan/easy/live-measured-demo",
  "/scan/easy/measured-demo",
  "/scan/easy/measured-length-demo",
  "/scan/error-demo",
  "/scan/grip-race-demo",
  "/scan/hand-explicit-demo",
  "/scan/measured-demo",
  "/scan/paper-edge-measured-demo",
  "/scan/paper-edge-preview",
  "/scan/share-card-demo",
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

const isProductRoute = (route: string) => PRODUCT_ROUTES.includes(route);

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
    expect(isProductRoute("/scan/easy")).toBe(true);
    // The printed-sheet flow is not a product page: it is guarded (see PRINTED_SHEET_ROUTES).
    expect(isProductRoute("/scan")).toBe(false);
    expect(isProductRoute("/sheet")).toBe(false);
    // /learn is the public information page; the learning kit under
    // /learn/kit is not a product page: it is guarded (see LEARNING_ROUTES).
    expect(isProductRoute("/learn")).toBe(true);
    expect(isProductRoute("/learn/kit")).toBe(false);
    expect(isProductRoute("/learn/kit/print")).toBe(false);
    expect(isProductRoute("/l/v1/[token]")).toBe(false);
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

// ── The printed-sheet flow, run for real ────────────────────────────────────
//
// The source check above proves the guard call is there; this runs the three
// page components under both environments, so a guard that is present but
// never reached (or a /scan/easy that picked one up) cannot pass.

/** What `notFound()` throws: an error whose digest names the 404 fallback. */
const NOT_FOUND = expect.objectContaining({
  digest: expect.stringMatching(/404/),
});

describe("/sheet, /scan and /scan/easy under VERCEL_ENV", () => {
  afterEach(() => {
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  });

  const printedSheetPages = [
    ["/sheet", () => import("../../src/app/sheet/page")],
    ["/scan", () => import("../../src/app/scan/page")],
  ] as const;

  it.each(printedSheetPages)(
    "%s throws notFound in production",
    async (_route, load) => {
      process.env.VERCEL_ENV = "production";
      const { default: Page } = await load();
      // `/sheet` is async (it reads the locale), `/scan` is not: await both.
      await expect(async () => Page()).rejects.toThrow(NOT_FOUND);
    },
  );

  it.each(printedSheetPages)(
    "%s renders on a preview, in development and when VERCEL_ENV is unset",
    async (_route, load) => {
      const { default: Page } = await load();
      for (const value of ["preview", "development", undefined] as const) {
        if (value === undefined) delete process.env.VERCEL_ENV;
        else process.env.VERCEL_ENV = value;
        expect(await Page()).toBeTruthy();
      }
    },
  );

  it("/scan/easy renders in production: the main scan flow does not call the guard", async () => {
    process.env.VERCEL_ENV = "production";
    const { default: Page } = await import("../../src/app/scan/easy/page");
    await expect(Page()).resolves.toBeTruthy();
    expect(
      callsGuardAnywhere(readFileSync("src/app/scan/easy/page.tsx", "utf8")),
    ).toBe(false);
  });
});
