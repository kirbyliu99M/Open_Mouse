import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AccountView,
  type AccountViewProps,
} from "../../src/app/account/AccountView";
import {
  AvatarSheet,
  NicknameSheet,
  type ProfileEditing,
} from "../../src/app/account/ProfileEditSheets";
import type { AnswersState } from "../../src/app/account/profile-model";
import { surveyMineResponseSchema } from "../../src/lib/contracts/survey";
import { en, zhTW } from "../../src/lib/copy/account";
import type { AccountScan } from "../../src/server/account/repo";

/**
 * The profile page 「我的檔案」, rendered to static markup in zh-TW (the default
 * locale; the English table is held to the same keys by i18n-copy-tables). An
 * effect does not run in a static render, so the answers are handed in with
 * `initialAnswers`.
 */

const scan = (
  id: string,
  createdAt: string,
  extra: Partial<AccountScan> = {},
): AccountScan => ({
  scanId: id,
  createdAt,
  hand: "right",
  gripStyleStated: null,
  palmThicknessStated: null,
  measurements: {
    handLengthMm: 186,
    palmLengthMm: 100,
    palmWidthMm: 89,
    thumbLengthMm: null,
    indexLengthMm: null,
    middleLengthMm: null,
    ringLengthMm: null,
    pinkyLengthMm: null,
    palmThicknessMm: null,
    knuckleHeightMm: null,
    gripApertureMm: null,
    thumbAngleDeg: null,
  },
  ...extra,
});

const ready = (body: unknown): AnswersState => ({
  kind: "ready",
  answers: surveyMineResponseSchema.parse(body),
});

const ANSWERED = ready({
  mainUse: "gaming",
  feedback: "手感偏小，側鍵太硬",
  otherMice: [],
  ratings: [
    {
      slug: "razer-deathadder-v3",
      satisfaction: 3,
      duration: "1_to_3_years",
      painPoints: [],
      current: false,
    },
    {
      slug: "logitech-g-pro-x-superlight-2",
      satisfaction: 4,
      duration: "6_to_12_months",
      painPoints: [],
      current: true,
    },
  ],
});

const EMPTY = ready({
  mainUse: null,
  feedback: null,
  otherMice: [],
  ratings: [],
});

const NAMES = {
  "razer-deathadder-v3": "Razer DeathAdder V3",
  "logitech-g-pro-x-superlight-2": "Logitech G Pro X Superlight 2",
};

const ONE_SCAN = [scan("s1", "2026-10-12T02:00:00.000Z")];

function render(props: Partial<AccountViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(AccountView, {
      scans: ONE_SCAN,
      mouseNames: NAMES,
      ...props,
    }),
  );
}

const noop = () => {};

describe("the person block and 基本資料", () => {
  const html = render({
    initialAnswers: EMPTY,
    profile: { name: "阿志", email: "name@gmail.com", image: null },
  });

  it("shows the nickname and the e-mail, and the three basics rows", () => {
    expect(html).toContain('data-testid="account-identity"');
    expect(html).toContain("阿志");
    expect(html).toContain("name@gmail.com");
    expect(html).toContain("<h2");
    for (const label of ["基本資料", "頭像", "暱稱", "電子郵件"])
      expect(html).toContain(label);
  });

  it("falls back to 已登入 with no nickname, and leaves the e-mail row out with none", () => {
    const bare = render({ initialAnswers: EMPTY });
    expect(bare).toContain("已登入");
    expect(bare).not.toContain("電子郵件");
  });
});

