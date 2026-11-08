import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as legal from "../../src/lib/copy/legal";

/**
 * The privacy notice and the terms (pre-launch audit 2026-10-28, Kirby OK
 * the same day): every blank filled, the contact the tester letter uses,
 * and the footer's "Privacy" on its own page.
 */
describe("the privacy notice and the terms", () => {
  const all = (copy: legal.LegalCopy) => JSON.stringify(copy) as string;

  it("has no blanks left, and names the contact in both languages", () => {
    for (const copy of [legal.zhTW, legal.en]) {
      expect(all(copy)).not.toMatch(
        /【|\[(operator|region|contact email|launch date)\]/,
      );
      expect(all(copy)).toContain("palmate.tw@gmail.com");
    }
    expect(legal.zhTW.privacySections.length).toBe(
      legal.en.privacySections.length,
    );
    expect(legal.zhTW.termsSections.length).toBe(legal.en.termsSections.length);
  });

  it("is policy v2.1: sections 一–十二 in both languages", () => {
    // docs/design/touchpoint-2026-11-08/privacy-policy-v2-draft.md
    expect(legal.zhTW.privacySections).toHaveLength(12);
    expect(legal.en.privacySections).toHaveLength(12);
    expect(legal.zhTW.privacySections[0]!.heading).toBe("一、重點摘要");
    expect(legal.zhTW.privacySections[11]!.heading).toBe("十二、聯絡我們");
    // The page keys paragraphs by their text: none repeats in a section.
    for (const copy of [legal.zhTW, legal.en])
      for (const s of copy.privacySections)
        expect(new Set(s.paragraphs).size).toBe(s.paragraphs.length);
    // No draft blank went live.
    for (const copy of [legal.zhTW, legal.en])
      expect(all(copy)).not.toMatch(/待 Kirby|〔|＿/);
  });

  it("says when a photo is uploaded, what is kept for how long, and how each copy is deleted", () => {
    const zh = all(legal.zhTW);
    const en = all(legal.en);
    // Photos: on the device by default; uploaded only by the person's choice.
    expect(zh).toContain("照片預設不離開你的裝置");
    expect(zh).toContain(
      "自己按下「傳送這張照片，幫我們修正」並勾選同意，照片才會上傳",
    );
    expect(zh).toContain("上傳後約 6 個月（180 天）自動刪除");
    expect(zh).toContain("「刪除我傳送的照片」");
    expect(en).toContain("By default your photo does not leave your device");
    expect(en).toContain("about 6 months (180 days) after upload");
    // Scans: 24 hours without an account, otherwise until the account goes.
    expect(zh).toContain("建立後 24 小時內刪除");
    expect(zh).toContain("登入時保存在你的帳號，直到你刪除帳號");
    // No 90-day claim: only true if RETENTION_PURGE_MODE=delete (unconfirmed).
    expect(zh).not.toContain("90 天");
    expect(en).not.toMatch(/90 days/);
    // The unnamed copy: kept by default, deleted with the person's own delete.
    expect(zh).toContain(
      "「保留一份不記名的數值副本」開關，預設開啟，可以關掉",
    );
    expect(zh).toContain(
      "你刪除某次掃描或整個帳號時，我們會一併刪除數值相符的副本",
    );
    expect(en).toContain("we also delete the copy whose values match");
    // PR #228 review: signed-in survey answers ARE linked to the account.
    expect(zh).toContain("登入時送出的資料跟著帳號刪除");
    expect(zh).not.toContain("問卷內容不會連回你的帳號");
    expect(en).not.toContain("not linked back to your account");
    // Statutory reply periods and the publication thresholds.
    expect(zh).toContain("15 天內回覆");
    expect(zh).toContain("30 天內回覆");
    expect(zh).toContain("至少要有 5 人");
    expect(zh).toContain("少於 10 人的分組都不公開");
    // Gemini: the numbers, the grip and the picks; never the photo.
    expect(zh).toContain("只收到測量數值、握法和推薦結果");
    expect(zh).toContain("不會收到照片、姓名或帳號");
  });

  it("the footer and how-it-works link to /privacy, and /privacy to /terms", () => {
    // Both localize the link (`/en/privacy` on an English page).
    expect(readFileSync("src/components/SiteFooter.tsx", "utf8")).toContain(
      '<Link href={localizedPath("/privacy", locale)}>',
    );
    expect(readFileSync("src/app/how-it-works/page.tsx", "utf8")).toContain(
      '<Link href={localizedPath("/privacy", locale)}>',
    );
    expect(readFileSync("src/app/privacy/page.tsx", "utf8")).toContain(
      'href: "/terms"',
    );
  });
});
