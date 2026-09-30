import { describe, expect, it } from "vitest";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import { findUnknownNumeral } from "../../src/server/analysis/numerals";

/**
 * False-alarm regression for hard rule 2 (numerals) and the medical-claims
 * list, on ordinary Traditional Chinese mouse descriptions. Each sentence is
 * something a model could write about a shape or a score; none states a number
 * that the input lacks and none makes a health claim, so none may be flagged.
 *
 * A false alarm costs a retry or the fallback answer. Word by word, these are
 * the ordinary words that share a character with a number: 後半部, 百分比,
 * 十分, 參考, 舒緩, 四周, 大陸, 隊伍, 千萬, 萬分, 萬一, 一樣, 一點, 上半部.
 */

/** What a real run allows: ranks 1 to 3, a few scores, sizes and weights. */
const ALLOWED: ReadonlySet<number> = new Set([
  1, 2, 3, 5, 38, 40, 60, 63.5, 64, 91, 92, 120, 125,
]);

const SENTENCES: readonly string[] = [
  "這款滑鼠的後半部隆起，掌心可以穩穩托住。",
  "信心百分比為 92%，這個排名可以放心參考。",
  "握起來十分貼合，手掌與拱背的弧度很搭。",
  "參考尺寸為長 125 毫米、寬 63.5 毫米，和你的手很接近。",
  "側邊的弧度舒緩，拇指放起來很自然。",
  "滑鼠四周的邊緣都很圓潤，握持時不會卡手。",
  "這款滑鼠在大陸和台灣都買得到，很多人一起使用。",
  "適合整個隊伍一起使用，也方便統一採購。",
  "第一名的重量為 60 克，第二名稍重一點。",
  "前半段的曲線比較平緩，後半段則明顯抬高。",
  "千萬不要握得太緊，讓手指自然放鬆。",
  "它十分適合中等手型，握持也十分穩定。",
  "第三名的長度差了一點點，但整體仍然一樣好用。",
  "上半部的塗層摸起來很舒服，下半部則有止滑紋路。",
  "萬一手滑也不容易掉，讓人十分安心。",
  "整體評分為 91 分，在三款候選中最高。",
  "第一名的 fit 分數是 91/100，第二名也只差一點點。",
  "信心約百分之九十二，屬於可以採信的範圍。",
  "重量偏輕，單手操作十分輕鬆，萬分推薦給喜歡快速移動的人。",
  "曲線舒緩的背部剛好托住掌心，手指的位置也很自然。",
  "長度 125 毫米，比你的理想長度 120 毫米長 5 毫米，前端略寬一些。",
];

describe("ordinary Chinese mouse descriptions are not flagged", () => {
  it("has at least ten sentences", () => {
    expect(SENTENCES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(SENTENCES)("numbers: %s", (sentence) => {
    expect(findUnknownNumeral(sentence, ALLOWED)).toBeNull();
  });

  it.each(SENTENCES)("medical claims: %s", (sentence) => {
    expect(findMedicalClaimTerm(sentence)).toBeNull();
  });
});

describe("the same sentences with one invented number are flagged", () => {
  it.each([
    ["握起來十分貼合，重量只有七十克。", 70],
    ["信心百分比為 87%，這個排名可以放心參考。", 87],
    ["第一名的重量為 60 克，第四名稍重一點。", 4],
    ["參考尺寸約 1/3 個手掌長。", 1 / 3],
    ["前半段的曲線比較平緩，然後半小時就習慣了。", 0.5],
  ] as const)("%s", (sentence, value) => {
    expect(findUnknownNumeral(sentence, ALLOWED)).toBeCloseTo(value, 9);
  });
});
