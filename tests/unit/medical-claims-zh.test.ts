import { describe, expect, it } from "vitest";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";

/**
 * Chinese coverage of the medical-claims list (candidate list, 未拍板). The
 * model prompt is English today, but model output can be Chinese (i18n PR3
 * turns it on), so both Traditional and Simplified terms must already be
 * rejected. Categories follow the rule the English list enforces: named
 * conditions, symptoms, injury, treatment and efficacy, prevention and relief
 * claims, and "healthy / ergonomic / friendly to the wrist" claims. Comfort
 * wording ("less fatigue", "comfortable") is deliberately NOT a medical claim
 * in the English list, and stays accepted here too.
 */
const MUST_FLAG: readonly (readonly [category: string, text: string])[] = [
  // Named conditions
  ["condition (TW)", "降低滑鼠手的風險"],
  ["condition (CN)", "降低鼠标手的风险"],
  ["condition (TW)", "不容易得媽媽手"],
  ["condition (CN)", "不容易得妈妈手"],
  ["condition", "有腱鞘炎的人也適合"],
  ["condition (TW)", "避免網球肘"],
  ["condition (CN)", "避免网球肘"],
  ["condition (TW)", "板機指的困擾"],
  ["condition (CN)", "扳机指的困扰"],
  ["condition (TW)", "關節炎患者"],
  ["condition (CN)", "关节炎患者"],
  ["condition (TW)", "重複性勞損"],
  ["condition (CN)", "重复性劳损"],
  ["condition (TW)", "重複性傷害"],
  ["condition (CN)", "重复性伤害"],
  ["condition (TW)", "職業病"],
  ["condition (CN)", "职业病"],
  ["syndrome (TW)", "滑鼠症候群"],
  ["syndrome (CN)", "鼠标综合征"],
  ["syndrome (CN)", "鼠标综合症"],
  ["syndrome (TW)", "滑鼠綜合症"],
  ["syndrome (TW)", "滑鼠綜合徵"],
  ["disease (TW)", "疾病"],
  ["disease", "病症"],
  ["disease", "病痛"],
  ["disease (CN)", "疾病"],
  ["symptom (TW)", "症狀會減少"],
  ["symptom (CN)", "症状会减少"],
  // Symptoms
  ["pain (TW)", "手痛的人"],
  ["pain (CN)", "手痛的人"],
  ["pain", "腕部刺痛"],
  ["pain (TW)", "痠痛"],
  ["pain (TW)", "手臂痠"],
  ["pain", "手疼"],
  ["pain (CN)", "酸痛"],
  ["soreness (TW)", "手酸"],
  ["soreness (TW)", "手痠"],
  ["numbness (TW)", "手麻"],
  ["numbness", "指尖發麻"],
  ["numbness (CN)", "指尖发麻"],
  ["numbness", "麻木"],
  ["numbness (TW)", "麻痺"],
  ["numbness (CN)", "麻痹"],
  ["inflammation (TW)", "發炎"],
  ["inflammation (CN)", "发炎"],
  ["inflammation", "炎症"],
  ["swelling (TW)", "手腕腫脹"],
  ["swelling (CN)", "手腕肿胀"],
  // Injury
  ["injury (TW)", "傷害"],
  ["injury (CN)", "伤害"],
  ["injury (TW)", "損傷"],
  ["injury (CN)", "损伤"],
  ["injury (TW)", "勞損"],
  ["injury (CN)", "劳损"],
  ["injury (TW)", "拉傷"],
  ["injury (CN)", "拉伤"],
  ["injury (TW)", "扭傷"],
  ["injury (CN)", "扭伤"],
  // Treatment and efficacy
  ["efficacy (TW)", "療效"],
  ["efficacy (CN)", "疗效"],
  ["therapy (TW)", "療法"],
  ["therapy (CN)", "疗法"],
  ["therapy (TW)", "療程"],
  ["therapy (CN)", "疗程"],
  ["cure (TW)", "治癒"],
  ["cure (CN)", "治愈"],
  ["cure (TW)", "痊癒"],
  ["cure (CN)", "痊愈"],
  ["recovery (TW)", "康復"],
  ["recovery (CN)", "康复"],
  ["rehabilitation (TW)", "復健"],
  ["rehabilitation (CN)", "复健"],
  ["medicine", "醫學上"],
  ["medicine", "医学上"],
  ["doctor (TW)", "請諮詢醫生"],
  ["doctor (CN)", "请咨询医生"],
  ["doctor (TW)", "醫師"],
  ["doctor (CN)", "医师"],
  ["seek care (TW)", "請就醫"],
  ["seek care (CN)", "请就医"],
  ["clinical (TW)", "臨床證實"],
  ["clinical (CN)", "临床证实"],
  ["drug (TW)", "藥物"],
  ["drug (CN)", "药物"],
  // Prevention and relief
  ["prevent (TW)", "預防損傷"],
  ["prevent (CN)", "预防损伤"],
  ["prevent (TW)", "防止受傷"],
  ["prevent (CN)", "防止受伤"],
  ["prevent (TW)", "避免勞損"],
  ["prevent (CN)", "避免劳损"],
  ["prevent (TW)", "預防疾病"],
  ["prevent (TW)", "預防慢性病"],
  ["prevent (CN)", "预防慢性病"],
  ["prevent (TW)", "避免生病"],
  ["prevent (CN)", "预防疾病"],
  ["prevent (TW)", "防範關節炎"],
  ["prevent (CN)", "防范关节炎"],
  ["prevent (TW)", "預防腕隧道症候群"],
  ["relieve (TW)", "舒緩手腕不適"],
  ["relieve (CN)", "舒缓手腕不适"],
  ["relieve (TW)", "舒緩壓力"],
  ["relieve (CN)", "舒缓压力"],
  ["relieve (TW)", "緩解"],
  ["relieve (CN)", "缓解"],
  ["reduce stress (TW)", "減輕手腕壓力"],
  ["reduce stress (CN)", "减轻手腕压力"],
  ["reduce stress (TW)", "降低手部緊繃"],
  ["reduce stress (CN)", "降低手部紧绷"],
  ["reduce stress (TW)", "減少手指張力"],
  ["reduce stress (CN)", "减少手指张力"],
  ["reduce burden (TW)", "減輕手腕負擔"],
  ["reduce burden (CN)", "减轻手腕负担"],
  ["protect (TW)", "保護手腕"],
  ["protect (CN)", "保护手腕"],
  ["protect (TW)", "呵護關節"],
  ["protect (CN)", "呵护关节"],
  // Healthy / ergonomic / friendly claims
  ["health", "有益健康"],
  ["health", "保健"],
  ["health (TW)", "養生"],
  ["health (CN)", "养生"],
  ["wrist-friendly (TW)", "手腕友善"],
  ["wrist-friendly (CN)", "手腕友好"],
  ["wrist-friendly (TW)", "對手腕友善"],
  ["wrist-friendly (CN)", "对手腕友好"],
  ["safer (TW)", "對手腕更安全"],
  ["safer (CN)", "对手腕更安全"],
  ["safer (TW)", "對身體更安全"],
  ["ergonomic (TW)", "人體工學"],
  ["ergonomic (CN)", "人体工学"],
  ["ergonomic (TW)", "人體工程學"],
  ["ergonomic (CN)", "人体工程学"],
  ["ergonomic (TW)", "人因工程"],
  ["ergonomic (CN)", "人机工程"],
  ["ergonomic (TW)", "人機工程設計"],
  ["ergonomic (TW)", "人因工學"],
  ["ergonomic (TW)", "人機工學"],
  ["ergonomic (CN)", "人机工学"],
  ["wrist guard (TW)", "護腕"],
  ["wrist guard (CN)", "护腕"],
];

