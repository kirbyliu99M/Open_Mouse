import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The server writes logs through src/server/log.ts, which redacts what must
 * never reach a log. Any other way of writing to the console or to the
 * process's output streams would bypass that.
 *
 * The scan reads the TypeScript syntax tree (not the text), so it sees the
 * spellings a regular expression misses (`console?.log`, `console["log"]`,
 * `const { error } = console`, `const c = console`, `globalThis.console`,
 * `process.stderr.write`, ...) and is not fooled by a `//` inside a string.
 *
 * It covers all of `src`: the server code (src/server, src/app/api, src/lib,
 * src/db), the server component pages, and also the client components, since
 * a client component is rendered on the server first and a console call in
 * its render would land in the server log.
 *
 * This is a guardrail against a slip, not a security boundary. It follows
 * names through imports and simple aliases, but it does not try to defeat
 * someone who means to get around it: `Reflect.get(console, "log")`,
 * `util.debuglog(...)`, `require(variable)`, a `Function("return console")()`
 * or writing to a file descriptor through another module are not detected.
 * Review still has to catch those.
 */
const HIT_MODULES = new Set(["console", "node:console"]);
const PROCESS_MODULES = new Set(["process", "node:process"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "global", "window", "self"]);
const STREAMS = new Set(["stdout", "stderr"]);

/** Descriptions of every way `source` writes to the console or the process streams. */
export function findOutputCalls(source: string, name = "file.tsx"): string[] {
  const kind = name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const hits: string[] = [];
  const at = (node: ts.Node, what: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    hits.push(`line ${line + 1}: ${what}`);
  };
  const literal = (node: ts.Expression): string | null =>
    ts.isStringLiteralLike(node) ? node.text : null;
  const isIdent = (
    node: ts.Node | undefined,
    names: ReadonlySet<string> | string,
  ) =>
    node !== undefined &&
    ts.isIdentifier(node) &&
    (typeof names === "string" ? node.text === names : names.has(node.text));

  // Names that stand for the `process` object: `process` itself, and whatever
  // a file calls it when it imports the module (`import p from "node:process"`,
  // `import * as p from "node:process"`, `const p = require("node:process")`).
  const processNames = new Set(["process"]);
  const isProcessRequire = (node: ts.Expression | undefined): boolean =>
    node !== undefined &&
    ts.isCallExpression(node) &&
    isIdent(node.expression, "require") &&
    node.arguments[0] !== undefined &&
    PROCESS_MODULES.has(literal(node.arguments[0]) ?? "");
  (function collectAliases(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      PROCESS_MODULES.has(node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      if (clause?.name) processNames.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        processNames.add(clause.namedBindings.name.text);
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isProcessRequire(node.initializer)
    ) {
      processNames.add(node.name.text);
    }
    ts.forEachChild(node, collectAliases);
  })(file);

  function visit(node: ts.Node) {
    // Any use of the name `console`, unless it is only a property name
    // (`x.console`, `{ console: 1 }`, an interface member).
    if (ts.isIdentifier(node) && node.text === "console") {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node);
      if (!isPropertyName) at(node, "uses `console`");
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (
        isIdent(node.expression, GLOBAL_OBJECTS) &&
        node.name.text === "console"
      ) {
        at(node, `${(node.expression as ts.Identifier).text}.console`);
      }
      if (
        isIdent(node.expression, processNames) &&
        STREAMS.has(node.name.text)
      ) {
        at(node, `process.${node.name.text}`);
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const key = literal(node.argumentExpression);
      const onGlobal = isIdent(node.expression, GLOBAL_OBJECTS);
      const onProcess = isIdent(node.expression, processNames);
      if (key === "console") at(node, '["console"]');
      if (onGlobal && key === null)
        at(node, "computed access on a global object");
      if (onProcess && (key === null || STREAMS.has(key))) {
        at(
          node,
          key === null ? "computed access on process" : `process["${key}"]`,
        );
      }
    }
    // const { stderr } = process   /   const { console } = globalThis
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const from = node.initializer;
      const fromProcess = isIdent(from, processNames) || isProcessRequire(from);
      const fromGlobal = isIdent(from, GLOBAL_OBJECTS);
      for (const element of node.name.elements) {
        const property = (element.propertyName ?? element.name) as ts.Node;
        const text =
          ts.isIdentifier(property) || ts.isStringLiteralLike(property)
            ? property.text
            : null;
        if (fromProcess && (text === null || STREAMS.has(text)))
          at(element, "destructures process output");
        if (fromGlobal && (text === null || text === "console"))
          at(element, "destructures a global object");
      }
    }
    // import ... from "node:console"  /  require("console")
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (HIT_MODULES.has(node.moduleSpecifier.text))
        at(node, "imports the console module");
      // import { stdout } from "node:process"
      const bindings = node.importClause?.namedBindings;
      if (
        PROCESS_MODULES.has(node.moduleSpecifier.text) &&
        bindings &&
        ts.isNamedImports(bindings)
      ) {
        for (const element of bindings.elements) {
          if (STREAMS.has((element.propertyName ?? element.name).text)) {
            at(element, "imports a process output stream");
          }
        }
      }
    }
    // import("node:console")  /  import("node:process")
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined
    ) {
      const target = literal(node.arguments[0]) ?? "";
      if (HIT_MODULES.has(target))
        at(node, "dynamically imports the console module");
      if (PROCESS_MODULES.has(target))
        at(node, "dynamically imports the process module");
    }
    if (
      ts.isCallExpression(node) &&
      isIdent(node.expression, "require") &&
      node.arguments[0] !== undefined &&
      HIT_MODULES.has(literal(node.arguments[0]) ?? "")
    ) {
      at(node, "requires the console module");
    }
    // import { writeSync } from "node:fs": a write straight to a descriptor,
    // whatever it is called afterwards (no source file needs it).
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName ?? node.name).text === "writeSync"
    ) {
      at(node, "imports writeSync");
    }
    // fs.writeSync(1 | 2, ...): a write straight to stdout or stderr
    if (
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "writeSync") ||
        isIdent(node.expression, "writeSync")) &&
      node.arguments[0] !== undefined &&
      ts.isNumericLiteral(node.arguments[0]) &&
      ["1", "2"].includes(node.arguments[0].text)
    ) {
      at(node, "writeSync to stdout/stderr");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return hits;
}

