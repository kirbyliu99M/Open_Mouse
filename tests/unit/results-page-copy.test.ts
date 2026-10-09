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
    else if (value === copy.excludedReason) {
      for (const reason of EXCLUSION_REASONS)
        for (const hand of ["left", "right"] as const)
          out.push(copy.excludedReason(reason, hand));
    } else if (value === copy.variantsLine) {
      out.push(copy.variantsLine(["Model A", "Model B"]));
    } else if (typeof value === "function") {
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

  it("explains every exclusion reason in both languages, each differently", () => {
    for (const copy of [zhTW, en]) {
      const texts = EXCLUSION_REASONS.map((r) =>
        copy.excludedReason(r, "right"),
      );
      for (const text of texts) expect(text.trim()).not.toBe("");
      expect(new Set(texts).size).toBe(EXCLUSION_REASONS.length);
    }
  });

  it("says which hand a wrong-hand mouse is made for: the other one", () => {
    expect(zhTW.excludedReason("wrong_hand", "right")).toBe("為左手設計");
    expect(zhTW.excludedReason("wrong_hand", "left")).toBe("為右手設計");
    expect(en.excludedReason("wrong_hand", "right")).toBe(
      "Made for the left hand",
    );
    expect(en.excludedReason("wrong_hand", "left")).toBe(
      "Made for the right hand",
    );
  });

  it("says the scoring does not cover a vertical mouse or a trackball", () => {
    expect(zhTW.excludedReason("vertical_form_factor", "right")).toBe(
      "垂直滑鼠：目前的評分方式不適用",
    );
    expect(zhTW.excludedReason("trackball_form_factor", "right")).toBe(
      "軌跡球：目前的評分方式不適用",
    );
    expect(en.excludedReason("vertical_form_factor", "right")).toBe(
      "Vertical mouse: our scoring doesn't cover this shape yet",
    );
    expect(en.excludedReason("trackball_form_factor", "right")).toBe(
      "Trackball: our scoring doesn't cover this shape yet",
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

  it("names the back link like the shared TopBar: a back-to in front of the destination", () => {
    expect(en.backTo(en.scanAgain)).toBe("Back to Scan again");
    expect(zhTW.backTo(zhTW.scanAgain)).toBe("返回重新掃描");
  });

  it("labels an excluded mouse's number as the score of its mirrored shape, in the scanned hand's terms", () => {
    expect(zhTW.excludedMirrorLabel("right")).toBe("若是右手形狀：");
    expect(zhTW.excludedMirrorLabel("left")).toBe("若是左手形狀：");
    expect(en.excludedMirrorLabel("right")).toBe("as a right-hand shape:");
    expect(en.excludedMirrorLabel("left")).toBe("as a left-hand shape:");
  });

  it("says what the other-mice list holds, including the reasons", () => {
    expect(zhTW.otherMiceHint).toBe("分數與型號；未列入比較的附原因");
    expect(en.otherMiceHint).toBe("Scores and names; mice left out show why");
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
