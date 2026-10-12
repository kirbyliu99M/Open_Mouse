import { describe, expect, it } from "vitest";
import {
  AVATAR_SIZE_PX,
  outputSide,
  squareCrop,
} from "../../src/app/account/avatar-crop";
import {
  NICKNAME_MAX,
  brandName,
  canSaveNickname,
  formatCm,
  formatMonthDay,
  handRows,
  hasAnswers,
  mouseDisplayName,
  mouseNamesFromRows,
  mouseRows,
  nicknameLength,
  otherAnswerRows,
  ratingMeta,
  splitScans,
} from "../../src/app/account/profile-model";
import {
  OTHER_MOUSE_BRANDS,
  surveyMineResponseSchema,
  type SurveyMineResponse,
} from "../../src/lib/contracts/survey";
import { en, zhTW } from "../../src/lib/copy/account";
import type { AccountScan } from "../../src/server/account/repo";

const NBSP = String.fromCharCode(0xa0);

function scan(
  id: string,
  createdAt: string,
  extra: Partial<AccountScan> = {},
): AccountScan {
  return {
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
  };
}

const answers = (over: Partial<SurveyMineResponse> = {}): SurveyMineResponse =>
  surveyMineResponseSchema.parse({
    mainUse: null,
    ratings: [],
    otherMice: [],
    feedback: null,
    ...over,
  });

describe("formatCm", () => {
  it("shows centimetres with one decimal and a no-break space", () => {
    expect(formatCm(186)).toBe(`18.6${NBSP}cm`);
    expect(formatCm(89)).toBe(`8.9${NBSP}cm`);
    expect(formatCm(190)).toBe(`19.0${NBSP}cm`);
  });
  it("rounds a fractional millimetre value first", () => {
    expect(formatCm(186.4)).toBe(`18.6${NBSP}cm`);
    expect(formatCm(186.6)).toBe(`18.7${NBSP}cm`);
  });
  it("never joins the number and its unit with a plain space", () => {
    expect(formatCm(186)).not.toMatch(/\d cm/);
  });
});

describe("formatMonthDay", () => {
  it("is the month and day in Taiwan time, not the viewer's", () => {
    // 17:00 UTC on the 11th is 01:00 on the 12th in Taipei.
    expect(formatMonthDay("2026-10-11T17:00:00.000Z", "zh-TW")).toBe("10/12");
    expect(formatMonthDay("2026-10-11T15:59:00.000Z", "zh-TW")).toBe("10/11");
  });
  it("writes the month as a word in English", () => {
    expect(formatMonthDay("2026-10-11T17:00:00.000Z", "en")).toBe("Oct 12");
  });
  it("is empty for a date it cannot read", () => {
    expect(formatMonthDay("not a date", "zh-TW")).toBe("");
  });
});

describe("splitScans", () => {
  it("takes the newest as the latest, whatever order it is given in", () => {
    const a = scan("a", "2026-10-01T00:00:00.000Z");
    const b = scan("b", "2026-10-12T00:00:00.000Z");
    const c = scan("c", "2026-10-05T00:00:00.000Z");
    const { latest, earlier } = splitScans([a, b, c]);
    expect(latest?.scanId).toBe("b");
    expect(earlier.map((s) => s.scanId)).toEqual(["c", "a"]);
  });
  it("has no latest scan for none", () => {
    expect(splitScans([])).toEqual({ latest: null, earlier: [] });
  });
});

describe("handRows", () => {
  it("shows length and width only when grip and thickness were skipped", () => {
    const rows = handRows(scan("a", "2026-10-12T00:00:00.000Z"), zhTW);
    expect(rows.map((r) => r.key)).toEqual(["handLength", "palmWidth"]);
    expect(rows.map((r) => r.value)).toEqual([`18.6${NBSP}cm`, `8.9${NBSP}cm`]);
  });
  it("adds the grip and the palm thickness the person stated", () => {
    const rows = handRows(
      scan("a", "2026-10-12T00:00:00.000Z", {
        gripStyleStated: "claw",
        palmThicknessStated: "medium",
      }),
      zhTW,
    );
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["手長", `18.6${NBSP}cm`],
      ["掌寬", `8.9${NBSP}cm`],
      ["握法", "抓握"],
      ["掌厚", "中"],
    ]);
  });
  it("shows a stated thickness without a stated grip, and the reverse", () => {
    const onlyThickness = handRows(
      scan("a", "2026-10-12T00:00:00.000Z", { palmThicknessStated: "thin" }),
      en,
    );
    expect(onlyThickness.map((r) => r.key)).toEqual([
      "handLength",
      "palmWidth",
      "thickness",
    ]);
    const onlyGrip = handRows(
      scan("a", "2026-10-12T00:00:00.000Z", { gripStyleStated: "palm" }),
      en,
    );
    expect(onlyGrip.map((r) => r.key)).toEqual([
      "handLength",
      "palmWidth",
      "grip",
    ]);
  });
});

