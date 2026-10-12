/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * Term rule (Kirby, 2026-10-12): the zh-TW copy calls a mouse's hump 「駝峰」.
 * The older wordings must not come back. The negative check reads every .ts and
 * .tsx file under src/ as text (comments removed, so strings behind a function
 * are covered and a comment cannot trip it). medicalClaims.ts is left out: it
 * is a list of words to match, not copy. The positive checks call the tables.
 */
const sources = import.meta.glob<string>(
  ["../../src/**/*.ts", "../../src/**/*.tsx", "!../../src/**/medicalClaims.ts"],
  { eager: true, query: "?raw", import: "default" },
);

type Table = Record<string, unknown>;
const copy = import.meta.glob<{ zhTW: Table }>("../../src/lib/copy/*.ts", {
  eager: true,
});
const zh = (name: string): Table => copy[`../../src/lib/copy/${name}.ts`]!.zhTW;

const RETIRED_TERMS = ["背弧", "拱背", "拱起支撐", "最高點的位置"] as const;
const TERM = "駝峰";

/** Source text without block comments and without line comments. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

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
  it("scans the source files, comments aside", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(
      Object.keys(sources).some((p) => p.endsWith("medicalClaims.ts")),
    ).toBe(false);
    expect(withoutComments('a // 背弧\n/* 拱背 */ b "x"')).not.toMatch(
      /背弧|拱背/,
    );
  });

  for (const term of RETIRED_TERMS) {
    it(`no source string under src/ uses the retired wording 「${term}」`, () => {
      const hits = Object.entries(sources)
        .filter(([, text]) => withoutComments(text).includes(term))
        .map(([path]) => path);
      expect(hits).toEqual([]);
    });
  }

  it("results-reasons: both hump reasons name the 駝峰", () => {
    const reasons = zh("results-reasons");
    for (const key of ["hump_matches_grip", "hump_mismatch_grip"])
      expect(strings(reasons[key]).join(""), key).toContain(TERM);
  });

  it("fit-bands: the hump impacts and the low-height line name the 駝峰", () => {
    const impact = zh("fit-bands").impact as Record<string, string>;
    for (const key of ["hump_matches_grip", "hump_mismatch_grip", "height_low"])
      expect(impact[key], key).toContain(TERM);
  });

  it("results-screens: the height-and-hump label names the 駝峰", () => {
    const label = (
      zh("results-screens").subscoreLabel as Record<string, string>
    ).heightHump;
    expect(label).toBe("高度與駝峰");
  });

  it("uses 駝峰 in at least one zh-TW string", () => {
    const all = Object.values(copy).flatMap((m) => strings(m.zhTW));
    expect(all.some((s) => s.includes(TERM))).toBe(true);
  });
});
