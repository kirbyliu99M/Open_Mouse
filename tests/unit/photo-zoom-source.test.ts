import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Source without comments, so a sentence that names a module is not an import. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every module specifier the file loads. */
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:from\s*|import\s*\(?\s*)["'`]([^"'`]+)["'`]/g),
  ].map((m) => m[1]);
}

describe("the enlarge-photo dialog has no dependency beyond React and the project", () => {
  const component = code("src/components/results/PhotoZoom.tsx");
  const maths = code("src/lib/results/photoZoom.ts");

  it("the component imports only react and @/lib/results modules", () => {
    const found = specifiers(component);
    expect(found).toContain("react");
    for (const spec of found) {
      expect(
        spec === "react" || spec.startsWith("@/lib/results/"),
        `${spec} is react or the project`,
      ).toBe(true);
    }
  });

  it("the zoom maths imports nothing at all", () => {
    expect(specifiers(maths)).toEqual([]);
  });

  it("the component is a client component and uses the native dialog", () => {
    expect(
      readFileSync("src/components/results/PhotoZoom.tsx", "utf8"),
    ).toMatch(/^"use client";/);
    expect(component).toContain("showModal");
    expect(component).toContain("<dialog");
  });

  it("the pointer-move handler reads no layout", () => {
    const start = component.indexOf("const onPointerMove");
    const end = component.indexOf("const onPointerEnd");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const handler = component.slice(start, end);
    expect(handler).not.toMatch(
      /getBoundingClientRect|offsetWidth|offsetHeight|clientWidth|clientHeight|getComputedStyle/,
    );
  });

  it("the move is written as a transform only", () => {
    expect(maths).toContain("translate3d");
    expect(maths).toContain("scale(");
  });
});
