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

  it("keeps the Pencil board wording where Kirby saw it, and the round-2 changes", () => {
    expect(zhTW.handleLabel).toBe("改用輸入數字");
    expect(zhTW.title).toBe("輸入手的尺寸");
    expect(zhTW.handLegend).toBe("你用哪隻手握滑鼠？");
    expect(zhTW.use).toBe("確認");
    expect(zhTW.cancel).toBe("取消");
    // No sentence that says it replaces the scan; the numbers are for the mouse hand.
    expect(zhTW.intro).toBe("不用掃描，直接輸入手長與手寬。");
    expect(zhTW.handHelp).toBe("請量你握滑鼠的那隻手。");
    expect(en.handHelp).toBe("Measure the hand you hold the mouse with.");
    for (const text of [zhTW.intro, en.intro])
      expect(text).not.toMatch(/取代|replace/i);
  });

  it("names the unit in each label, so it is in the accessible name", () => {
    expect(zhTW.lengthLabel).toBe("手長（公分）");
    expect(zhTW.widthLabel).toBe("手寬（公分）");
    expect(en.lengthLabel).toBe("Hand length (cm)");
    expect(en.widthLabel).toBe("Hand width (cm)");
  });

  it("gives one ruler measuring line per field, in both languages", () => {
    expect(zhTW.lengthHelp).toContain("手腕橫紋到中指指尖");
    expect(zhTW.widthHelp).toContain("四指根部關節處");
    expect(en.lengthHelp).toMatch(
      /wrist crease to the tip of your middle finger/,
    );
    expect(en.widthHelp).toMatch(/knuckles/);
    for (const text of [zhTW.lengthHelp, zhTW.widthHelp])
      expect(text).toContain("用尺量");
    for (const text of [en.lengthHelp, en.widthHelp])
      expect(text).toMatch(/ruler/);
  });

  it("marks the hand as required, and the close button is just Close", () => {
    expect(zhTW.required).toBe("必填");
    expect(en.required).toBe("Required");
    expect(en.closeSheet).toBe("Close");
    expect(zhTW.closeSheet).toBe("關閉");
  });

  it("speaks of entering, not typing, in the handle and the title", () => {
    expect(en.handleLabel).toMatch(/^Enter /);
    expect(en.title).toMatch(/^Enter /);
    expect(zhTW.handleLabel).toContain("輸入");
    expect(zhTW.title).toContain("輸入");
    for (const text of allStrings(en))
      expect(text).not.toMatch(/\btyp(e|ing)\b/i);
  });

  it("gives a way out when the width does not fit the length, without blame", () => {
    for (const text of [
      zhTW.errors.widthNarrowForLength("18.5", "7.1", "10.3"),
      zhTW.errors.widthWideForLength("18.5", "7.1", "10.3"),
    ]) {
      expect(text).toContain("請再量一次");
      expect(text).toContain("改用掃描");
    }
    for (const text of [
      en.errors.widthNarrowForLength("18.5", "7.1", "10.3"),
      en.errors.widthWideForLength("18.5", "7.1", "10.3"),
    ]) {
      expect(text).toContain("Measure again");
      expect(text).toContain("scan your hand instead");
    }
  });

  it("states the disclosure with the typed numbers, a unit joined by a no-break space", () => {
    expect(zhTW.resultsNotice("18.5", "8.2")).toBe(
      `依你輸入的手長 18.5${NBSP}公分、手寬 8.2${NBSP}公分估算；掌長為估計值。`,
    );
    // Like the neighbouring typed-length note, it ends with a full stop.
    expect(zhTW.resultsNotice("18.5", "8.2").endsWith("。")).toBe(true);
    expect(en.resultsNotice("18.5", "8.2")).toContain(`18.5${NBSP}cm`);
    expect(en.resultsNotice("18.5", "8.2")).toContain(`8.2${NBSP}cm`);
    expect(en.resultsNotice("18.5", "8.2")).toMatch(
      /palm length is an estimate/,
    );
  });

  it("states the width a length needs as a requirement, not as what is usual", () => {
    expect(zhTW.errors.widthNarrowForLength("18.5", "7.1", "10.3")).toContain(
      "手寬需在",
    );
    expect(zhTW.errors.widthWideForLength("18.5", "7.1", "10.3")).toContain(
      "手寬需在",
    );
    for (const text of [
      en.errors.widthNarrowForLength("18.5", "7.1", "10.3"),
      en.errors.widthWideForLength("18.5", "7.1", "10.3"),
    ])
      expect(text).toContain("Hand width must be between");
    for (const text of allStrings(zhTW)) expect(text).not.toContain("通常");
    for (const text of allStrings(en)) expect(text).not.toMatch(/usually/);
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
