/**
 * M3 (v3.1 consumers, 未拍板 candidate): while `coverage.lengthOutOfRange` is
 * true the analysis gets no `total`, `band` or `bandMeaning` (and no sub-score
 * `band`), its own prompt and its own fallback, and a cache key of its own;
 * the model's output still may not contain a number the input does not carry.
 * In range nothing changes. The prompt also says when the targets include a
 * personal adjustment (a bare flag; none of the calibration numbers).
 */
import { describe, expect, it } from "vitest";
import type { FitResponse } from "../../src/lib/contracts/fit";
import { en as enBands, zhTW as zhBands } from "../../src/lib/copy/fit-bands";
import {
  analyse,
  buildFallbackOutput,
  buildPrompt,
  collectExemptNames,
} from "../../src/server/analysis/analyse";
import {
  ANALYSIS_PROMPT_VERSION,
  computeCacheKey,
} from "../../src/server/analysis/cache";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import {
  collectNumbers,
  findUnknownNumeral,
} from "../../src/server/analysis/numerals";
import { analysisOutputSchema } from "../../src/server/analysis/schema";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

const OUT: FitResponse = makeFit({
  engineVersion: "fit-v3.0-candidate.0",
  coverage: {
    lengthOutOfRange: true,
    direction: "above",
    usedGripLengthTargetMm: 150.2,
    catalogueLengthRangeMm: [70.4, 138.4],
  },
});
const IN: FitResponse = makeFit({
  engineVersion: "fit-v3.0-candidate.0",
  coverage: {
    lengthOutOfRange: false,
    direction: null,
    usedGripLengthTargetMm: 120.1,
    catalogueLengthRangeMm: [70.4, 138.4],
  },
});
const M = makeMeasurements();
const TOTAL = OUT.results[0]!.total; // 88: nothing else in the input is 88

const dataPart = (prompt: string) =>
  prompt.slice(
    prompt.indexOf("Data:") >= 0
      ? prompt.indexOf("Data:")
      : prompt.indexOf("資料："),
  );

describe("analysis input, hand outside the catalogue's range", () => {
  it.each(["en", "zh-TW"] as const)(
    "carries no total, band or meaning, and says it is unscored (%s)",
    (locale) => {
      const input = buildAnalysisInput(OUT, M, locale);
      expect(input.scoreMode).toBe("unscored");
      for (const entry of input.topPicks) {
        expect(entry).not.toHaveProperty("total");
        expect(entry).not.toHaveProperty("band");
        expect(entry).not.toHaveProperty("bandMeaning");
        for (const sub of Object.values(entry.subscores)) {
          expect(sub).not.toHaveProperty("band");
          // The sub-scores' scores and reason codes stay (the true target;
          // v3.1 decision a); their params do not (contract, coverage).
          expect(sub.impact.length).toBeGreaterThan(0);
          expect(sub.reasonCode).toBeTruthy();
          expect(sub).not.toHaveProperty("params");
        }
      }
      expect(collectNumbers(input).has(TOTAL)).toBe(false);
      expect(JSON.stringify(input)).not.toMatch(
        /coverage|lengthOutOfRange|catalogueLengthRange|usedGripLengthTarget/,
      );
    },
  );

  it("the numbers the model may repeat do not grow when unscored: every number of the unscored input is in the scored one, minus the params", () => {
    const scored = collectNumbers(buildAnalysisInput(IN, M, "en"));
    const unscored = collectNumbers(buildAnalysisInput(OUT, M, "en"));
    for (const n of unscored) expect(scored.has(n)).toBe(true);
    const paramNumbers = Object.values(
      buildAnalysisInput(IN, M, "en").topPicks[0]!.subscores,
    ).flatMap((sub) => Object.values(sub.params ?? {}));
    expect(paramNumbers.length).toBeGreaterThan(0);
    const prompt = dataPart(buildPrompt(buildAnalysisInput(OUT, M, "en")));
    expect(prompt).not.toContain('"params"');
  });

  it("in range the input is the old one: scored, all fields, no new key", () => {
    const input = buildAnalysisInput(IN, M, "en");
    expect(input.topPicks[0]!.subscores.length.params).toBeDefined();
    expect(input).not.toHaveProperty("scoreMode");
    expect(input).not.toHaveProperty("targetsPersonallyAdjusted");
    expect(input.topPicks[0]!.total).toBe(TOTAL);
    expect(input.topPicks[0]!.band).toBe("very_good");
    expect(input.topPicks[0]!.bandMeaning).toBe(
      enBands.bands.very_good.meaning,
    );
  });
});