// ── The scanner itself ────────────────────────────────────────────────────
describe("findOutputCalls (the scanner)", () => {
  it.each([
    ["a plain call", "console.log(1)"],
    ["optional chaining", "console?.error(1)"],
    ["optional call", "console.log?.(1)"],
    ["bracket access", 'console["warn"]("x")'],
    ["bracket access, template literal", "console[`warn`]('x')"],
    ["destructuring", "const { error } = console"],
    ["destructuring with a rename", "const { error: e } = console; e('x')"],
    ["an alias", "const c = console; c.log(1)"],
    ["a bound method", "const log = console.log.bind(console)"],
    ["passed on", "export const sink = () => run(console)"],
    ["an indirect call", "(0, console.log)('x')"],
    ["globalThis.console", "globalThis.console.log(1)"],
    ["window.console", "window.console.log(1)"],
    ["global.console", "global.console.log(1)"],
    ['globalThis["console"]', 'globalThis["console"].log(1)'],
    ["a computed key on globalThis", "globalThis[name].log(1)"],
    ["destructuring the global object", "const { console: c } = globalThis"],
    ["process.stderr.write", 'process.stderr.write("x")'],
    ["process.stdout.write", 'process.stdout.write("x")'],
    ["process.stdout?.write", 'process.stdout?.write("x")'],
    ["process bracket access", 'process["stderr"].write("x")'],
    ["process computed access", 'process[stream].write("x")'],
    ["destructuring process", "const { stderr } = process"],
    ["destructuring process, renamed", "const { stdout: out } = process"],
    ["importing the console module", 'import { log } from "node:console"'],
    ["importing console (no prefix)", 'import { Console } from "console"'],
    ["requiring the console module", 'const c = require("node:console")'],
    ["fs.writeSync to stderr", 'fs.writeSync(2, "x")'],
    [
      "an aliased writeSync import",
      'import { writeSync as w } from "node:fs"; w(2, "x")',
    ],
    ["a renamed writeSync import", 'import { writeSync } from "fs"'],
    ["a named stdout import", 'import { stdout } from "node:process"'],
    ["a renamed stderr import", 'import { stderr as e } from "process"'],
    [
      "a namespace import of process",
      'import * as p from "node:process"; p.stdout.write("x")',
    ],
    [
      "a default import of process",
      'import proc from "node:process"; proc.stderr.write("x")',
    ],
    [
      "a required process",
      'const p = require("node:process"); p.stdout.write("x")',
    ],
    [
      "destructuring a required process",
      'const { stdout } = require("node:process")',
    ],
    ["a dynamic import of the console module", 'await import("node:console")'],
    ["a dynamic import of process", 'const p = await import("node:process")'],
    ["writeSync imported by name", 'writeSync(1, "x")'],
    [
      "after a // inside a string",
      'const url = "http://example.test"; console.log(url)',
    ],
    [
      "after a // inside a template",
      "const u = `https://x/${id}`; console.log(u)",
    ],
    ["a console call on the same line as a comment", "console.log(1) // ok"],
    ["a shorthand property", "const o = { console }"],
  ])("flags %s", (_name, code) => {
    expect(findOutputCalls(code).length).toBeGreaterThan(0);
  });

  it.each([
    ["the word in a string", 'const s = "console.log(1)"'],
    ["the word in a template", "const s = `use console.log here`"],
    ["the word in a line comment", "// console.log(1)\nconst a = 1"],
    ["the word in a block comment", "/* console.log(1) */ const a = 1"],
    [
      "a // inside a string followed by clean code",
      'const u = "http://x"; const v = 2;',
    ],
    ["a property called console", "const v = settings.console"],
    ["an object key called console", "const o = { console: 1 }"],
    ["an interface member called console", "interface A { console: string }"],
    ["a similar identifier", "const consoleLike = 1; consoleLike.log(1)"],
    ["a logger", 'import { log } from "../log"; log.info("x", {})'],
    ["process.env", "const v = process.env.NODE_ENV"],
    [
      "an imported process used for its environment",
      'import process from "node:process"; const v = process.env.X',
    ],
    [
      "a namespace import used for its environment",
      'import * as p from "node:process"; const v = p.env.X; p.exit(1)',
    ],
    ["a named non-stream import", 'import { env, exit } from "node:process"'],
    ["a dynamic import of another module", 'await import("node:fs")'],
    ["a stream name on another object", "const v = other.stdout"],
    ["process.exit", "process.exit(1)"],
    [
      "a stream-like name elsewhere",
      "const stderr = makeStream(); stderr.write('x')",
    ],
    ["writeSync to a file descriptor variable", "fs.writeSync(fd, 'x')"],
  ])("does not flag %s", (_name, code) => {
    expect(findOutputCalls(code)).toEqual([]);
  });

  it("names the line", () => {
    expect(findOutputCalls("const a = 1;\n\nconsole.log(a)")[0]).toMatch(
      /^line 3:/,
    );
  });
});

