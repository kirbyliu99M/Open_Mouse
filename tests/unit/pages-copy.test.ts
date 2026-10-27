import { describe, expect, it } from "vitest";
import { localeFromBrowser } from "../../src/components/errors/browser-locale";
import {
  PHOTO_PRIVACY_COPY,
  PHOTO_PRIVACY_COPY_THIS_DEVICE,
} from "../../src/components/privacy-copy";
import { GESTURE_CODES, GESTURES } from "../../src/lib/learning/kit";
import * as account from "../../src/lib/copy/account";
import * as errors from "../../src/lib/copy/errors";
import * as home from "../../src/lib/copy/home";
import * as how from "../../src/lib/copy/how-it-works";
import * as learn from "../../src/lib/copy/learn";
import * as privacy from "../../src/lib/copy/privacy";
import * as sheet from "../../src/lib/copy/sheet";

const CJK = /[一-鿿]/;
// A few characters that exist only in Simplified Chinese.
const SIMPLIFIED = /[们这个说为样问题网页]|[设计开关]/;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(strings);
  }
  return [];
}

describe("the content pages' copy tables", () => {
  const modules = { account, errors, home, how, learn, privacy, sheet };
  for (const [name, mod] of Object.entries(modules)) {
    it(`${name}: zhTW has real Chinese and no Simplified-only characters`, () => {
      const zh = strings(mod.zhTW);
      expect(zh.some((s) => CJK.test(s))).toBe(true);
      for (const s of zh) expect(s).not.toMatch(SIMPLIFIED);
    });
  }

  it("the Simplified check does catch a Simplified string (negative control)", () => {
    expect("这个页面").toMatch(SIMPLIFIED);
  });
});

describe("English stays what it was", () => {
  it("the privacy constants are the sentences the scan screens pin", () => {
    expect(PHOTO_PRIVACY_COPY).toBe(
      "Your photo never leaves your phone. Only measurements are sent.",
    );
    expect(PHOTO_PRIVACY_COPY_THIS_DEVICE).toBe(
      "Your photo never leaves this device. Only measurements are sent.",
    );
  });

  it("every English gesture is the kit's own, word for word", () => {
    for (const g of GESTURES) {
      expect(learn.en.gestures[g.code]).toEqual({
        name: g.name,
        steps: g.steps,
        yields: g.yields,
      });
    }
  });

  it("the number sentences read as before", () => {
    // Every brand since the multi-brand catalogue (pre-launch audit 2026-10-28).
    expect(how.en.step3Body(12)).toBe(
      "12 mice ranked by how they fit your hand.",
    );
    expect(how.zhTW.step3Body(null)).toBe("依合手度為收錄的滑鼠排序。");
    expect(learn.en.printPages(1)).toBe("Print 1 page");
    expect(learn.en.printPages(3)).toBe("Print 3 pages");
    expect(account.en.deleteBody(0)).toBe(
      "This permanently deletes your account, including the email address and name from Google, and signs you out. This can't be undone.",
    );
    expect(account.en.deleteBody(4)).toContain("all 4 of your scans and ");
  });
});

describe("learning kit copy", () => {
  it("has a zh-TW entry for every gesture, with as many steps as English", () => {
    for (const code of GESTURE_CODES) {
      expect(learn.zhTW.gestures[code].steps).toHaveLength(
        learn.en.gestures[code].steps.length,
      );
      expect(learn.zhTW.gestures[code].name).toMatch(CJK);
    }
  });

  it("translates the sheet's drawn words in zh-TW and leaves them alone in English", () => {
    expect(learn.layoutText("zh-TW", "participant card")).toBe("受測者卡片");
    expect(learn.layoutText("en", "participant card")).toBe("participant card");
  });

  it("leaves a word it does not know as it is (so nothing drawn goes missing)", () => {
    expect(learn.layoutText("zh-TW", "OPEN MOUSE · LEARN")).toBe(
      "OPEN MOUSE · LEARN",
    );
  });
});

describe("localeFromBrowser (global-error.tsx has no server locale)", () => {
  it("prefers the cookie", () => {
    expect(localeFromBrowser("a=1; om_locale=en", ["zh-TW"])).toBe("en");
    expect(localeFromBrowser("om_locale=zh-TW", ["en-US"])).toBe("zh-TW");
  });

  it("falls back to the browser's languages, then to the default", () => {
    expect(localeFromBrowser("", ["ja", "en-US"])).toBe("en");
    expect(localeFromBrowser("", ["zh-Hant-TW"])).toBe("zh-TW");
    expect(localeFromBrowser("", ["ja"])).toBe("zh-TW");
    expect(localeFromBrowser("", [])).toBe("zh-TW");
  });

  it("ignores a cookie that is not a locale (negative control)", () => {
    expect(localeFromBrowser("om_locale=fr", ["en-US"])).toBe("en");
  });
});