describe("the unscored prompt", () => {
  it.each(["en", "zh-TW"] as const)(
    "shows the model no total, band or meaning and tells it there is no grade (%s)",
    (locale) => {
      const prompt = buildPrompt(buildAnalysisInput(OUT, M, locale));
      const data = dataPart(prompt);
      for (const key of ['"total"', '"band"', '"meaning"']) {
        expect(data).not.toContain(key);
      }
      for (const band of ["very_good", "good", "fair", "poor"]) {
        expect(data).not.toContain(`"${band}"`);
      }
      const rules = prompt.slice(0, prompt.length - data.length);
      expect(rules).toContain(
        locale === "en" ? "no overall score" : "沒有整體分數",
      );
      // The scored prompt's anchor on a band meaning is gone.
      expect(rules).not.toContain(
        locale === "en"
          ? "starting from its band meaning"
          : "從整體等級的 meaning 出發",
      );
      expect(rules).toContain(
        locale === "en"
          ? "outside the range of sizes"
          : "超出目前目錄涵蓋的尺寸範圍",
      );
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "in range the prompt is the scored one (%s)",
    (locale) => {
      const prompt = buildPrompt(buildAnalysisInput(IN, M, locale));
      expect(dataPart(prompt)).toContain('"total"');
      expect(dataPart(prompt)).toContain('"meaning"');
      expect(prompt).not.toContain(
        locale === "en"
          ? "outside the range of sizes"
          : "超出目前目錄涵蓋的尺寸範圍",
      );
    },
  );

  it("tells the model the targets are personally adjusted only when a shift exists, and the flag carries no number", () => {
    const adjusted: FitResponse = {
      ...OUT,
      calibration: {
        referencesUsed: 2,
        dims: {
          length: { shiftMm: -3.7, answers: 2, conflict: false },
          gripWidth: { shiftMm: 0, answers: 0, conflict: false },
          height: { shiftMm: 0, answers: 0, conflict: false },
        },
      },
    };
    for (const locale of ["en", "zh-TW"] as const) {
      const withShift = buildAnalysisInput(adjusted, M, locale);
      expect(withShift.targetsPersonallyAdjusted).toBe(true);
      expect(collectNumbers(withShift).has(3.7)).toBe(false);
      expect(collectNumbers(withShift).has(-3.7)).toBe(false);
      const prompt = buildPrompt(withShift);
      expect(prompt).toContain(
        locale === "en"
          ? "already include an adjustment"
          : "已經加入依使用者自己持有的滑鼠所做的調整",
      );
      const plain = buildPrompt(buildAnalysisInput(OUT, M, locale));
      expect(plain).not.toContain(
        locale === "en"
          ? "already include an adjustment"
          : "已經加入依使用者自己持有的滑鼠所做的調整",
      );
    }
  });
});

describe("the unscored fallback", () => {
  const GRADE_WORDS = /\b(good|excellent|poor|fair|best)\b/i;
  const GRADE_WORDS_ZH = /非常適合|適合你|勉強可用|不太適合|最適合|最符合/;

  it.each(["en", "zh-TW"] as const)(
    "has no band, meaning, grade word or number the input lacks, and fits the schema (%s)",
    (locale) => {
      const input = buildAnalysisInput(OUT, M, locale);
      const out = buildFallbackOutput(input);
      expect(analysisOutputSchema.safeParse(out).success).toBe(true);
      const text = [
        out.headline,
        out.whyTopPick,
        ...out.tradeoffs,
        ...out.whatToAvoid,
        ...out.caveats,
      ].join("\n");
      const copy = locale === "en" ? enBands : zhBands;
      for (const band of Object.values(copy.bands)) {
        expect(text).not.toContain(band.label);
        expect(text).not.toContain(band.meaning);
      }
      expect(text).not.toMatch(locale === "en" ? GRADE_WORDS : GRADE_WORDS_ZH);
      expect(text).not.toContain(String(TOTAL));
      expect(findMedicalClaimTerm(text)).toBeNull();
      const allowed = collectNumbers(input);
      // The text is checked as written, product name included: the "2" in
      // "Superlight 2" is part of the input's own display name.
      const names = collectExemptNames(input);
      for (const part of text.split("\n")) {
        expect(findUnknownNumeral(part, allowed, new Set(), names)).toBeNull();
      }
      // It names the top pick as the closest in the catalogue.
      expect(out.headline).toContain("G Pro X Superlight 2");
      expect(out.caveats.length).toBeGreaterThan(0);
    },
  );

  it("says nothing of an adjustment unless one exists, and says it when one does", () => {
    const plain = buildFallbackOutput(buildAnalysisInput(OUT, M, "en"));
    const adjusted = buildFallbackOutput({
      ...buildAnalysisInput(OUT, M, "en"),
      targetsPersonallyAdjusted: true,
    });
    expect(plain.caveats.join(" ")).not.toContain("adjustment");
    expect(adjusted.caveats.join(" ")).toContain("adjustment");
  });

  it("in range the fallback is the scored one: it names the band's meaning", () => {
    const out = buildFallbackOutput(buildAnalysisInput(IN, M, "en"));
    expect(out.whyTopPick).toContain(enBands.bands.very_good.meaning);
  });
});

describe("analyse(), unscored: no new numerals, ever", () => {
  const answerWith = (text: string) =>
    JSON.stringify({
      headline: text,
      whyTopPick: "It is the closest in the catalogue.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });

  it("rejects the total the scored mode would have allowed, and serves the fallback", async () => {
    const client = new FakeTextModel({
      answer: () => answerWith(`A fit score of ${TOTAL}.`),
    });
    const scoredInput = buildAnalysisInput(IN, M, "en");
    const scored = await analyse(scoredInput, client);
    // In range the same total is in the input, so the model may restate it.
    expect(scored.source).toBe("model");

    const clientOut = new FakeTextModel({
      answer: () => answerWith(`A fit score of ${TOTAL}.`),
    });
    const unscored = await analyse(buildAnalysisInput(OUT, M, "en"), clientOut);
    expect(unscored.source).toBe("fallback");
    expect(clientOut.calls).toHaveLength(2); // the first answer and the retry
    expect(clientOut.calls[1]!.prompt).toContain(String(TOTAL));
    expect(JSON.stringify(unscored.output)).not.toContain(String(TOTAL));
  });

  it("accepts an answer that uses only numbers the input carries", async () => {
    const client = new FakeTextModel({
      answer: () =>
        answerWith("It is 125 mm long, the closest in the catalogue."),
    });
    const result = await analyse(buildAnalysisInput(OUT, M, "en"), client);
    expect(result.source).toBe("model");
  });
});

describe("the cache key, unscored", () => {
  it("is on version 8 and differs from the scored key of the same scan", () => {
    expect(ANALYSIS_PROMPT_VERSION).toBe(8);
    for (const locale of ["en", "zh-TW"] as const) {
      expect(computeCacheKey(OUT, M, locale)).not.toBe(
        computeCacheKey(IN, M, locale),
      );
    }
  });

  it("does not change with the coverage direction or its numbers (they never reach the input)", () => {
    const below: FitResponse = {
      ...OUT,
      coverage: {
        lengthOutOfRange: true,
        direction: "below",
        usedGripLengthTargetMm: 40.9,
        catalogueLengthRangeMm: [70.4, 138.4],
      },
    };
    expect(computeCacheKey(below, M, "en")).toBe(computeCacheKey(OUT, M, "en"));
  });
});
