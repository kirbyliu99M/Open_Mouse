import { describe, expect, it } from "vitest";
import { analyse, buildPrompt } from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { mentionsProvisional } from "../../src/server/analysis/provisional";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

/**
 * At low confidence the model's `caveats` must say the ranking is provisional.
 * That check used to be `/provisional/i`, which no Chinese answer can pass:
 * once i18n PR3 lets the model answer in Chinese, every low-confidence answer
 * would have been retried and then replaced by the fallback.
 */
describe("mentionsProvisional", () => {
  it.each([
    "This ranking is provisional.",
    "This ranking is provisional — some descriptors aren't classified yet.",
    "PROVISIONAL",
    "The results are provisionally ranked.",
    "ＰＲＯＶＩＳＩＯＮＡＬ", // fullwidth Latin letters
  ])("accepts English: %s", (text) => {
    expect(mentionsProvisional(text)).toBe(true);
  });

  it.each([
    "此排名為暫定，部分形狀描述尚未分類。",
    "此排名暫定，因為有些形狀描述尚未分類。",
    "目前的排名僅為初步結果。",
    "這是初步的排名。",
    "排名屬於暫定性質。",
  ])("accepts Traditional Chinese: %s", (text) => {
    expect(mentionsProvisional(text)).toBe(true);
  });

  it.each([
    "此排名为暂定，部分形状描述尚未分类。",
    "此排名暂定，因为有些形状描述尚未分类。",
    "目前的排名仅为初步结果。",
    "这是初步的排名。",
  ])("accepts Simplified Chinese: %s", (text) => {
    expect(mentionsProvisional(text)).toBe(true);
  });

  it("accepts either language inside a mixed sentence", () => {
    expect(mentionsProvisional("排名 is provisional，請留意。")).toBe(true);
    expect(mentionsProvisional("This ranking 暫定，please note.")).toBe(true);
  });

  it.each([
    "",
    "Some shape descriptors are not classified yet.",
    // The sentence the prompt shows the model as rankingStatus must not count.
    "Fit settings have not yet been validated against owner ratings.",
    // A natural Chinese rendering of that same sentence must not count either.
    "配適設定尚未依使用者評分驗證。",
    "配适设定尚未依使用者评分验证。",
    "部分形狀描述尚未分類。",
    "部分形状描述尚未分类。",
    // 暫時 ("for now") and 臨時 are not 暫定 ("provisional").
    "暫時無法判斷。",
    "暂时无法判断。",
    "臨時的選擇",
    "暫",
  ])("rejects a caveat that does not say provisional: %s", (text) => {
    expect(mentionsProvisional(text)).toBe(false);
  });

  it.each([
    "This ranking is not provisional.",
    "The ranking isn't provisional.",
    "This is a non-provisional ranking.",
    "The ranking is no longer provisional.",
    "此排名並非暫定。",
    "此排名并非暂定。",
    "此排名不是暫定的。",
    "这个排名不再暂定。",
    "此排名不算初步結果。",
    "這不是初步的排名。",
    "此排名無暫定成分。",
    "This is never a provisional ranking.",
    "此排名不屬於暫定結果。",
    "此排名不属于暂定结果。",
    "此排名沒有暫定的成分。",
    "此排名没有初步的成分。",
  ])("rejects a caveat that denies it: %s", (text) => {
    expect(mentionsProvisional(text)).toBe(false);
  });

  it.each([
    // A short linking phrase between the negator and the marker.
    "此排名不再是暫定。",
    "這個排名不是一個暫定的排名。",
    "這並非一份初步報告。",
    "此排名不算是暫定。",
    "此排名不會是暫定。",
    "此排名不会是暂定。",
    "這不是一種初步的判斷。",
    "此排名並不是暫定。",
    "此排名并不是暂定。",
    "此排名並不屬於暫定。",
    "此排名絕非暫定。",
    "此排名绝非暂定。",
    "此排名不再算是初步結果。",
    // The bare negators, which the tests above never used.
    "此排名不暫定。",
    "這是非暫定的排名。",
    "此排名无暂定成分。",
  ])("rejects a caveat whose negation is a few words away: %s", (text) => {
    expect(mentionsProvisional(text)).toBe(false);
  });

  it.each([
    "目前結果是初步的。",
    "不過這仍是暫定排名。",
    "不过这仍是暂定排名。",
    // Words that start with 不 / 無 but are not a negation.
    "不過是暫定結果。",
    "不管怎樣，這都是暫定排名。",
    "不管是暫定還是最終，請留意誤差。",
    "不論如何這是暫定排名。",
    "不论如何这是暂定排名。",
    "不少結果屬於暫定。",
    "不少是暫定的排名。",
    "這是不錯的初步結果。",
    "这是不错的初步结果。",
    "不但是暫定，也很粗略。",
    "不僅是暫定，也很粗略。",
    "不仅是暂定，也很粗略。",
    "無論如何這都是暫定排名。",
    "非常初步的結果。",
    "這不只是暫定結果。",
  ])("still counts a mention with no real negation: %s", (text) => {
    expect(mentionsProvisional(text)).toBe(true);
  });

  it("counts a later, un-negated mention even if an earlier one is negated", () => {
    expect(
      mentionsProvisional(
        "It is not provisional. Still, treat it as provisional.",
      ),
    ).toBe(true);
    expect(mentionsProvisional("並非暫定。不過請當作暫定結果。")).toBe(true);
  });

  it("does not treat 不只 / 不僅 ('not only') as a negation", () => {
    expect(mentionsProvisional("這不只是暫定結果，也請留意誤差。")).toBe(true);
    expect(
      mentionsProvisional("This is not only provisional, but rough."),
    ).toBe(true);
  });
});