describe("我的手", () => {
  it("shows the latest scan's length and width, and nothing for a skipped grip or thickness", () => {
    const html = render({ initialAnswers: EMPTY });
    expect(html).toContain("18.6 cm");
    expect(html).toContain("8.9 cm");
    expect(html).not.toContain("握法");
    expect(html).not.toContain("掌厚");
    expect(html).toContain("10/12 最近一次");
  });

  it("shows the grip and thickness the person stated", () => {
    const html = render({
      initialAnswers: EMPTY,
      scans: [
        scan("s1", "2026-10-12T02:00:00.000Z", {
          gripStyleStated: "claw",
          palmThicknessStated: "medium",
        }),
      ],
    });
    expect(html).toContain("握法");
    expect(html).toContain("抓握");
    expect(html).toContain("掌厚");
  });

  it("offers earlier scans as a closed disclosure, newest scan on top", () => {
    const html = render({
      initialAnswers: EMPTY,
      scans: [
        scan("old", "2026-09-01T02:00:00.000Z", {
          measurements: { ...ONE_SCAN[0].measurements, handLengthMm: 170 },
        }),
        scan("new", "2026-10-12T02:00:00.000Z"),
      ],
    });
    expect(html).toContain("較早的 1 次量測");
    expect(html).toContain('aria-expanded="false"');
    // The latest scan is the one in the rows; the older one is behind the toggle.
    expect(html).toContain("18.6 cm");
    expect(html).not.toContain("17.0 cm");
  });

  it("with no scan, says so and goes to the scan", () => {
    const html = render({ scans: [], initialAnswers: EMPTY });
    expect(html).toContain("還沒有量測");
    expect(html).toContain('href="/scan/easy"');
    expect(html).toContain("掃描我的手");
    expect(html).toContain("量測之後，才能回答問卷。");
    expect(html).not.toContain("較早的");
  });
});

describe("我的滑鼠 and 其他回答", () => {
  it("lists the mice with the current one first, marked, with a half-width slash", () => {
    const html = render({ initialAnswers: ANSWERED });
    expect(html).toContain("2 支");
    expect(html.indexOf("Logitech G Pro X Superlight 2")).toBeLessThan(
      html.indexOf("Razer DeathAdder V3"),
    );
    expect(html).toContain("目前使用");
    expect(html).toContain("滿意 4/5 · 使用 6–12 個月");
    expect(html).toContain("滿意 3/5 · 使用 1–3 年");
    expect(html).not.toContain("／");
    // Only one mouse carries the marker.
    expect(html.match(/profile-current/g)).toHaveLength(1);
  });

  it("shows main use, the comment and the one line about who reads it", () => {
    const html = render({ initialAnswers: ANSWERED });
    expect(html).toContain("其他回答");
    expect(html).toContain("主要用途");
    expect(html).toContain("遊戲");
    expect(html).toContain("手感偏小，側鍵太硬");
    expect(html).toContain("文字意見僅供維護者查看，不會公開。");
  });

  it("makes no row a button, and draws no add row, while no handler is given", () => {
    const html = render({ initialAnswers: ANSWERED });
    expect(html).not.toContain("profile-mouse profile-row-button");
    expect(html).not.toContain("加入另一支滑鼠");
    expect(html).toMatch(/<div class="profile-row profile-mouse">/);
  });

  it("makes each row a tap target and adds the add row once handlers are given", () => {
    const html = render({
      initialAnswers: ANSWERED,
      handlers: {
        onEditMouse: noop,
        onAddMouse: noop,
        onEditOtherAnswer: noop,
      },
    });
    expect(
      html.match(/profile-row profile-row-button profile-mouse/g),
    ).toHaveLength(2);
    expect(html).toContain("加入另一支滑鼠");
  });

  it("names a mouse by its slug when the catalogue has no name for it", () => {
    const html = render({ initialAnswers: ANSWERED, mouseNames: {} });
    expect(html).toContain("razer-deathadder-v3");
  });

  it("draws 其他回答 with 未填 on both rows when there is neither a main use nor a comment", () => {
    const answers = ready({
      mainUse: null,
      feedback: null,
      otherMice: [],
      ratings: [
        {
          slug: "razer-deathadder-v3",
          satisfaction: 5,
          painPoints: [],
          current: true,
        },
      ],
    });
    const html = render({ initialAnswers: answers });
    expect(html).toContain("其他回答");
    expect(html.match(/未填/g)).toHaveLength(2);
    expect(html.match(/profile-row-empty/g)).toHaveLength(2);
    expect(html).toContain("滿意 5/5");
    expect(html).not.toContain("使用 ");
    // Plain text while no handler is given; a tap target once one is.
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*主要用途/s);
    const wired = render({
      initialAnswers: answers,
      handlers: { onEditOtherAnswer: noop },
    });
    expect(wired).toMatch(/<button[^>]*>(?:(?!<\/button>).)*主要用途/s);
    expect(wired).toMatch(/<button[^>]*>(?:(?!<\/button>).)*意見/s);
  });

  it("shows the empty state with a scan; its button appears only with a handler", () => {
    const without = render({ initialAnswers: EMPTY });
    expect(without).toContain("還沒有回答問卷");
    expect(without).not.toContain("profile-primary");
    const withHandler = render({
      initialAnswers: EMPTY,
      handlers: { onOpenQuestionnaire: noop },
    });
    expect(withHandler).toContain("profile-primary");
    expect(withHandler).toContain(">我的滑鼠</button>");
  });

  it("says it is loading, and offers a retry on an error", () => {
    expect(render()).toContain("正在載入你的回答…");
    const failed = render({ initialAnswers: { kind: "error" } });
    expect(failed).toContain("無法載入你的回答");
    expect(failed).toContain("重試");
  });
});

