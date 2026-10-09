import { describe, expect, it } from "vitest";
import { EXCLUSION_REASONS } from "../../src/lib/contracts/fit";
import {
  en,
  RESULTS_PAGE_COPY,
  zhTW,
  type ResultsPageCopy,
} from "../../src/lib/copy/results-page";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";

/** Every key path of an object, so two languages can be compared. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") return [prefix];
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) =>
      keyPaths(child, prefix ? `${prefix}.${key}` : key),
    )
    .sort();
}

/** Every string a table can produce, calling the functions with sample input. */
function allStrings(copy: ResultsPageCopy): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      out.push(
        (value as (...a: unknown[]) => string)(
          ...(value.length >= 2 ? [1, "Brand"] : [186]),
        ),
      );
    } else if (value && typeof value === "object")
      for (const child of Object.values(value)) walk(child);
  };
  walk(copy);
  return out;
}

describe("results page copy", () => {
  it("has the same keys in zh-TW and English", () => {
    expect(keyPaths(zhTW)).toEqual(keyPaths(en));
  });

  it("is picked by language", () => {
    expect(RESULTS_PAGE_COPY["zh-TW"]).toBe(zhTW);
    expect(RESULTS_PAGE_COPY.en).toBe(en);
  });

  it("explains every exclusion reason in both languages", () => {
    for (const copy of [zhTW, en])
      expect(Object.keys(copy.excludedReason).sort()).toEqual(
        [...EXCLUSION_REASONS].sort(),
      );
  });

  it("makes no medical claim in any string", () => {
    for (const copy of [zhTW, en])
      for (const text of allStrings(copy))
        expect(findMedicalClaimTerm(text), text).toBeNull();
  });

  it("has no empty string", () => {
    for (const copy of [zhTW, en])
      for (const text of allStrings(copy)) expect(text.trim()).not.toBe("");
  });

  it("keeps a number and its unit together", () => {
    for (const copy of [zhTW, en]) {
      const text = copy.enteredLengthNotice(186);
      expect(text).toContain("186 mm");
      expect(text).not.toMatch(/186 mm/);
    }
  });

  it("numbers ranks one to five in Chinese and the rest with digits", () => {
    expect(zhTW.rankLine(1, "Logitech")).toBe("第一名 · Logitech");
    expect(zhTW.rankLine(5, "Razer")).toBe("第五名 · Razer");
    expect(zhTW.rankLine(6, "Razer")).toBe("第 6 名 · Razer");
    expect(en.rankLine(2, "Razer")).toBe("#2 · Razer");
  });

  it("counts the other mice from the number it is given", () => {
    expect(zhTW.otherMiceTitle(172)).toBe("其他滑鼠（共 172 款）");
    expect(en.otherMiceTitle(7)).toBe("Other mice (7)");
  });
});
