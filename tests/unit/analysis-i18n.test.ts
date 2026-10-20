import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  analyse,
  buildFallbackOutput,
  buildPrompt,
} from "../../src/server/analysis/analyse";
import {
  InMemoryAnalysisCache,
  computeCacheKey,
} from "../../src/server/analysis/cache";
import { handleAnalysisRequest } from "../../src/server/analysis/handler";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { localeFromRequestHeaders } from "../../src/server/analysis/locale";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import { mentionsProvisional } from "../../src/server/analysis/provisional";
import {
  collectNumbers,
  findUnknownNumeral,
  stringTokens,
} from "../../src/server/analysis/numerals";
import { computeAnalysisForScan } from "../../src/server/analysis/service";
import { analysisOutputSchema } from "../../src/server/analysis/schema";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";

const lowFit = () => makeFit({ results: [makeEntry({ confidence: 0.2 })] });
const inputFor = (locale: "en" | "zh-TW", fit = makeFit()) =>
  buildAnalysisInput(fit, makeMeasurements(), locale);

describe("localeFromRequestHeaders", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("the cookie wins over Accept-Language", () => {
    expect(
      localeFromRequestHeaders(
        h({ cookie: "a=b; om_locale=en", "accept-language": "zh-TW" }),
      ),
    ).toBe("en");
    expect(
      localeFromRequestHeaders(
        h({ cookie: "om_locale=zh-TW", "accept-language": "en" }),
      ),
    ).toBe("zh-TW");
  });
  it("an invalid cookie falls through to Accept-Language", () => {
    expect(
      localeFromRequestHeaders(
        h({ cookie: "om_locale=fr", "accept-language": "en-US,en;q=0.9" }),
      ),
    ).toBe("en");
  });
  it("defaults to zh-TW with no cookie and no header", () => {
    expect(localeFromRequestHeaders(h({}))).toBe("zh-TW");
  });
});

const baseline = JSON.parse(
  readFileSync("tests/unit/fixtures/analysis-prompt-en.json", "utf8"),
) as { normal: string; lowConfidence: string };

describe("the en prompt is unchanged", () => {
  it("matches the prompt recorded before the zh-TW work", () => {
    expect(buildPrompt(inputFor("en"))).toBe(baseline.normal);
    expect(buildPrompt(inputFor("en", lowFit()))).toBe(baseline.lowConfidence);
  });
});

describe("the zh-TW prompt", () => {
  const prompt = buildPrompt(inputFor("zh-TW"));
  it("asks for Traditional Chinese (Taiwan) and verbatim names", () => {
    expect(prompt).toContain("繁體中文（台灣用語）");
    expect(prompt).toContain("品牌與型號保持原文");
  });
  it("carries Chinese band wording and the Chinese rankingStatus", () => {
    expect(prompt).toContain("尺寸與握法大致吻合");
    expect(prompt).toContain("合手度的計算設定，尚未用實際持有者的評價核對過");
    expect(prompt).toContain("垂直形狀，不納入這次比較");
  });
  it("the rankingStatus and estimate note carry no provisional marker", () => {
    expect(
      mentionsProvisional("合手度的計算設定，尚未用實際持有者的評價核對過。"),
    ).toBe(false);
    expect(mentionsProvisional(inputFor("zh-TW").estimateNote)).toBe(false);
  });
  it("asks for 暫定 by name only at low confidence", () => {
    expect(prompt).not.toContain("暫定");
    expect(buildPrompt(inputFor("zh-TW", lowFit()))).toContain("「暫定」");
  });
  it("uses the wording Kirby's reviewers asked for", () => {
    expect(prompt).toContain("偏向右手的不對稱造型");
    expect(prompt).toContain("百分位數");
    expect(prompt).toContain("滑鼠手");
    expect(prompt).not.toContain("適配");
  });
  it("names the hump 「駝峰」 and keeps the old wordings out", () => {
    expect(prompt).toContain("一律稱為「駝峰」");
    expect(prompt).not.toContain("背弧");
    expect(prompt).not.toContain("拱背");
  });
});

