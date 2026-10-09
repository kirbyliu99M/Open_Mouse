import { describe, expect, it } from "vitest";
import {
  GRIP_STYLES,
  HAND_TYPE_SIZES,
  HAND_TYPE_WIDTHS,
  type HandType,
} from "../../src/lib/contracts/fit";
import { handTypeLabel } from "../../src/lib/results/handTypeLabel";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import type { UiLanguage } from "../../src/client/uiLanguage";

const LANGUAGES: UiLanguage[] = ["zh-TW", "en"];

const ALL: HandType[] = HAND_TYPE_SIZES.flatMap((size) =>
  GRIP_STYLES.flatMap((grip) =>
    HAND_TYPE_WIDTHS.map((width) => ({ size, grip, width })),
  ),
);

describe("handTypeLabel", () => {
  it("returns nothing when the response carries no hand type", () => {
    for (const language of LANGUAGES) {
      expect(handTypeLabel(undefined, language)).toBeNull();
      expect(handTypeLabel(null, language)).toBeNull();
    }
  });

  it("builds the title from size, grip and width, joined with the language's separator", () => {
    const hand = { size: "medium", grip: "claw", width: "wide" } as const;
    expect(handTypeLabel(hand, "zh-TW")?.title).toBe("中型滑鼠・抓握・寬身");
    expect(handTypeLabel(hand, "en")?.title).toBe(
      "Medium mouse · Claw grip · Wide",
    );
  });

  it("writes the sentence from the parts (the approved zh-TW example)", () => {
    const hand = { size: "medium", grip: "claw", width: "wide" } as const;
    expect(handTypeLabel(hand, "zh-TW")).toEqual({
      kicker: "適合你的滑鼠型",
      title: "中型滑鼠・抓握・寬身",
      sentence: "適合長度中等、握寬較寬的滑鼠；以抓握的方式最能發揮。",
    });
  });

  it("covers every size, grip and width in both languages, each combination distinct", () => {
    expect(ALL).toHaveLength(18);
    for (const language of LANGUAGES) {
      const titles = ALL.map((h) => handTypeLabel(h, language)?.title);
      const sentences = ALL.map((h) => handTypeLabel(h, language)?.sentence);
      expect(new Set(titles).size).toBe(18);
      expect(new Set(sentences).size).toBe(18);
    }
  });

  it("is about the mouse: no digit, no medical claim, no comparison, no accuracy word", () => {
    const comparison =
      /most people|others|average|percentile|better than|多數人|別人|平均|百分位/i;
    const accuracy =
      /accura|precis|certain|guarantee|exact|準確|精準|精確|保證|一定/i;
    for (const language of LANGUAGES) {
      for (const hand of ALL) {
        const label = handTypeLabel(hand, language);
        expect(label).not.toBeNull();
        for (const text of [label!.kicker, label!.title, label!.sentence]) {
          expect(text, text).not.toMatch(/\p{Nd}/u);
          expect(findMedicalClaimTerm(text), text).toBeNull();
          expect(text, text).not.toMatch(comparison);
          expect(text, text).not.toMatch(accuracy);
        }
      }
    }
  });

  it("names a mouse, not the hand", () => {
    for (const hand of ALL) {
      expect(handTypeLabel(hand, "zh-TW")?.title).toContain("滑鼠");
      expect(handTypeLabel(hand, "en")?.title).toContain("mouse");
    }
  });
});
