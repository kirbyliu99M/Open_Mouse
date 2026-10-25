/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * The copy convention (src/lib/i18n/copy.ts): every module in src/lib/copy/
 * exports `zhTW` and `en`, two tables with identical deep key sets and no
 * empty string. Functions are allowed as values; they are called with a sample
 * argument and must return a non-empty string.
 */
const modules = import.meta.glob<Record<string, unknown>>(
  "../../src/lib/copy/*.ts",
  { eager: true },
);

const EXPECTED_MODULES = [
  "account.ts",
  "camera-cues.ts",
  "cookie-consent.ts",
  "easy-scan.ts",
  "errors.ts",
  "fit-bands.ts",
  "home-story.ts",
  "home.ts",
  "how-it-works.ts",
  "language-switcher.ts",
  "learn-page.ts",
  "learn.ts",
  "loading.ts",
  "manualEntry.ts",
  "mice-page.ts",
  "nav.ts",
  "paper-adjust.ts",
  "paper-stage.ts",
  "privacy.ts",
  "questionnaire.ts",
  "result-feedback.ts",
  "results-additions.ts",
  "results-page.ts",
  "results-reasons.ts",
  "results-screens.ts",
  "scan-answers.ts",
  "scan-common.ts",
  "scan-issues.ts",
  "scan-sheet.ts",
  "share-card.ts",
  "sheet.ts",
  "site-footer.ts",
  "site-meta.ts",
];

/** Functions whose arguments are not a name or a count. */
const SAMPLE_ARGS: Record<string, unknown[]> = {
  excludedReason: ["wrong_hand", "right"],
};

const CJK = /[㐀-鿿]/;

/** Dotted paths of every leaf (a function counts as a leaf), sorted. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null) throw new Error(`null at "${prefix}"`);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
      .sort();
  }
  return [prefix];
}

/** Every leaf string (functions are called with a sample), with its path. */
function leafStrings(value: unknown, prefix = ""): [string, unknown][] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafStrings(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    let sample: unknown;
    const args = SAMPLE_ARGS[prefix];
    if (args) return [[prefix, fn(...args)]];
    try {
      // A name or a count.
      sample = fn("Sample", "Sample", "Sample");
    } catch {
      // A list of names.
      sample = fn(["Sample"], ["Sample"], ["Sample"]);
    }
    return [[prefix, sample]];
  }
  return [[prefix, value]];
}

/** The problems with a pair of tables; empty when the pair is fine. */
function checkTables(zhTW: unknown, en: unknown): string[] {
  const problems: string[] = [];
  if (zhTW === null || typeof zhTW !== "object") return ["zhTW is not a table"];
  if (en === null || typeof en !== "object") return ["en is not a table"];
  let zhKeys: string[] = [];
  let enKeys: string[] = [];
  try {
    zhKeys = keyPaths(zhTW);
    enKeys = keyPaths(en);
  } catch (e) {
    return [String(e)];
  }
  for (const k of zhKeys)
    if (!enKeys.includes(k)) problems.push(`en lacks ${k}`);
  for (const k of enKeys)
    if (!zhKeys.includes(k)) problems.push(`zhTW lacks ${k}`);
  for (const [name, table] of [
    ["zhTW", zhTW],
    ["en", en],
  ] as const) {
    for (const [path, v] of leafStrings(table)) {
      if (typeof v !== "string" || v.trim() === "")
        problems.push(`${name}.${path} is not a non-empty string`);
    }
  }
  if (!leafStrings(zhTW).some(([, v]) => typeof v === "string" && CJK.test(v)))
    problems.push("zhTW has no Chinese character");
  return problems;
}

describe("copy modules in src/lib/copy/", () => {
  it("are exactly the known modules (add a new one here)", () => {
    expect(
      Object.keys(modules)
        .map((p) => p.split("/").pop())
        .sort(),
    ).toEqual(EXPECTED_MODULES);
  });

  for (const [path, mod] of Object.entries(modules)) {
    it(`${path.split("/").pop()}: zhTW and en match, are non-empty, and zhTW is Chinese`, () => {
      expect(mod.zhTW, "zhTW").toBeTypeOf("object");
      expect(mod.en, "en").toBeTypeOf("object");
      expect(checkTables(mod.zhTW, mod.en)).toEqual([]);
    });
  }

  it("negative controls: checkTables catches each kind of fault", () => {
    expect(checkTables({ a: "中", b: "x" }, { a: "a", b: "x" })).toEqual([]);
    // A missing key.
    expect(checkTables({ a: "中", b: "中" }, { a: "a" })).toContain(
      "en lacks b",
    );
    expect(checkTables({ a: "中" }, { a: "a", b: "b" })).toContain(
      "zhTW lacks b",
    );
    // An empty string, in either table.
    expect(checkTables({ a: "中" }, { a: " " })).toContain(
      "en.a is not a non-empty string",
    );
    // A function returning an empty string.
    expect(checkTables({ a: () => "" }, { a: () => "x" }).join()).toContain(
      "zhTW.a",
    );
    // A null value.
    expect(checkTables({ a: null }, { a: "x" })[0]).toContain("null");
    // A zhTW table with no Chinese in it.
    expect(checkTables({ a: "x" }, { a: "x" })).toContain(
      "zhTW has no Chinese character",
    );
  });
});