describe("the zh-TW fallback", () => {
  it("is Chinese, passes the schema and every output check", async () => {
    for (const fit of [makeFit(), lowFit()]) {
      const input = inputFor("zh-TW", fit);
      const output = buildFallbackOutput(input);
      expect(analysisOutputSchema.safeParse(output).success).toBe(true);
      expect(output.whatToAvoid).toEqual([
        "Logitech Lift Vertical：垂直形狀，不納入這次比較。",
      ]);
      expect(output.headline).toBe(
        "Logitech G Pro X Superlight 2 是最符合你手型的一款。",
      );
      const exempt = new Set(
        [...input.topPicks, ...input.excluded].flatMap((e) => [
          ...stringTokens(e.brand),
          ...stringTokens(e.model),
        ]),
      );
      const texts = [
        output.headline,
        output.whyTopPick,
        ...output.tradeoffs,
        ...output.whatToAvoid,
        ...output.caveats,
      ];
      for (const t of texts) {
        expect(findMedicalClaimTerm(t)).toBeNull();
        expect(findUnknownNumeral(t, collectNumbers(input), exempt)).toBeNull();
      }
      const client = new FakeTextModel({
        answer: () => JSON.stringify(output),
      });
      const result = await analyse(input, client);
      expect(result.source).toBe("model");
    }
  });
  it("low confidence names 暫定", () => {
    const out = buildFallbackOutput(inputFor("zh-TW", lowFit()));
    expect(out.caveats.some(mentionsProvisional)).toBe(true);
  });
  it("is served in Chinese when there is no model", async () => {
    const none = await analyse(inputFor("zh-TW"), null);
    expect(none.source).toBe("fallback");
    expect(none.output.headline).toContain("最符合你手型");
  });
});

describe("the zh-TW retry prompts", () => {
  const answer = (fields: Partial<Record<string, unknown>>) =>
    JSON.stringify({
      headline: "x",
      whyTopPick: "x",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
      ...fields,
    });
  async function retryOf(raw: string, fit = makeFit()) {
    const client = new FakeTextModel({ answer: () => raw });
    const res = await analyse(inputFor("zh-TW", fit), client);
    expect(res.source).toBe("fallback");
    expect(client.calls).toHaveLength(2);
    return client.calls[1]!.prompt;
  }
  it("names an invented number in Chinese", async () => {
    expect(await retryOf(answer({ headline: "有 999 個按鍵。" }))).toContain(
      "數字 999",
    );
  });
  it("names a medical term in Chinese", async () => {
    const p = await retryOf(answer({ headline: "可以治療手腕不適。" }));
    expect(p).toContain("你上一次的回答用了禁止的醫療或健康用語（");
  });
  it("asks for 暫定 in Chinese, with no English violation text", async () => {
    const p = await retryOf(answer({ caveats: ["僅供參考。"] }), lowFit());
    expect(p).toContain(
      '沒有在 "caveats" 中說明這份排名是暫定的。請重寫完整的回答，並在 "caveats" 中明確寫出「暫定」。',
    );
    expect(p).not.toContain("(missing)");
    expect(p).not.toContain("provisional");
  });
  it.each(["not json", "{}"])(
    "uses a Chinese label for a malformed answer (%s)",
    async (raw) => {
      const p = await retryOf(raw);
      expect(p).toContain("你上一次的回答格式不符合規定");
      expect(p).not.toContain("the response");
    },
  );
});

describe("Chinese medical terms are rejected", () => {
  it.each([
    "治療",
    "醫生",
    "診斷",
    "預防手腕傷害",
    "腕隧道症候群",
    "肌腱炎",
    "滑鼠手",
    "腱鞘炎",
  ])("%s", (term) => {
    expect(findMedicalClaimTerm(`這支滑鼠可以幫助${term}。`)).not.toBeNull();
  });
});

