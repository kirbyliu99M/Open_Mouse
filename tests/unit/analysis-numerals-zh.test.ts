import { describe, expect, it } from "vitest";
import { analyse } from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { NON_QUANTITY_COMPOUNDS } from "../../src/server/analysis/chinese-numerals";
import {
  extractChineseNumerals,
  findUnknownNumeral,
} from "../../src/server/analysis/numerals";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

/**
 * Hard rule 2 (AGENTS.md): every number in the model's output must already be
 * in its input. The checker only knew Arabic digits and English number words,
 * so a Chinese answer could say 五, 十二, 一百二十, 半, 百分之三十 or 三分之一
 * and never be checked. These tests pin the Chinese side, in Traditional and
 * Simplified, and the lexicon of ordinary words that contain a numeral
 * character without being a quantity.
 *
 * The rule of thumb is the one the English side uses: a false alarm costs one
 * retry; a miss puts an invented number in front of the user. So a numeral
 * character is a number unless it sits in a listed non-quantity compound, and
 * an unlisted compound is flagged.
 */
const unknown = (text: string, allowed: readonly number[] = []) =>
  findUnknownNumeral(text, new Set(allowed));

describe("full-width digits (already handled; pinned here because the brief doubted it)", () => {
  it("rejects a full-width number that is not in the input", () => {
    expect(unknown("長度為１２３毫米")).toBe(123);
    expect(unknown("長度為１２３毫米", [123])).toBeNull();
  });

  it("reads a full-width decimal point", () => {
    expect(unknown("寬度為６３．５毫米")).toBe(63.5);
    expect(unknown("寬度為６３．５毫米", [63.5])).toBeNull();
  });

  it("reads a full-width percent sign as a percentage", () => {
    expect(unknown("信心約３０％", [0.3])).toBeNull();
    expect(unknown("信心約３０％")).toBe(30);
  });

  it("reads a full-width digit followed by a Chinese unit", () => {
    expect(unknown("約１２萬", [12])).toBe(120000);
    expect(unknown("約１２萬", [12, 120000])).toBeNull();
  });
});

describe("Chinese cardinals are checked like digits", () => {
  const cases: readonly (readonly [text: string, value: number])[] = [
    ["差距約五毫米", 5],
    ["差距约五毫米", 5],
    ["約十二毫米", 12],
    ["二十五", 25],
    ["兩個握法", 2],
    ["两个握法", 2],
    ["一百二十毫米", 120],
    ["一百二", 120], // colloquial: the last digit is tens
    ["一百零五", 105],
    ["一百二十五", 125],
    ["二百五十", 250],
    ["兩千", 2000],
    ["两千", 2000],
    ["一千零一", 1001],
    ["三萬五千", 35000],
    ["三万五千", 35000],
    ["三萬五", 35000],
    ["十二萬五千", 125000],
    ["一億二千萬", 120000000],
    ["一亿二千万", 120000000],
    ["廿五", 25],
    ["卅", 30],
    ["零", 0],
    ["十", 10],
    ["百", 100],
    ["千", 1000],
    ["萬", 10000],
    ["億", 100000000],
    ["二〇", 20], // a zero makes it one positional number, not "2 or 0"
    ["五〇", 50],
    ["〇五", 5],
    ["二〇二四", 2024], // positional digits
    ["一二五", 125],
  ];

  it.each(cases)("rejects %s when %s is not in the input", (text, value) => {
    expect(unknown(`長度${text}`)).toBe(value);
  });

  it.each(cases)("accepts %s when its value is in the input", (text, value) => {
    expect(unknown(`長度${text}`, [value])).toBeNull();
  });
});

describe("financial numerals (only as a run of two or more, so 大陸 / 參考 / 隊伍 stay ordinary words)", () => {
  it("reads a financial run", () => {
    expect(unknown("壹佰貳拾伍")).toBe(125);
    expect(unknown("壹佰貳拾伍", [125])).toBeNull();
    expect(unknown("貳拾")).toBe(20);
    expect(unknown("贰拾")).toBe(20);
    expect(unknown("拾伍")).toBe(15);
  });

  it.each(["大陸", "大陆", "參考", "参考", "隊伍", "队伍", "拾起", "肆意"])(
    "does not read %s as a number",
    (word) => {
      expect(unknown(word)).toBeNull();
    },
  );
});

describe("decimals", () => {
  it.each([
    ["三點五毫米", 3.5],
    ["三点五毫米", 3.5],
    ["零點九", 0.9],
    ["十二點五", 12.5],
    ["三點一四", 3.14],
    ["一點五倍", 1.5],
  ] as const)("%s is %s", (text, value) => {
    expect(unknown(text)).toBe(value);
    expect(unknown(text, [value])).toBeNull();
  });
});

