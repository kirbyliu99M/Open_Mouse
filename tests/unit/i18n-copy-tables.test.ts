/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * The copy convention (src/lib/i18n/copy.ts): every module in src/lib/copy/
 * exports `zhTW` and `en`, two tables with identical deep key sets and no
 * empty string. Functions are allowed as values.
 */
const modules = import.meta.glob<Record<string, unknown>>(
  "../../src/lib/copy/*.ts",
  { eager: true },
);

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") return [prefix];
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
      .sort();
  }
  return [prefix];
}

function emptyStrings(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return value.trim() === "" ? [prefix] : [];
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      emptyStrings(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

describe("copy modules in src/lib/copy/", () => {
  it("finds the modules", () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(7);
  });

  for (const [path, mod] of Object.entries(modules)) {
    const name = path.split("/").pop();
    describe(name ?? path, () => {
      it("exports zhTW and en", () => {
        expect(mod.zhTW, "zhTW").toBeTypeOf("object");
        expect(mod.en, "en").toBeTypeOf("object");
      });
      it("gives both tables the same deep keys", () => {
        expect(keyPaths(mod.zhTW)).toEqual(keyPaths(mod.en));
      });
      it("has no empty string in either table", () => {
        expect(emptyStrings(mod.zhTW)).toEqual([]);
        expect(emptyStrings(mod.en)).toEqual([]);
      });
    });
  }

  it("catches a missing key (negative control)", () => {
    expect(keyPaths({ a: "x", b: { c: "y" } })).not.toEqual(
      keyPaths({ a: "x", b: {} }),
    );
    expect(emptyStrings({ a: " " })).toEqual(["a"]);
  });
});