// Shape facts, comfort wording, and ordinary words that merely share a
// character with a term above.
const MUST_PASS: readonly string[] = [
  "這款滑鼠的長度與你的手很搭。",
  "这款鼠标的长度与你的手很搭。",
  "前端向外擴張，適合爪握。",
  "前端向外扩张，适合爪握。",
  "拱背偏高，掌握時手心貼合。",
  "拱背偏高，掌握时手心贴合。",
  "重量較輕，握起來很順手。",
  "外殼比你的手寬，握持面較窄。",
  "不對稱造型，僅供右手使用。",
  "不对称造型，仅供右手使用。",
  "握起來舒適，長時間使用也不容易疲勞。", // comfort, like the English "less fatigue"
  "握起来舒适，长时间使用也不容易疲劳。",
  "預防滑動", // "prevents sliding": existing near miss
  "预防滑动",
  "避免手指打滑",
  "避免手指打滑，握持更穩。",
  "降低高度以配合你的手掌。",
  "降低整體高度",
  "減輕重量",
  "减轻重量",
  "減少重量",
  "改善握感",
  "保護套",
  "保护套",
  "手腕位置",
  "手腕寬度",
  "疼愛",
  "疼爱",
  "疼惜",
  "改善手指抓握",
  "減少手指打滑",
  "减少手指打滑",
  "麻煩",
  "麻烦",
  "麻辣",
  "酸性塗層",
  "傷腦筋",
  "伤脑筋",
  "健身",
  "安全的購買",
  "資料安全",
  "這個排名為暫定，部分形狀描述尚未分類。",
  "这个排名为暂定，部分形状描述尚未分类。",
];

describe("findMedicalClaimTerm — Chinese", () => {
  it.each(MUST_FLAG)("flags %s: %s", (_category, text) => {
    expect(findMedicalClaimTerm(text)).not.toBeNull();
  });

  it.each(MUST_PASS)("accepts shape and comfort wording: %s", (text) => {
    expect(findMedicalClaimTerm(text)).toBeNull();
  });

  it("names the entry that matched, including ones another entry would also catch", () => {
    const labels: readonly (readonly [string, RegExp])[] = [
      ["重複性勞損", /重複性/],
      ["重复性伤害", /重複性|重复性/],
      ["病痛", /^病痛$/],
      ["痠痛", /^痠痛$/],
      ["手臂痠", /痠/],
      ["手疼", /疼/],
      ["舒緩壓力", /^舒緩$/],
      ["舒缓压力", /^舒缓$/],
      ["預防慢性病", /預防/],
    ];
    for (const [text, label] of labels) {
      expect(findMedicalClaimTerm(text), text).toMatch(label);
    }
  });

  it("returns a readable label naming what matched", () => {
    expect(findMedicalClaimTerm("降低滑鼠手的風險")).toBe("滑鼠手");
    expect(findMedicalClaimTerm("預防疾病")).toMatch(/預防|预防/);
  });

  it("flags a Traditional and a Simplified spelling of the same claim alike", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["治療", "治疗"],
      ["緩解", "缓解"],
      ["人體工學", "人体工学"],
      ["減輕手腕壓力", "减轻手腕压力"],
      ["保護手腕", "保护手腕"],
      ["復健", "复健"],
      ["發炎", "发炎"],
      ["預防損傷", "预防损伤"],
    ];
    for (const [traditional, simplified] of pairs) {
      expect(findMedicalClaimTerm(traditional), traditional).not.toBeNull();
      expect(findMedicalClaimTerm(simplified), simplified).not.toBeNull();
    }
  });
});