describe("a decimal written half in Arabic digits and half in Chinese", () => {
  it.each(["3點5", "3点5", "3點五", "三點5", "三点5"])(
    "%s is 3.5, even though 3 and 5 are each in the input",
    (text) => {
      expect(unknown(`寬${text}毫米`, [3, 5])).toBe(3.5);
      expect(unknown(`寬${text}毫米`, [3, 5, 3.5])).toBeNull();
    },
  );

  it("a fully Arabic decimal is untouched", () => {
    expect(unknown("寬3.5毫米", [3.5])).toBeNull();
  });
});

describe("half", () => {
  it("reads 半 as 0.5", () => {
    expect(unknown("半個手掌寬")).toBe(0.5);
    expect(unknown("半个手掌宽", [0.5])).toBeNull();
  });

  it("reads 一半 as 0.5 only, not as 1 and 0.5", () => {
    expect(unknown("一半")).toBe(0.5);
    expect(unknown("一半", [0.5])).toBeNull();
  });

  it("checks the whole count in 三個半 (3 and a half)", () => {
    expect(unknown("三個半小時")).toBe(3);
    expect(unknown("三個半小時", [3])).toBe(0.5);
    expect(unknown("三個半小時", [3, 0.5])).toBeNull();
  });
});

describe("double", () => {
  it("reads 雙 / 双 as 2, like 'double' in English", () => {
    expect(unknown("雙擊")).toBe(2);
    expect(unknown("双击")).toBe(2);
    expect(unknown("双击", [2])).toBeNull();
  });

  it("reads 加倍 / 翻倍 ('double it') as 2 as well", () => {
    expect(unknown("重量加倍")).toBe(2);
    expect(unknown("重量翻倍")).toBe(2);
    expect(unknown("重量翻倍", [2])).toBeNull();
    // 倍 after a number is that number, not a second token.
    expect(unknown("三倍", [3])).toBeNull();
  });
});

describe("percentages", () => {
  it("百分之三十 is 30 percent: accepted as 30 or as 0.3, rejected otherwise", () => {
    expect(unknown("約百分之三十")).toBe(30);
    expect(unknown("約百分之三十", [30])).toBeNull();
    expect(unknown("約百分之三十", [0.3])).toBeNull();
    expect(unknown("約百分之三十", [0.31])).toBe(30);
  });

  it("百分之百 is 100 percent", () => {
    expect(unknown("百分之百")).toBe(100);
    expect(unknown("百分之百", [1])).toBeNull();
  });

  it("百分之三十五點五", () => {
    expect(unknown("百分之三十五點五", [0.355])).toBeNull();
    expect(unknown("百分之三十五點五")).toBe(35.5);
  });

  it("百分之 in front of Arabic digits is a percentage too", () => {
    expect(unknown("百分之30", [0.3])).toBeNull();
    expect(unknown("百分之30")).toBe(30);
  });

  it("a Chinese number followed by a percent sign, 百分點 or 趴", () => {
    expect(unknown("三十%", [0.3])).toBeNull();
    expect(unknown("三十個百分點", [0.3])).toBeNull();
    expect(unknown("三十个百分点", [0.3])).toBeNull();
    expect(unknown("三十趴", [0.3])).toBeNull();
    expect(unknown("三十趴")).toBe(30);
  });

  it("the same markers after Arabic digits: 30個百分點, 30个百分点, 30趴", () => {
    expect(unknown("約30個百分點", [0.3])).toBeNull();
    expect(unknown("約30个百分点", [0.3])).toBeNull();
    expect(unknown("約30趴", [0.3])).toBeNull();
    expect(unknown("約30趴")).toBe(30);
  });

  it("a bare number is never rescued by a percent equivalence", () => {
    expect(unknown("三十", [0.3])).toBe(30);
  });

  it("七成 is 70 percent (成 = tenths)", () => {
    expect(unknown("有七成把握")).toBe(70);
    expect(unknown("有七成把握", [0.7])).toBeNull();
    expect(unknown("有七成把握", [70])).toBeNull();
    expect(unknown("十成", [1])).toBeNull();
  });

  it("一成 is 10 percent", () => {
    expect(unknown("有一成把握")).toBe(10);
    expect(unknown("有一成把握", [0.1])).toBeNull();
  });

  it("成 that is not a count of tenths is left alone", () => {
    expect(unknown("完成")).toBeNull();
    expect(unknown("成為")).toBeNull();
    expect(unknown("組成")).toBeNull();
    expect(unknown("一成不變")).toBeNull();
    expect(unknown("一成不变")).toBeNull();
  });
});