function lowConfidenceInput() {
  const fit = makeFit({
    results: [{ ...makeFit().results[0]!, confidence: 0.4 }],
  });
  return buildAnalysisInput(fit, makeMeasurements());
}

function answerWithCaveat(caveat: string) {
  return JSON.stringify({
    headline: "A strong match.",
    whyTopPick: "It fits.",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [caveat],
  });
}

describe("analyse — provisional caveat in the model's own language", () => {
  it.each([
    ["Traditional", "此排名為暫定，部分形狀描述尚未分類。"],
    ["Simplified", "此排名为暂定，部分形状描述尚未分类。"],
  ])("accepts a %s Chinese caveat on the first attempt", async (_l, caveat) => {
    const input = lowConfidenceInput();
    expect(input.topPicks[0]!.lowConfidence).toBe(true);
    const client = new FakeTextModel({
      answer: () => answerWithCaveat(caveat),
    });
    const { source } = await analyse(input, client);
    expect(client.calls).toHaveLength(1);
    expect(source).toBe("model");
  });

  it("retries a Chinese answer whose caveat does not say provisional, naming what is missing", async () => {
    const input = lowConfidenceInput();
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        answerWithCaveat(
          callIndex === 0
            ? "部分形狀描述尚未分類。"
            : "此排名為暫定，部分形狀描述尚未分類。",
        ),
    });
    const { source } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain(
      "(missing) a caveat noting the ranking is provisional",
    );
    expect(source).toBe("model");
  });

  it("does not accept a caveat that denies the ranking is provisional", async () => {
    const input = lowConfidenceInput();
    const client = new FakeTextModel({
      answer: () => answerWithCaveat("This ranking is not provisional."),
    });
    const { source } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(source).toBe("fallback");
  });

  it("does not accept the prompt's own rankingStatus sentence, in English or Chinese", () => {
    const input = lowConfidenceInput();
    const shown = JSON.parse(buildPrompt(input).split("Data:\n")[1]!) as {
      rankingStatus: string;
    };
    expect(mentionsProvisional(shown.rankingStatus)).toBe(false);
    // The prompt is English today. These are the Traditional and Simplified
    // renderings of that same sentence, which a Chinese prompt would show.
    for (const chinese of [
      "配適設定尚未依使用者評分驗證。",
      "配适设定尚未依使用者评分验证。",
    ]) {
      expect(mentionsProvisional(chinese), chinese).toBe(false);
    }
  });

  it("does not ask for a caveat at high confidence, whatever language the answer is in", async () => {
    const fit = makeFit({
      results: [{ ...makeFit().results[0]!, confidence: 0.9 }],
    });
    const input = buildAnalysisInput(fit, makeMeasurements());
    const client = new FakeTextModel({
      answer: () =>
        JSON.stringify({
          headline: "很適合你的手。",
          whyTopPick: "長度與你的手很搭。",
          tradeoffs: [],
          whatToAvoid: [],
          caveats: [],
        }),
    });
    const { source } = await analyse(input, client);
    expect(source).toBe("model");
    expect(client.calls).toHaveLength(1);
  });
});