describe("cache keys", () => {
  it("zh-TW and en differ for the same scan input", () => {
    const fit = makeFit();
    const m = makeMeasurements();
    expect(computeCacheKey(fit, m, "zh-TW")).not.toBe(
      computeCacheKey(fit, m, "en"),
    );
  });
  it("the en key of a scored input is pinned (prompt version 10, score mode scored)", () => {
    // Pinned at v3.1 (M3): the version went 6 -> 7 and the key now carries the
    // score mode, so the old value (version 6) could not stay. Version 8 (the
    // unscored mode loses its sub-score params) moved it again, and
    // versions 9 and 10 (A1-01 name check, A1-02 unscored output check) once
    // more. A scored input reads the same prompt as before; only the key moved.
    expect(computeCacheKey(makeFit(), makeMeasurements(), "en")).toBe(
      "6e5d443d55a4dfeba94a5b2edb7f7852077cbec705624cc2c612242af61ed353",
    );
  });
});

describe("the handler caches per locale", () => {
  const EN = JSON.stringify({
    headline: "A match.",
    whyTopPick: "It suits your hand.",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [],
  });
  const ZH = JSON.stringify({
    headline: "很可能是個合手的選擇。",
    whyTopPick: "握起來通常自然。",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [],
  });
  it("a cached row for one locale is never served to the other", async () => {
    const client = new FakeTextModel({
      answer: ({ prompt }) => (prompt.includes("繁體中文") ? ZH : EN),
    });
    const cache = new InMemoryAnalysisCache();
    const deps = {
      client,
      cache,
      limiter: { allow: () => true },
      globalLimiter: { allow: () => true },
    };
    const request = {
      scanId: "scan-a",
      fit: makeFit(),
      measurements: makeMeasurements(),
      rateLimitKey: "ip-1",
    };
    const zh1 = await handleAnalysisRequest(
      { ...request, locale: "zh-TW" },
      deps,
    );
    expect(zh1.body).toMatchObject({ cached: false, source: "model" });
    const en1 = await handleAnalysisRequest({ ...request, locale: "en" }, deps);
    expect(en1.body).toMatchObject({ cached: false, source: "model" });
    expect(client.calls).toHaveLength(2);
    const zh2 = await handleAnalysisRequest(
      { ...request, locale: "zh-TW" },
      deps,
    );
    const en2 = await handleAnalysisRequest({ ...request, locale: "en" }, deps);
    expect(zh2.body).toMatchObject({ cached: true });
    expect(en2.body).toMatchObject({ cached: true });
    expect(client.calls).toHaveLength(2);
    expect(JSON.stringify(zh2.body)).toContain("合手");
    expect(JSON.stringify(en2.body)).not.toContain("合手");
  });
});

describe("the route reads the locale", () => {
  const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
  async function run(headers: Record<string, string>) {
    const client = new FakeTextModel({ answer: () => "{}" });
    const { repo: fitRepo } = createFakeFitRepo();
    const cache = new InMemoryAnalysisCache();
    const get = vi.spyOn(cache, "get");
    const res = await computeAnalysisForScan(
      new Request(`http://localhost/api/scans/${SCAN_ID}/analysis`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{}",
      }),
      SCAN_ID,
      {
        scanRepo: createFakeScanRepo(vi.fn(async () => sampleOwnedScan)),
        fitRepo,
        client,
        cache,
        limiter: { allow: () => true },
        globalLimiter: { allow: () => true },
        getUserId: async () => null,
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: { headline: string } };
    return {
      client,
      key: get.mock.calls[0]![1],
      headline: body.output.headline,
    };
  }
  it("a zh-TW cookie reaches analyse(): the prompt and the response are Chinese", async () => {
    const zh = await run({ cookie: "om_locale=zh-TW" });
    expect(zh.client.calls[0]!.prompt).toContain("繁體中文（台灣用語）");
    expect(zh.headline).toMatch(/[一-鿿]/u);
    const en = await run({ cookie: "om_locale=en" });
    expect(en.client.calls[0]!.prompt).toContain("You are writing a short");
    expect(en.headline).not.toMatch(/[一-鿿]/u);
    expect(zh.key).not.toBe(en.key);
  });
  it("Accept-Language decides without a cookie", async () => {
    const r = await run({ "accept-language": "en-US,en;q=0.9" });
    expect(r.client.calls[0]!.prompt).toContain("You are writing a short");
  });
});