describe("fractions", () => {
  it("三分之一 is 1/3", () => {
    expect(unknown("三分之一")).toBeCloseTo(1 / 3, 9);
    expect(unknown("三分之一", [1, 3])).toBeCloseTo(1 / 3, 9);
    expect(unknown("三分之一", [1, 3, 1 / 3])).toBeNull();
  });

  it("十分之三 is 0.3 (and is not 十分 'very' followed by 之三)", () => {
    expect(unknown("十分之三", [3, 10, 0.3])).toBeNull();
    expect(unknown("十分之三", [3, 10])).toBe(0.3);
  });

  it("二分之一 and 四分之三 (Simplified too)", () => {
    expect(unknown("二分之一", [0.5, 1, 2])).toBeNull();
    expect(unknown("四分之三", [0.75, 3, 4])).toBeNull();
    // Only the fraction is checked, as with English "two thirds": the 3 and
    // the 4 on their own are not separate claims.
    expect(unknown("四分之三")).toBeCloseTo(0.75, 9);
    expect(unknown("四分之三", [3, 4])).toBeCloseTo(0.75, 9);
  });

  it("only reads 分之 as a fraction when the numerator follows it directly", () => {
    // 3 and 5 are each in the input; nothing here says 5/3.
    expect(unknown("三分之後有五個", [3, 5])).toBeNull();
  });

  it("Arabic digits around 分之", () => {
    expect(unknown("3分之1", [1, 3])).toBeCloseTo(1 / 3, 9);
    expect(unknown("3分之1", [1, 3, 1 / 3])).toBeNull();
  });
});

describe("Arabic digits followed by a Chinese unit", () => {
  it("3萬 is 30000, not just 3", () => {
    expect(unknown("約3萬", [3])).toBe(30000);
    expect(unknown("約3萬", [3, 30000])).toBeNull();
    expect(unknown("約3万", [3])).toBe(30000);
  });

  it("1.5萬, 2千, 5億", () => {
    expect(unknown("1.5萬", [1.5])).toBe(15000);
    expect(unknown("2千", [2])).toBe(2000);
    expect(unknown("5億", [5])).toBe(500000000);
  });

  it("7成 is 70 percent", () => {
    expect(unknown("7成", [7])).toBe(70);
    expect(unknown("7成", [7, 0.7])).toBeNull();
  });
});

describe("ordinals", () => {
  it("第三名 names rank 3: fine when there is a third pick, not otherwise", () => {
    expect(unknown("第三名", [3])).toBeNull();
    expect(unknown("第三名", [1, 2])).toBe(3);
  });

  it("第一名 is fine whenever rank 1 is in the input (always true for a ranking)", () => {
    expect(unknown("第一名", [1])).toBeNull();
    expect(unknown("第一名")).toBe(1);
  });

  it("checks a large ordinal as a number", () => {
    expect(unknown("第一百二十五名", [1])).toBe(125);
  });
});

describe("adjacent digits", () => {
  it("五六個 is '5 or 6' or 56: all three readings must be in the input", () => {
    expect(unknown("五六個", [5, 6])).toBe(56);
    expect(unknown("五六個", [56])).toBe(5);
    expect(unknown("五六個", [5, 6, 56])).toBeNull();
  });

  it("二三十 (20 or 30) is checked as 2 and 30", () => {
    expect(unknown("二三十", [30])).toBe(2);
    expect(unknown("二三十", [2, 30])).toBeNull();
  });
});

