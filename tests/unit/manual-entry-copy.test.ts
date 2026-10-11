import { describe, expect, it } from "vitest";
import {
  en,
  manualEntryCopy,
  zhTW,
  type ManualEntryCopy,
} from "../../src/lib/copy/manualEntry";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";

const NBSP = String.fromCharCode(0xa0);

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") return [prefix];
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) =>
      keyPaths(child, prefix ? `${prefix}.${key}` : key),
    )
    .sort();
}

/** Every string a table can produce, calling the functions with sample cm text. */
function allStrings(copy: ManualEntryCopy): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function")
      out.push((value as (...a: string[]) => string)("18.5", "7.1", "10.3"));
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) walk(child);
  };
  walk(copy);
  return out;
}

describe("manual entry copy", () => {
  it("has the same keys in zh-TW and English, and picks by locale", () => {
    expect(keyPaths(zhTW)).toEqual(keyPaths(en));
    expect(manualEntryCopy("zh-TW")).toBe(zhTW);
    expect(manualEntryCopy("en")).toBe(en);
  });

  it("has no empty string in either language", () => {
    for (const copy of [zhTW, en])
      for (const text of allStrings(copy)) expect(text.trim()).not.toBe("");
  });

  it("uses the Pencil board wording for the sheet in zh-TW", () => {
    expect(zhTW.handleLabel).toBe("改用輸入數字");
    expect(zhTW.title).toBe("輸入手的尺寸");
    expect(zhTW.intro).toBe("輸入後會取代掃描結果。");
    expect(zhTW.handLegend).toBe("你用哪隻手握滑鼠？");
    expect(zhTW.lengthHelp).toBe("手腕橫紋到中指指尖");
    expect(zhTW.widthHelp).toBe("四指根部關節處，手掌最寬的地方");
    expect(zhTW.use).toBe("使用這組數字");
    expect(zhTW.cancel).toBe("取消");
  });

  it("states the disclosure with the typed numbers, a unit joined by a no-break space", () => {
    expect(zhTW.resultsNotice("18.5", "8.2")).toBe(
      `依你輸入的手長 18.5${NBSP}公分、手寬 8.2${NBSP}公分估算；掌長為估計值`,
    );
    expect(en.resultsNotice("18.5", "8.2")).toContain(`18.5${NBSP}cm`);
    expect(en.resultsNotice("18.5", "8.2")).toContain(`8.2${NBSP}cm`);
    expect(en.resultsNotice("18.5", "8.2")).toMatch(
      /palm length is an estimate/,
    );
  });

  it("never wraps a number away from its unit in an error", () => {
    for (const copy of [zhTW, en])
      for (const text of allStrings(copy))
        expect(text, text).not.toMatch(/\d (cm|公分)/);
  });

  it("makes no medical claim", () => {
    for (const copy of [zhTW, en])
      for (const text of allStrings(copy))
        expect(findMedicalClaimTerm(text), text).toBeNull();
  });
});
