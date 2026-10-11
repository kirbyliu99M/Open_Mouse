import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENT = "src/components/results/PhotoZoom.tsx";
const MATHS = "src/lib/results/photoZoom.ts";
const CSS = "src/components/results/results.css";

/** Source without comments, so a sentence that names a module is not an import. */
function strip(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function code(file: string): string {
  return strip(readFileSync(file, "utf8"));
}

/** Every module specifier the file loads. */
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["'`]([^"'`]+)["'`]/g,
    ),
  ].map((m) => m[1]);
}

/** A project specifier as a file path, or null for a package. */
function resolveLocal(spec: string, from: string): string | null {
  const base = spec.startsWith("@/")
    ? join("src", spec.slice(2))
    : spec.startsWith(".")
      ? join(dirname(from), spec)
      : null;
  if (base === null) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const path = base + ext;
    if (/\.(ts|tsx)$/.test(path) && existsSync(path)) return path;
  }
  throw new Error(`${spec} (from ${from}) does not resolve`);
}

/** Every package the file reaches through project modules, and the files walked. */
function graph(entry: string): { packages: Set<string>; files: Set<string> } {
  const packages = new Set<string>();
  const files = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of specifiers(code(file))) {
      const local = resolveLocal(spec, file);
      if (local) visit(local);
      else packages.add(spec);
    }
  };
  visit(entry);
  return { packages, files };
}

/** The text of the first CSS rule whose selector list contains `selector`. */
function rule(css: string, selector: string, within = css): string {
  const at = within.indexOf(selector);
  expect(at, `${selector} is in the CSS`).toBeGreaterThanOrEqual(0);
  return within.slice(at, within.indexOf("}", at) + 1);
}

describe("the enlarge-photo dialog has no dependency beyond React and the project", () => {
  const component = code(COMPONENT);

  it("the component imports only react and pure project modules", () => {
    const found = specifiers(component);
    expect(found).toContain("react");
    expect(found.filter((spec) => spec !== "react").sort()).toEqual([
      "@/lib/results/photoDialogControl",
      "@/lib/results/photoPaths",
      "@/lib/results/photoZoom",
    ]);
  });

  it("its whole import graph reaches no package but react, and never zod", () => {
    const { packages, files } = graph(COMPONENT);
    expect([...packages]).toEqual(["react"]);
    expect(packages.has("zod")).toBe(false);
    // Not through mouseMedia.ts (which reads files with zod) either.
    expect([...files].some((f) => f.endsWith("mouseMedia.ts"))).toBe(false);
    expect([...files].map((f) => f.replaceAll("\\", "/")).sort()).toEqual([
      COMPONENT,
      "src/lib/results/photoDialogControl.ts",
      "src/lib/results/photoPaths.ts",
      MATHS,
    ]);
  });

  it("the three pure modules import nothing at all", () => {
    for (const file of [
      MATHS,
      "src/lib/results/photoPaths.ts",
      "src/lib/results/photoDialogControl.ts",
    ]) {
      expect(specifiers(code(file)), file).toEqual([]);
    }
  });

  it("the component is a client component", () => {
    expect(readFileSync(COMPONENT, "utf8")).toMatch(/^"use client";/);
  });

  it("calls showModal() on the dialog (through the lock) and renders a <dialog> element", () => {
    // The call itself, not a mention: in the lock module...
    expect(code("src/lib/results/photoDialogControl.ts")).toMatch(
      /dialog\.showModal\(\)/,
    );
    // ...which the component calls, with the real element and document.body.
    expect(component).toMatch(/lockModal\(\s*dialog\s*,\s*document\.body\s*\)/);
    // And the element is in the JSX, with the close handler and a label.
    expect(component).toMatch(/<dialog[\s\S]*?ref=\{dialogRef\}/);
    expect(component).toMatch(/<dialog[\s\S]*?onClose=\{/);
    expect(component).toMatch(/<dialog[\s\S]*?aria-labelledby=/);
  });

  it("the close handler asks the lock before reporting a close", () => {
    expect(component).toMatch(/shouldNotifyClosed\(\)\s*===\s*false/);
  });

  it("returns focus to the opening button after a close", () => {
    const start = component.indexOf("const handleClosed");
    const end = component.indexOf("return (", start);
    expect(component.slice(start, end)).toMatch(
      /buttonRef\.current\?\.focus\(/,
    );
  });

  it("the scrim closes on click, after a clean press, never on pointerdown", () => {
    expect(component).toMatch(/scrimPress\.current\.up\(/);
    expect(component).not.toMatch(/onPointerDown=\{[^}]*\.close\(\)/);
    expect(component).toMatch(/onClick=\{\(event\) => \{[\s\S]*?\.close\(\)/);
  });

  it("the scrim press is told whether the target was the scrim itself, on down and on up", () => {
    const calls = component.match(
      /scrimPress\.current\.(?:down|up)\(\s*event\.pointerId,\s*event\.target === event\.currentTarget,?\s*\)/g,
    );
    expect(calls).toHaveLength(2);
    expect(component).toMatch(
      /close && event\.target === event\.currentTarget/,
    );
  });

  it("the photo area can take focus by click so the keys keep working", () => {
    expect(component).toMatch(/tabIndex=\{-1\}/);
    expect(
      rule(readFileSync(CSS, "utf8"), ".results-photoDialog-area:focus"),
    ).toMatch(/outline:\s*none/);
  });

  it("the preload remembers the URL, not just that it ran once", () => {
    expect(component).toContain("preloadedUrl");
    expect(component).not.toMatch(/preloaded\s*=\s*useRef\(false\)/);
  });
});

describe("no layout read while a gesture moves", () => {
  const component = code(COMPONENT);

  it("getBoundingClientRect is read in exactly one place: measure()", () => {
    const reads = component.match(/getBoundingClientRect/g) ?? [];
    expect(reads).toHaveLength(1);
    const start = component.indexOf("const measure = useCallback");
    const end = component.indexOf("const local = useCallback");
    expect(component.slice(start, end)).toContain("getBoundingClientRect");
    expect(component).not.toMatch(
      /offsetWidth|offsetHeight|clientWidth|clientHeight|getComputedStyle|scrollTop|scrollLeft/,
    );
  });

  it("measure() is not called from a gesture handler or the helpers it calls", () => {
    // Handlers and the helpers they call (commit, flush, local, rebasePinch,
    // startDrag) are all between `flush` and the keyboard handler or inside
    // the wheel effect: none of them names measure.
    const gesture = component.slice(
      component.indexOf("const flush = useCallback"),
      component.indexOf("const measure = useCallback"),
    );
    expect(gesture).not.toMatch(/measure/);
    const handlers = component.slice(
      component.indexOf("// --- pointer gestures"),
      component.indexOf("// --- keyboard"),
    );
    expect(handlers).not.toMatch(/measure/);
    const wheel = component.slice(
      component.indexOf("const onWheel"),
      component.indexOf('area.addEventListener("wheel"'),
    );
    expect(wheel).not.toMatch(/measure/);
  });

  it("the move is written as a transform only", () => {
    const maths = code(MATHS);
    expect(maths).toContain("translate3d");
    expect(maths).toContain("scale(");
  });
});

describe("the dialog's CSS", () => {
  const css = readFileSync(CSS, "utf8");

  it("the corner icon and the close button are 44 x 44", () => {
    const shared = rule(
      css,
      ".results-photoZoom-icon,\n.results-photoDialog-close {",
    );
    expect(shared).toMatch(/width:\s*44px/);
    expect(shared).toMatch(/height:\s*44px/);
  });

  it("print hides the icon and the dialog, with !important", () => {
    const print = css.slice(css.lastIndexOf("@media print"));
    expect(css.match(/@media print/g)?.length).toBeGreaterThan(0);
    const hit = css.match(
      /@media print \{[\s\S]*?\.results-photoZoom-icon,\s*\.results-photoDialog \{\s*display:\s*none\s*!important;/,
    );
    expect(hit, "a print rule hides icon and dialog").not.toBeNull();
    expect(print.length).toBeGreaterThan(0);
  });

  it("reduced motion turns the dialog and photo animations off", () => {
    const block = css.match(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.results-photoDialog\[open\],\s*\.results-photoDialog-area \{\s*animation:\s*none;/,
    );
    expect(block).not.toBeNull();
  });

  it("a landscape phone gets the same height cap as a wide screen", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 47.99rem)"));
    const area = rule(mobile, ".results-photoDialog-area");
    expect(area).toMatch(
      /min\(100%, calc\(\(100dvh - 6rem\) \* 1109 \/ 960\)\)/,
    );
    expect(rule(css, ".results-photoDialog {\n  position: fixed;")).toMatch(
      /overflow:\s*hidden/,
    );
  });

  it("the small cards keep a thinner inset than the hero", () => {
    expect(rule(css, ".results-card .results-photo-img")).toMatch(
      /inset:\s*0\.375rem/,
    );
    expect(rule(css, ".results-photo-img {")).toMatch(/inset:\s*0\.75rem/);
  });

  it("only the photo area turns touch-action off", () => {
    const hits = css.match(/touch-action:\s*none/g) ?? [];
    expect(hits).toHaveLength(1);
    expect(rule(css, ".results-photoDialog-area {")).toMatch(
      /touch-action:\s*none/,
    );
  });
});
