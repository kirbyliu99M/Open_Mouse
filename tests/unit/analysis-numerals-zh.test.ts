import { describe, expect, it } from "vitest";
import { analyse } from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import {
  CONDITIONAL_COMPOUNDS,
  DIGITS,
  NON_QUANTITY_COMPOUNDS,
  SHORTHAND,
  UNITS,
} from "../../src/server/analysis/chinese-numerals";
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

describe("financial numerals: only characters with an everyday meaning are exempt alone", () => {
  it("reads a financial run", () => {
    expect(unknown("壹佰貳拾伍")).toBe(125);
    expect(unknown("壹佰貳拾伍", [125])).toBeNull();
    expect(unknown("貳拾")).toBe(20);
    expect(unknown("贰拾")).toBe(20);
    expect(unknown("拾伍")).toBe(15);
  });

  it.each([
    "大陸",
    "大陆",
    "陸續",
    "陆续",
    "參考",
    "参考",
    "隊伍",
    "队伍",
    "拾起",
    "肆意",
  ])("does not read %s as a number", (word) => {
    expect(unknown(word)).toBeNull();
  });

  it.each([
    ["壹", 1],
    ["貳", 2],
    ["貮", 2],
    ["贰", 2],
    ["叁", 3],
    ["柒", 7],
    ["捌", 8],
    ["玖", 9],
    ["佰", 100],
    ["仟", 1000],
  ] as const)(
    "a lone %s is the number %s (it has no everyday use)",
    (c, value) => {
      expect(unknown(c)).toBe(value);
      expect(unknown(c, [value])).toBeNull();
    },
  );

  it.each([
    "大陸一直很受歡迎",
    "大陆一直很受欢迎",
    "適合整個隊伍一起使用",
    "在大陸一些城市也買得到",
    "隊伍一定要穩定",
    "隊伍裡的人有一點累",
  ])(
    "%s: a noun in front of a 一-word is not the start of a number",
    (text) => {
      expect(unknown(text)).toBeNull();
    },
  );

  it("but a financial run in front of a 一-word is still a number", () => {
    // 佰 makes 伍 part of 壹佰伍, and 拾一 is 11: only a lone 肆陸陆伍 is exempt.
    expect(unknown("壹佰伍一起", [1])).toBe(150); // 一百五, as 一百二 is 120
    expect(unknown("拾一些", [1])).toBe(11);
    expect(unknown("五一定", [1])).toBe(51);
  });

  it("flags a lone financial digit inside a sentence", () => {
    expect(unknown("長度柒毫米", [1])).toBe(7);
    expect(unknown("長度玖毫米", [1])).toBe(9);
    expect(unknown("重量捌拾克", [1])).toBe(80);
  });
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
    "伎倆",
    "伎俩",
    "技倆",
    "技俩",
    "百分比",
    "百分率",
    "前半",
    "後半",
    "后半",
    "上半",
    "下半",
    "左半",
    "右半",
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

  it("every context-dependent word is exercised by a case above", () => {
    const untested = CONDITIONAL_COMPOUNDS.filter(
      ({ word }) => !lexicon.some((entry) => entry.includes(word)),
    ).map(({ word }) => word);
    expect(untested).toEqual([]);
  });

  it("every entry of the list contains a numeral character (otherwise it is dead weight)", () => {
    const dead = NON_QUANTITY_COMPOUNDS.filter(
      (entry) =>
        !/[〇零一二三四五六七八九十百千萬万億亿兩两半倆俩仨]/u.test(entry),
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

describe("萬分 / 万分: 'extremely' unless 之 follows", () => {
  it("萬分之N is a fraction, not the adverb", () => {
    expect(unknown("萬分之一", [1])).toBeCloseTo(1e-4, 9);
    expect(unknown("約萬分之一的誤差", [1])).toBeCloseTo(1e-4, 9);
    expect(unknown("萬分之三", [1, 2, 3])).toBeCloseTo(3e-4, 9);
    expect(unknown("万分之三", [1, 2, 3])).toBeCloseTo(3e-4, 9);
  });

  it("千萬分之一 is one in ten million: the 千 keeps 萬分 a number", () => {
    expect(unknown("千萬分之一", [1])).toBeCloseTo(1e-7, 12);
    expect(unknown("千万分之一", [1])).toBeCloseTo(1e-7, 12);
  });

  it("the fraction is accepted when its value is in the input", () => {
    expect(unknown("萬分之一", [1, 1e-4])).toBeNull();
    expect(unknown("万分之三", [3e-4])).toBeNull();
  });

  it("千分之N and 百分之N were never hidden by a list entry", () => {
    expect(unknown("千分之一", [1])).toBeCloseTo(1e-3, 9);
    expect(unknown("千分之三", [1, 2, 3])).toBeCloseTo(3e-3, 9);
    expect(unknown("百分之三", [3])).toBeNull(); // 3 percent, and 3 is in the input
    expect(unknown("百分之三", [1, 2])).toBe(3);
  });

  it.each([
    "萬分感謝",
    "万分感谢",
    "萬分抱歉",
    "對此感激萬分。",
    "感到萬分榮幸",
  ])("%s stays the adverb", (text) => {
    expect(unknown(text, [1])).toBeNull();
  });
});

describe("十分: 'very', or ten (points, minutes, tenths)", () => {
  it.each([
    ["滿分十分", 10],
    ["满分十分", 10],
    ["得分十分", 10],
    ["十分制", 10],
    ["十分鍾", 10],
    ["十分鐘", 10],
    ["十分钟", 10],
    ["比第二名高出十分", 10],
    ["高出十分。", 10],
    ["高了十分左右", 10],
    ["低了十分以上", 10],
    ["差了十分左右", 10],
    ["彼此相差十分上下", 10],
    ["多了十分以上", 10],
    ["少了十分左右", 10],
    ["拿了十分以上", 10],
    ["只有十分左右", 10],
    ["比第二名高十分左右", 10],
    ["再加十分以上", 10],
    ["扣十分以上", 10],
    ["減十分左右", 10],
    ["减十分左右", 10],
    ["第一名十分,", 10],
    ["第一名十分 好", 10],
    ["十分", 10],
  ] as const)("%s is the number %s", (text, value) => {
    // 1 and 2 are in the input (a ranking has a first and a second pick).
    expect(unknown(text, [1, 2])).toBe(value);
    expect(unknown(text, [1, 2, value])).toBeNull();
  });

  it.each([
    "十分舒適",
    "十分合適",
    "十分适合",
    "握起來十分貼合",
    "握得十分穩",
    "重量十分輕",
    "整體十分一致",
    "第一名十分適合你的手",
    "而且十分順手，也十分好握。",
  ])("%s is the adverb 'very'", (text) => {
    expect(unknown(text, [1])).toBeNull();
  });

  it("十分之三 is still 0.3", () => {
    expect(unknown("十分之三", [1, 3])).toBeCloseTo(0.3, 9);
  });

  it("十分 next to another numeral is part of that number", () => {
    expect(unknown("二十分", [1])).toBe(20);
    expect(unknown("十分五", [1])).toBe(10);
  });
});

describe("千萬 / 千万: 'by all means', or ten million", () => {
  it.each(["千萬像素", "千万像素", "價格上千萬。", "千萬台", "千萬分之一"])(
    "%s is a number",
    (text) => {
      expect(unknown(text, [1])).not.toBeNull();
    },
  );

  it("千萬像素 is 10,000,000", () => {
    expect(unknown("千萬像素", [1])).toBe(10_000_000);
    expect(unknown("千萬像素", [1, 10_000_000])).toBeNull();
  });

  it.each([
    "千萬不要",
    "千萬別用力握",
    "千万别用力握",
    "千萬要注意",
    "千萬記得清潔",
    "千万记得清洁",
    "千萬勿摔落",
    "千萬莫拆開",
    "千萬小心",
    "千萬注意",
    "千萬得小心",
  ])("%s is the adverb", (text) => {
    expect(unknown(text, [1])).toBeNull();
  });
});

describe("四周 (surroundings) versus 四週 (four weeks)", () => {
  // A trade-off, documented next to the list entry: Taiwan writes four weeks
  // as 四週 and the surroundings as 四周. The list follows that.
  it("滑鼠四周 passes", () => {
    expect(unknown("滑鼠四周的邊緣很圓潤", [1])).toBeNull();
  });

  it("四週 (four weeks) is a number", () => {
    expect(unknown("用了四週", [1])).toBe(4);
    expect(unknown("用了四週", [1, 4])).toBeNull();
  });
});

describe("○ (U+25CB) is zero only beside another numeral", () => {
  it("一○○ is 100, 二○二四 is 2024", () => {
    expect(unknown("一○○", [1])).toBe(100);
    expect(unknown("一○○", [1, 100])).toBeNull();
    expect(unknown("二○二四", [1])).toBe(2024);
    expect(unknown("長二○毫米", [1])).toBe(20);
    expect(unknown("○五", [1])).toBe(5);
  });

  it("a placeholder, alone or with other ○, is not a number", () => {
    expect(unknown("○○滑鼠")).toBeNull();
    expect(unknown("這款○○滑鼠很好")).toBeNull();
    expect(unknown("○")).toBeNull();
    expect(unknown("○○○")).toBeNull();
    expect(unknown("○ 適合右手")).toBeNull();
  });

  it("a ○ in front of the decimal digits belongs to the number", () => {
    expect(unknown("三點○五", [3, 5])).toBe(3.05);
  });
});

describe("參 / 参 is a financial 3 only beside another numeral", () => {
  it("參拾伍 is 35, 參佰 is 300", () => {
    expect(unknown("參拾伍", [1])).toBe(35);
    expect(unknown("參拾伍", [35])).toBeNull();
    expect(unknown("參佰", [1])).toBe(300);
    expect(unknown("參佰", [300])).toBeNull();
    expect(unknown("拾參", [1])).toBe(13);
    expect(unknown("参拾伍", [1])).toBe(35);
  });

  it.each([
    "參考",
    "參數",
    "參加",
    "參與",
    "參考尺寸",
    "参考",
    "参数",
    "参加",
    "参与",
  ])("%s is an ordinary word", (word) => {
    expect(unknown(word)).toBeNull();
  });
});

describe("colloquial numerals", () => {
  it("仨 is always 3", () => {
    expect(unknown("我們仨", [1])).toBe(3);
    expect(unknown("我們仨", [1, 3])).toBeNull();
  });

  it("倆 / 俩 is 2", () => {
    expect(unknown("他倆", [1])).toBe(2);
    expect(unknown("他俩", [1])).toBe(2);
    expect(unknown("咱倆", [1, 2])).toBeNull();
  });

  it("伎倆 / 技倆 is a trick, not a number", () => {
    expect(unknown("這種伎倆不高明")).toBeNull();
    expect(unknown("这种伎俩不高明")).toBeNull();
    expect(unknown("這種技倆不高明")).toBeNull();
    expect(unknown("这种技俩不高明")).toBeNull();
  });
});

describe("百分比 and position words are not quantities", () => {
  it("百分比 / 百分率 name a percentage without stating one", () => {
    expect(unknown("信心百分比很高")).toBeNull();
    expect(unknown("命中百分率")).toBeNull();
    // 百分之N and 百分點 are still read.
    expect(unknown("百分之九十", [1])).toBe(90);
  });

  it.each([
    "前半段",
    "後半部隆起",
    "后半部隆起",
    "上半身",
    "下半部",
    "左半邊",
    "右半邊",
  ])("%s is a position", (text) => {
    expect(unknown(text)).toBeNull();
  });

  it("other 半 is still 0.5", () => {
    expect(unknown("半個手掌")).toBe(0.5);
    expect(unknown("一半")).toBe(0.5);
    expect(unknown("半小時", [1])).toBe(0.5);
    expect(unknown("三個半月", [3])).toBe(0.5);
  });

  it("a half that the position word only seems to contain is still 0.5", () => {
    expect(unknown("然後半個手掌", [1])).toBe(0.5);
    expect(unknown("然後半小時", [1])).toBe(0.5);
    expect(unknown("之後半小時", [1])).toBe(0.5);
    expect(unknown("後半個月", [1])).toBe(0.5);
    expect(unknown("晚上半小時", [1])).toBe(0.5);
  });
});

describe("every character of the numeral tables reads as its value", () => {
  // Written out by hand, not derived from the tables, so that a wrong value in
  // the table is caught. The two coverage checks below fail when a character is
  // added to a table without being listed here.
  const digitValues: Readonly<Record<string, number>> = {
    〇: 0,
    零: 0,
    一: 1,
    二: 2,
    兩: 2,
    两: 2,
    仨: 3,
    倆: 2,
    俩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    壹: 1,
    貳: 2,
    貮: 2,
    贰: 2,
    叁: 3,
    肆: 4,
    伍: 5,
    陸: 6,
    陆: 6,
    柒: 7,
    捌: 8,
    玖: 9,
    〡: 1,
    〢: 2,
    〣: 3,
    〤: 4,
    〥: 5,
    〦: 6,
    〧: 7,
    〨: 8,
    〩: 9,
  };
  const unitValues: Readonly<Record<string, number>> = {
    十: 10,
    拾: 10,
    〸: 10,
    百: 100,
    佰: 100,
    千: 1000,
    仟: 1000,
    萬: 10_000,
    万: 10_000,
    億: 100_000_000,
    亿: 100_000_000,
  };
  const shorthandValues: Readonly<Record<string, number>> = {
    廿: 20,
    卄: 20,
    卅: 30,
    卌: 40,
    〹: 20,
    〺: 30,
  };

  it("the lists here cover every table entry, and nothing else", () => {
    expect(Object.keys(digitValues).sort()).toEqual([...DIGITS.keys()].sort());
    expect(Object.keys(unitValues).sort()).toEqual([...UNITS.keys()].sort());
    expect(Object.keys(shorthandValues).sort()).toEqual(
      [...SHORTHAND.keys()].sort(),
    );
  });

  it.each(Object.entries(digitValues).filter(([, value]) => value > 0))(
    "digit %s (in front of 百) is %s hundred",
    (c, value) => {
      expect(unknown(`${c}百`)).toBe(value * 100);
      expect(unknown(`${c}百`, [value * 100])).toBeNull();
    },
  );

  it.each(Object.entries(digitValues).filter(([, value]) => value === 0))(
    "zero %s after a one makes ten",
    (c) => {
      expect(unknown(`一${c}`)).toBe(10);
    },
  );

  it.each(Object.entries(unitValues))(
    "unit %s is %s (after 二)",
    (c, value) => {
      expect(unknown(`二${c}`)).toBe(2 * value);
      expect(unknown(`二${c}`, [2 * value])).toBeNull();
    },
  );

  it.each(Object.entries(shorthandValues))("shorthand %s is %s", (c, value) => {
    expect(unknown(c)).toBe(value);
    expect(unknown(c, [value])).toBeNull();
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