describe("mouseDisplayName", () => {
  it("joins brand and model", () => {
    expect(mouseDisplayName("Razer", "DeathAdder V3")).toBe(
      "Razer DeathAdder V3",
    );
  });
  it("does not say the brand twice", () => {
    expect(mouseDisplayName("Logitech", "Logitech G Pro")).toBe(
      "Logitech G Pro",
    );
    expect(mouseDisplayName("logitech", "Logitech MX Master 3S")).toBe(
      "Logitech MX Master 3S",
    );
  });
  it("copes with a blank side", () => {
    expect(mouseDisplayName("", "X")).toBe("X");
    expect(mouseDisplayName("Razer", " ")).toBe("Razer");
  });
});

describe("mouseNamesFromRows", () => {
  it("maps each slug to its display name", () => {
    expect(
      mouseNamesFromRows([
        { slug: "a", brand: "Razer", model: "DeathAdder V3" },
        { slug: "b", brand: "Logitech", model: "Logitech G Pro" },
      ]),
    ).toEqual({ a: "Razer DeathAdder V3", b: "Logitech G Pro" });
  });
  it("is empty for no rows", () => {
    expect(mouseNamesFromRows([])).toEqual({});
  });
});

describe("ratingMeta", () => {
  it("writes the rating with a half-width slash and the duration", () => {
    expect(ratingMeta(4, "6_to_12_months", zhTW)).toBe(
      "滿意 4/5 · 使用 6–12 個月",
    );
    expect(ratingMeta(5, "1_to_6_months", zhTW)).toBe(
      "滿意 5/5 · 使用 1 個月至小於 6 個月",
    );
  });
  it("leaves the duration out when the person gave none", () => {
    expect(ratingMeta(3, undefined, zhTW)).toBe("滿意 3/5");
    expect(ratingMeta(3, undefined, en)).toBe("Satisfaction 3/5");
  });
  it("never uses a full-width slash", () => {
    for (const copy of [zhTW, en]) {
      expect(ratingMeta(2, "over_3_years", copy)).not.toContain("／");
    }
  });
});

describe("mouseRows", () => {
  const names = {
    "logitech-g-pro-x-superlight-2": "Logitech G Pro X Superlight 2",
    "razer-deathadder-v3": "Razer DeathAdder V3",
  };

  it("puts the current mouse first and keeps the rest in the given order", () => {
    const rows = mouseRows(
      answers({
        ratings: [
          {
            slug: "razer-deathadder-v3",
            satisfaction: 3,
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
      }),
      names,
      zhTW,
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Logitech G Pro X Superlight 2",
      "Razer DeathAdder V3",
    ]);
    expect(rows[0]).toMatchObject({
      current: true,
      meta: "滿意 4/5 · 使用 6–12 個月",
      target: { kind: "rating", slug: "logitech-g-pro-x-superlight-2" },
    });
    expect(rows[1].current).toBe(false);
  });

  it("falls back to the slug when the catalogue has no name for it", () => {
    const rows = mouseRows(
      answers({
        ratings: [
          {
            slug: "gone-mouse",
            satisfaction: 2,
            painPoints: [],
            current: false,
          },
        ],
      }),
      names,
      zhTW,
    );
    expect(rows[0].name).toBe("gone-mouse");
  });

  it("lists a brand-only answer after the rated mice, with its size feel", () => {
    const rows = mouseRows(
      answers({
        ratings: [
          {
            slug: "razer-deathadder-v3",
            satisfaction: 3,
            painPoints: [],
            current: false,
          },
        ],
        otherMice: [{ brand: "logitech", sizeFeel: "small", current: false }],
      }),
      names,
      zhTW,
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Razer DeathAdder V3",
      "Logitech（其他型號）",
    ]);
    expect(rows[1]).toMatchObject({
      meta: "大小 偏小",
      target: { kind: "other", brand: "logitech" },
    });
  });

  it("moves a current brand-only answer to the top", () => {
    const rows = mouseRows(
      answers({
        ratings: [
          {
            slug: "razer-deathadder-v3",
            satisfaction: 3,
            painPoints: [],
            current: false,
          },
        ],
        otherMice: [{ brand: "apple", sizeFeel: "just_right", current: true }],
      }),
      names,
      en,
    );
    expect(rows[0].name).toBe("Apple (another model)");
    expect(rows[0].current).toBe(true);
  });

  it("is empty for no answers", () => {
    expect(mouseRows(answers(), names, zhTW)).toEqual([]);
  });
});