describe("資料 and the rest", () => {
  const html = render({
    initialAnswers: EMPTY,
    signOut: createElement("button", { type: "submit" }, "登出"),
  });

  it("keeps export and the unchanged delete wording, and puts sign out last", () => {
    expect(html).toContain("匯出我的資料");
    expect(html).toContain("刪除所有資料");
    expect(html.lastIndexOf("登出")).toBeGreaterThan(
      html.indexOf("刪除所有資料"),
    );
  });

  it("uses a real heading for every section", () => {
    const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map(
      (m) => m[1],
    );
    expect(headings).toEqual(["基本資料", "我的手", "我的滑鼠", "資料"]);
  });

  it("makes no medical claim and does not mention a thickness adjustment", () => {
    const answered = render({ initialAnswers: ANSWERED });
    for (const text of [html, answered]) {
      expect(text).not.toMatch(/更準|健康|疼痛|治療|調整/);
    }
  });
});

describe("the nickname and avatar sheets (not wired)", () => {
  const wired: ProfileEditing = {
    saveNickname: async (name) => ({ name }),
    saveAvatar: async () => ({ image: null }),
    resetAvatar: async () => ({ image: null }),
  };

  it("the nickname sheet says it cannot save yet, keeps Save off, and counts characters", () => {
    const html = renderToStaticMarkup(
      createElement(NicknameSheet, {
        saved: "阿志",
        onClose: noop,
        onSaved: noop,
      }),
    );
    expect(html).toContain("這項修改還不能儲存。");
    expect(html).toContain("2/20");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>儲存<\/button>/);
    expect(html).toContain('aria-label="清除暱稱"');
  });

  it("with saving wired, there is no 'cannot save' line, and Save is off until the name changes", () => {
    const html = renderToStaticMarkup(
      createElement(NicknameSheet, {
        saved: "阿志",
        editing: wired,
        onClose: noop,
        onSaved: noop,
      }),
    );
    expect(html).not.toContain("這項修改還不能儲存。");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>儲存<\/button>/);
  });

  it("the avatar sheet offers choosing a photo and going back to the Google picture", () => {
    const html = renderToStaticMarkup(
      createElement(AvatarSheet, {
        image: null,
        onClose: noop,
        onSaved: noop,
      }),
    );
    expect(html).toContain("選擇照片");
    expect(html).toContain("改回 Google 頭像");
    expect(html).toContain("會裁成正方形，並以圓形顯示。");
    expect(html).toContain("這項修改還不能儲存。");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>儲存<\/button>/);
  });
});

describe("the signed-out page's words", () => {
  it("keeps main's sign-in fine print, word for word, and the 'cannot be taken back' line", () => {
    expect(zhTW.finePrint).toBe(
      "我們會保存你的電子郵件地址和掃描紀錄，絕不會保存你的照片。登入時，你目前的掃描會併入你的帳號。",
    );
    expect(en.finePrint).toBe(
      "We keep your email address and your scans — never your photo. Your current scan joins your account when you sign in.",
    );
    expect(zhTW.answerWithoutAccountNote).toContain("無法撤回");
  });
});
