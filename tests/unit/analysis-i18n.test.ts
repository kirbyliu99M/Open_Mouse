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

describe("the en prompt is unchanged", () => {
  const baseline = JSON.parse(
    readFileSync("tests/unit/fixtures/analysis-prompt-en.json", "utf8"),
  ) as { normal: string; lowConfidence: string };
  it("matches the prompt recorded before the zh-TW work", () => {
    expect(buildPrompt(inputFor("en"), "en")).toBe(baseline.normal);
    expect(buildPrompt(inputFor("en"))).toBe(baseline.normal);
    expect(buildPrompt(inputFor("en", lowFit()), "en")).toBe(
      baseline.lowConfidence,
    );
  });
});

describe("the zh-TW prompt", () => {
  const prompt = buildPrompt(inputFor("zh-TW"), "zh-TW");
  it("asks for Traditional Chinese (Taiwan) and verbatim names", () => {
    expect(prompt).toContain("繁體中文（台灣用語）");
    expect(prompt).toContain("品牌與型號保持原文");
  });
  it("carries Chinese band wording and the Chinese rankingStatus", () => {
    expect(prompt).toContain("尺寸與握法大致吻合");
    expect(prompt).toContain("適配設定尚未與使用者的評價比對驗證");
    expect(prompt).toContain("垂直形狀，不納入這次比較");
  });
  it("the rankingStatus and estimate note carry no provisional marker", () => {
    expect(mentionsProvisional("適配設定尚未與使用者的評價比對驗證。")).toBe(
      false,
    );
    expect(mentionsProvisional(inputFor("zh-TW").estimateNote)).toBe(false);
  });
  it("asks for 暫定 by name only at low confidence", () => {
    expect(prompt).not.toContain("暫定");
    expect(buildPrompt(inputFor("zh-TW", lowFit()), "zh-TW")).toContain(
      "「暫定」",
    );
  });
});

describe("the zh-TW fallback", () => {
  it("is Chinese, passes the schema and every output check", async () => {
    for (const fit of [makeFit(), lowFit()]) {
      const input = inputFor("zh-TW", fit);
      const output = buildFallbackOutput(input, "zh-TW");
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
      const result = await analyse(input, client, { locale: "zh-TW" });
      expect(result.source).toBe("model");
    }
  });
  it("low confidence names 暫定", () => {
    const out = buildFallbackOutput(inputFor("zh-TW", lowFit()), "zh-TW");
    expect(out.caveats.some(mentionsProvisional)).toBe(true);
  });
  it("is served in Chinese when there is no model, and the retry is Chinese", async () => {
    const input = inputFor("zh-TW");
    const none = await analyse(input, null, { locale: "zh-TW" });
    expect(none.source).toBe("fallback");
    expect(none.output.headline).toContain("最符合你手型");
    const bad = JSON.stringify({
      headline: "這支滑鼠有 999 個按鍵。",
      whyTopPick: "x",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => bad });
    const res = await analyse(input, client, { locale: "zh-TW" });
    expect(res.source).toBe("fallback");
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("數字 999");
  });
});

describe("Chinese medical terms are rejected", () => {
  it.each(["治療", "醫生", "診斷", "預防手腕傷害", "腕隧道症候群", "肌腱炎"])(
    "%s",
    (term) => {
      expect(findMedicalClaimTerm(`這支滑鼠可以幫助${term}。`)).not.toBeNull();
    },
  );
});

describe("cache keys", () => {
  it("zh-TW and en differ for the same scan input; en is stable", () => {
    const fit = makeFit();
    const m = makeMeasurements();
    expect(computeCacheKey(fit, m, "zh-TW")).not.toBe(
      computeCacheKey(fit, m, "en"),
    );
    expect(computeCacheKey(fit, m)).toBe(computeCacheKey(fit, m, "en"));
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
    return { client, key: get.mock.calls[0]![1] };
  }
  it("a zh-TW cookie reaches analyse(): the prompt is Chinese", async () => {
    const zh = await run({ cookie: "om_locale=zh-TW" });
    expect(zh.client.calls[0]!.prompt).toContain("繁體中文（台灣用語）");
    const en = await run({ cookie: "om_locale=en" });
    expect(en.client.calls[0]!.prompt).toContain("You are writing a short");
    expect(zh.key).not.toBe(en.key);
  });
  it("Accept-Language decides without a cookie", async () => {
    const r = await run({ "accept-language": "en-US,en;q=0.9" });
    expect(r.client.calls[0]!.prompt).toContain("You are writing a short");
  });
});