// ── The repository ────────────────────────────────────────────────────────
/** Files allowed to write to the console, each with the reason. */
export const EXCEPTIONS: Record<string, string> = {
  "src/server/log.ts": "the sink: the one place a redacted line is written",
  "src/lib/learning/terminal.ts":
    "the terminal of the `npm run learn:sort` script (Node only, run by hand): its default sink is the operator's own console, and every line is passed through redactText first. The app never imports it",
  "src/client/scan/submitScan.ts":
    "runs only in the browser, after the user presses submit; prints the server's public error detail to that user's own devtools console, never to a server log",
};

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const files = (
  readdirSync("src", { recursive: true, encoding: "utf8" }) as string[]
)
  .map((path) => `src/${path.replaceAll("\\", "/")}`)
  .filter((path) => SOURCE.test(path))
  .sort();

const hitsIn = (path: string) =>
  findOutputCalls(readFileSync(join(path), "utf8"), path);

describe("source code writes logs through src/server/log.ts only", () => {
  it("scans the server code, the server pages and the client (the scan would be vacuous otherwise)", () => {
    for (const dir of [
      "src/server/",
      "src/app/api/",
      "src/lib/",
      "src/db/",
      "src/app/",
      "src/client/",
      "src/components/",
    ]) {
      expect(
        files.some((f) => f.startsWith(dir)),
        dir,
      ).toBe(true);
    }
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/server/analysis/handler.ts");
    expect(files).toContain("src/app/page.tsx");
  });

  it("finds no console or process-stream output outside the listed files", () => {
    const offenders = files
      .filter((f) => !(f in EXCEPTIONS))
      .flatMap((f) => hitsIn(f).map((h) => `${f}: ${h}`));
    expect(offenders).toEqual([]);
  });

  it.each(Object.entries(EXCEPTIONS))(
    "the exception %s is real (it still writes to the console) and says why",
    (path, reason) => {
      expect(files).toContain(path);
      expect(hitsIn(path).length).toBeGreaterThan(0);
      expect(reason.length).toBeGreaterThan(20);
    },
  );
});