describe("words that contain a numeral character without being a quantity", () => {
  const lexicon = [
    "一些",
    "一樣",
    "一样",
    "一定",
    "一起",
    "一般",
    "一直",
    "一旦",
    "一切",
    "一邊",
    "一边",
    "一下",
    "一會兒",
    "一会儿",
    "一同",
    "一律",
    "一致",
    "一部分",
    "一方面",
    "一成不變",
    "有一點重",
    "有一点重",
    "一點點",
    "一点点",
    "十分適合",
    "十分适合",
    "十足",
    "十字",
    "萬一",
    "万一",
    "千萬別",
    "千万别",
    "萬能",
    "万能",
    "統一",
    "统一",
    "唯一",
    "同一",
    "單一",
    "单一",
    "零件",
    "零售",
    "零食",
    "零錢",
    "二手",
    "四周",
    "四處",
    "四处",
    "多半",
    "大半",
    "百搭",
    "百般",
    "百貨",
    "百科",
    "千篇一律",
    "萬分",
    "万物",
    "十全十美",
    "十有八九",
    "一向",
    "一再",
    "一貫",
    "一贯",
    "一度",
    "一時",
    "一时",
    "一陣",
    "一阵",
    "一連",
    "一连",
    "一味",
    "一併",
    "一并",
    "一部份",
    "一成不变",
    "專一",
    "专一",
    "劃一",
    "划一",
    "萬用",
    "万用",
    "零星",
    "零散",
    "零钱",
    "零用",
    "零碎",
    "百货",
    "百姓",
    "千里",
    "万分",
    "萬事",
    "万事",
    "萬物",
  ];

  it.each(lexicon)("%s is not a number", (word) => {
    expect(unknown(`這款滑鼠${word}很好。`)).toBeNull();
  });

  it("every entry of the list is exercised by a case above", () => {
    const untested = NON_QUANTITY_COMPOUNDS.filter(
      (entry) => !lexicon.some((word) => word.includes(entry)),
    );
    expect(untested).toEqual([]);
  });

  it("every entry of the list contains a numeral character (otherwise it is dead weight)", () => {
    const dead = NON_QUANTITY_COMPOUNDS.filter(
      (entry) => !/[〇零一二三四五六七八九十百千萬万億亿兩两半]/u.test(entry),
    );
    expect(dead).toEqual([]);
  });

  it("but a listed word does not hide a real number next to it", () => {
    // 萬一 inside 一萬一千 is not the word "in case": this is 11000.
    expect(unknown("一萬一千", [1, 1000])).toBe(11000);
    expect(unknown("一萬一千", [11000])).toBeNull();
    // 十分 next to 之三 is a fraction, and 十分鐘 is ten minutes.
    expect(unknown("十分鐘")).toBe(10);
    expect(unknown("十分钟")).toBe(10);
    // 一點五 is 1.5, not 一點 'a little' followed by 五.
    expect(unknown("一點五")).toBe(1.5);
    // A numeral next to 一定 keeps it a number.
    expect(unknown("五一定", [1])).toBe(51);
  });

  it("an unlisted compound is flagged, not guessed at (strict on purpose)", () => {
    expect(unknown("三心二意")).toBe(3);
  });
});

describe("Unicode forms of Chinese numerals", () => {
  it("reads circled and parenthesised ideograph numerals", () => {
    expect(unknown("㊄")).toBe(5); // NFKC: 五
    expect(unknown("㊄", [5])).toBeNull();
  });

  it("reads Suzhou numerals", () => {
    expect(unknown("〥")).toBe(5); // U+3025
    expect(unknown("〣〢〡")).toBe(321);
  });
});

describe("extractChineseNumerals", () => {
  const values = (text: string) =>
    extractChineseNumerals(text).map((t) => t.value);

  it("returns the values and percent flags", () => {
    expect(extractChineseNumerals("百分之三十")).toEqual([
      { value: 30, percent: true },
    ]);
    expect(extractChineseNumerals("三十%")).toEqual([
      { value: 30, percent: true },
    ]);
    expect(extractChineseNumerals("七成")).toEqual([
      { value: 70, percent: true },
    ]);
    expect(extractChineseNumerals("一百二十")).toEqual([
      { value: 120, percent: false },
    ]);
  });

  it("splits a text into several numbers", () => {
    expect(values("長五十毫米，寬三十毫米")).toEqual([50, 30]);
  });

  it("returns nothing for ordinary Chinese prose", () => {
    expect(values("這款滑鼠很適合你的手，握起來一樣舒服。")).toEqual([]);
    expect(values("")).toEqual([]);
  });

  it("does not read digits (that is the digit path's job)", () => {
    expect(values("長125毫米")).toEqual([]);
  });
});

// The same rule end to end, through the real analyse() call path.
describe("analyse — Chinese numbers in the model's answer", () => {
  function input() {
    const fit = makeFit({
      results: [{ ...makeFit().results[0]!, confidence: 0.9 }],
    });
    return buildAnalysisInput(fit, makeMeasurements());
  }
  const answer = (whyTopPick: string) =>
    JSON.stringify({
      headline: "很適合你的手。",
      whyTopPick,
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });

  it("accepts a Chinese answer whose numbers all come from the input", async () => {
    // 125 is the top pick's length in the shared fixture.
    const client = new FakeTextModel({
      answer: () => answer("它長一百二十五毫米，很接近你的理想長度。"),
    });
    const { source } = await analyse(input(), client);
    expect(source).toBe("model");
    expect(client.calls).toHaveLength(1);
  });

  it("retries an invented Chinese number, naming it, then accepts the corrected answer", async () => {
    const client = new FakeTextModel({
      answer: (_args, i) =>
        answer(
          i === 0
            ? "它比你的理想長度長七毫米。"
            : "它的長度很接近你的理想長度。",
        ),
    });
    const { source } = await analyse(input(), client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("the number 7");
    expect(source).toBe("model");
  });

  it("falls back after two invented Chinese numbers", async () => {
    const client = new FakeTextModel({
      answer: () => answer("有百分之九十九的把握。"),
    });
    const { source } = await analyse(input(), client);
    expect(client.calls).toHaveLength(2);
    expect(source).toBe("fallback");
  });
});