describe("brandName", () => {
  it("names every brand the form offers, and `other` is the generic words", () => {
    for (const slug of OTHER_MOUSE_BRANDS) {
      const name = brandName(slug, zhTW);
      expect(name).not.toBe("");
      if (slug === "other") expect(name).toBe(zhTW.otherBrand);
      else expect(name).not.toBe(zhTW.otherBrand);
    }
  });
  it("treats an unknown slug as the generic words", () => {
    expect(brandName("no-such-brand", en)).toBe(en.otherBrand);
  });
});

describe("otherAnswerRows and hasAnswers", () => {
  it("lists main use and the comment on one line", () => {
    const rows = otherAnswerRows(
      answers({ mainUse: "gaming", feedback: "手感偏小，\n側鍵  太硬" }),
      zhTW,
    );
    expect(rows).toEqual([
      { key: "mainUse", label: "主要用途", value: "遊戲" },
      { key: "feedback", label: "意見", value: "手感偏小， 側鍵 太硬" },
    ]);
  });
  it("always lists both rows; one with no answer reads 未填 and is marked empty", () => {
    const none = otherAnswerRows(answers(), zhTW);
    expect(none).toEqual([
      { key: "mainUse", label: "主要用途", value: "未填", empty: true },
      { key: "feedback", label: "意見", value: "未填", empty: true },
    ]);
    // A comment of blanks is no comment.
    expect(
      otherAnswerRows(answers({ feedback: "  " }), zhTW).map((r) => r.empty),
    ).toEqual([true, true]);
    const onlyUse = otherAnswerRows(answers({ mainUse: "office" }), zhTW);
    expect(onlyUse[0]).toEqual({
      key: "mainUse",
      label: "主要用途",
      value: "辦公",
    });
    expect(onlyUse[1]?.empty).toBe(true);
    expect(otherAnswerRows(answers(), en)[0]?.value).toBe("Not filled in");
  });
  it("hasAnswers is false only for nothing at all", () => {
    expect(hasAnswers(answers())).toBe(false);
    expect(hasAnswers(answers({ mainUse: "office" }))).toBe(true);
    expect(hasAnswers(answers({ feedback: "ok" }))).toBe(true);
    expect(
      hasAnswers(
        answers({
          otherMice: [{ brand: "dell", sizeFeel: "large", current: false }],
        }),
      ),
    ).toBe(true);
  });
});

describe("nickname rules", () => {
  it("counts a character as a person does", () => {
    expect(nicknameLength("阿志")).toBe(2);
    expect(nicknameLength("  Ada  ")).toBe(3);
    // One emoji is one character, not two UTF-16 units.
    expect(nicknameLength("🐭")).toBe(1);
  });
  it("allows Save for a new name within the limit only", () => {
    expect(canSaveNickname("小明", "阿志")).toBe(true);
    expect(canSaveNickname("阿志", "阿志")).toBe(false);
    expect(canSaveNickname(" 阿志 ", "阿志")).toBe(false);
    expect(canSaveNickname("   ", "阿志")).toBe(false);
    expect(canSaveNickname("a".repeat(NICKNAME_MAX), "x")).toBe(true);
    expect(canSaveNickname("a".repeat(NICKNAME_MAX + 1), "x")).toBe(false);
  });
});

describe("avatar crop", () => {
  it("crops the centre of a landscape and of a portrait picture", () => {
    expect(squareCrop(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
    expect(squareCrop(300, 400)).toEqual({ sx: 0, sy: 50, side: 300 });
    expect(squareCrop(300, 300)).toEqual({ sx: 0, sy: 0, side: 300 });
  });
  it("is empty for an empty picture", () => {
    expect(squareCrop(0, 10).side).toBe(0);
  });
  it("shrinks to the target and never enlarges", () => {
    expect(outputSide(3000)).toBe(AVATAR_SIZE_PX);
    expect(outputSide(100)).toBe(100);
    expect(outputSide(0)).toBe(1);
  });
});
