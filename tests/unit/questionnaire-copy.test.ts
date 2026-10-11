import { describe, expect, it } from "vitest";
import {
  MAX_ACCOUNT_MICE,
  MAX_FEEDBACK_CHARS,
  PAIN_POINTS,
  SURVEY_CONSENT_VERSION,
  USE_DURATIONS,
} from "../../src/lib/contracts/survey";
import { en as accountEn, zhTW as accountZh } from "../../src/lib/copy/account";
import {
  en,
  questionnaireCopy,
  zhTW,
  type QuestionnaireCopy,
} from "../../src/lib/copy/questionnaire";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";

/** Every string of a table, with the functions called on a sample. */
function strings(table: QuestionnaireCopy): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") {
      out.push(String((value as (...a: unknown[]) => unknown)("Sample", 5, 9)));
    } else if (value !== null && typeof value === "object") {
      for (const v of Object.values(value)) walk(v);
    }
  };
  walk(table);
  return out;
}

describe("the questionnaire's words", () => {
  it("picks a table by locale", () => {
    expect(questionnaireCopy("zh-TW")).toBe(zhTW);
    expect(questionnaireCopy("en")).toBe(en);
  });

  it("the form's title and the profile page's entry both read 「我的滑鼠」", () => {
    expect(zhTW.title).toBe("我的滑鼠");
    expect(accountZh.answerQuestionnaire).toBe("我的滑鼠");
    expect(accountZh.miceHeading).toBe("我的滑鼠");
  });

  it("use-time labels: each option holds its lower bound and not its upper (Kirby, 2026-10-12)", () => {
    expect(accountZh.durations).toEqual({
      under_1_month: "少於 1 個月",
      "1_to_6_months": "1 個月至小於 6 個月",
      "6_to_12_months": "6–12 個月",
      "1_to_3_years": "1–3 年",
      over_3_years: "超過 3 年",
    });
    expect(Object.keys(accountZh.durations)).toEqual([...USE_DURATIONS]);
    expect(Object.keys(accountEn.durations)).toEqual([...USE_DURATIONS]);
    // No label spells an upper bound that another label also holds.
    expect(accountZh.durations["1_to_6_months"]).not.toContain("1–6");
  });

  it("the form carries no use-time label of its own: it reads the profile page's", () => {
    const own = strings(zhTW).join("\n");
    for (const label of Object.values(accountZh.durations)) {
      expect(own).not.toContain(label);
    }
  });

  it("names every pain point and the 1 to 5 control's ends", () => {
    expect(Object.keys(zhTW.pain).sort()).toEqual([...PAIN_POINTS].sort());
    expect(zhTW.satisfactionLow).toBe("1 非常不滿意");
    expect(zhTW.satisfactionHigh).toBe("5 非常滿意");
    expect(zhTW.satisfactionOption(4)).toBe("滿意度 4 分");
    expect(en.satisfactionOption(4)).toBe("Satisfaction 4 out of 5");
  });

  it("the consent text is the frame's: what is kept, what is not, the comment, and withdrawal", () => {
    expect(zhTW.consentLabel).toBe("我同意，送出我的回答");
    for (const part of [
      "手長與掌寬",
      "5 mm 一格",
      "不存確切數字",
      "握法",
      "主要用途",
      "不會保存：照片、姓名、Email",
      "意見欄只有站方看得到，不會公開",
    ]) {
      expect(zhTW.consentKept).toContain(part);
    }
    expect(zhTW.consentWithdraw).toContain(
      "沒有登入時送出的回答，之後無法找回",
    );
    expect(zhTW.consentWithdraw).toContain("無法撤回");
    expect(zhTW.consentWithdraw).toContain("刪除帳號資料時一併撤回");
    // No deletion time is promised (copy-review-2026-10-06, E).
    expect(zhTW.consentKept + zhTW.consentWithdraw).not.toMatch(/天|小時|個月/);
    // The consent text is tied to a version of the contract: say so when it moves.
    expect(SURVEY_CONSENT_VERSION).toBe("survey-consent-v2-draft");
  });

  it("does not say the answers are private, never claims accuracy, and makes no medical claim", () => {
    for (const table of [zhTW, en]) {
      const all = strings(table).join("\n");
      expect(all).not.toMatch(/私密|隱密|保密|private|confidential/i);
      expect(all).not.toMatch(/更準|more accurate|accurate/i);
      for (const line of strings(table)) {
        expect(findMedicalClaimTerm(line), line).toBeNull();
      }
    }
    // The comment is the one thing kept from other visitors, and the sheets say so plainly.
    expect(zhTW.editNote).toContain("彙整成統計");
    expect(zhTW.editNote).toContain("文字意見僅供維護者查看");
  });

  it("states the limits from the contract's constants, never from a number written in the table", () => {
    expect(zhTW.commentCount(3, MAX_FEEDBACK_CHARS)).toBe("3/500");
    expect(zhTW.overCap(MAX_ACCOUNT_MICE)).toContain(String(MAX_ACCOUNT_MICE));
    expect(zhTW.othersHint(4)).toBe("可以各評一次，最多再 4 支。");
    // Nothing in the table fixes a limit that the contract owns.
    const own = strings(zhTW)
      .filter((s) => !s.includes("Sample"))
      .join("\n");
    expect(own).not.toContain("500");
    expect(own).not.toContain("30 支");
  });

  it("the removal confirmation says it cannot be undone and names the mouse", () => {
    expect(zhTW.removeTitle).toBe("移除這支滑鼠的回答？");
    expect(zhTW.removeBody("Logitech G Pro X Superlight 2")).toBe(
      "Logitech G Pro X Superlight 2。移除後無法復原。",
    );
    expect(zhTW.removeConfirm).toBe("移除");
  });

  it("the picker and the other-mouse sheet use the frames' words", () => {
    expect(zhTW.pickerTitle).toBe("選擇滑鼠");
    expect(zhTW.searchPlaceholder).toBe("搜尋品牌或型號");
    expect(zhTW.brandAll).toBe("全部");
    expect(zhTW.notFoundOther).toBe("找不到？選「其他」");
    expect(zhTW.otherTitle).toBe("其他滑鼠");
    expect(zhTW.modelLabel).toBe("型號（選填）");
    expect(zhTW.sizeFeels).toEqual({
      small: "偏小",
      just_right: "剛剛好",
      large: "偏大",
    });
    expect(zhTW.backToList).toBe("改從清單選");
  });
});
