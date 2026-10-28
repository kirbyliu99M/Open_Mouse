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

  it("says the photo is not collected, and what is kept for how long", () => {
    const zh = all(legal.zhTW);
    expect(zh).toContain("照片只在你的手機上分析，不會上傳");
    expect(zh).toContain("建立後 24 小時內刪除");
    expect(zh).toContain("90 天未使用");
    // PR #228 review: signed-in survey answers ARE linked to the account.
    expect(zh).toContain("登入時送出的會連到你的帳號");
    expect(zh).not.toContain("問卷內容不會連回你的帳號");
    expect(all(legal.en)).not.toContain("not linked back to your account");
  });

  it("the footer and how-it-works link to /privacy, and /privacy to /terms", () => {
    expect(readFileSync("src/components/SiteFooter.tsx", "utf8")).toContain(
      '<Link href="/privacy">',
    );
    expect(readFileSync("src/app/how-it-works/page.tsx", "utf8")).toContain(
      '<Link href="/privacy">',
    );
    expect(readFileSync("src/app/privacy/page.tsx", "utf8")).toContain(
      'href: "/terms"',
    );
  });
});
