/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * Term rule (Kirby, 2026-10-12): the zh-TW copy calls a mouse's hump 「駝峰」.
 * The older wordings 「背弧」 and 「拱背」 must not come back. The check reads
 * every module in src/lib/copy/ as source text, so strings behind a function
 * are covered too; the positive check calls the modules' tables.
 */
const sources = import.meta.glob<string>("../../src/lib/copy/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});
const modules = import.meta.glob<Record<string, unknown>>(
  "../../src/lib/copy/*.ts",
  { eager: true },
);

const RETIRED_TERMS = ["背弧", "拱背"] as const;
const TERM = "駝峰";

/** Every string reachable in a table; a function is called with a sample. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    try {
      return strings((value as (...a: unknown[]) => unknown)("Sample"));
    } catch {
      return [];
    }
  }
  if (value !== null && typeof value === "object")
    return Object.values(value as Record<string, unknown>).flatMap(strings);
  return [];
}

describe("zh-TW hump term", () => {
  it("finds the copy modules", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
  });

  for (const [path, text] of Object.entries(sources)) {
    it(`${path.split("/").pop()}: has none of the retired wordings`, () => {
      for (const term of RETIRED_TERMS) expect(text).not.toContain(term);
    });
  }

  it("uses 駝峰 in at least one zh-TW string", () => {
    const zhStrings = Object.values(modules).flatMap((m) => strings(m.zhTW));
    expect(zhStrings.some((s) => s.includes(TERM))).toBe(true);
  });
});
