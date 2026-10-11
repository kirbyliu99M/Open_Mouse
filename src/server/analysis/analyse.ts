/**
 * Turns engine-made fit numbers into short, structured prose. The LLM never
 * computes (AGENTS.md #2): every number it writes must already be in
 * `AnalysisInput`. `analyse()` enforces that itself, with a bounded retry
 * and a deterministic, non-LLM fallback — it never returns an unverified
 * answer.
 */
import { Type } from "@google/genai";
import type { AnalysisSource } from "../../lib/contracts/analysis";
import type { Locale } from "../../lib/contracts/locale";
import type { ExclusionReason } from "../fit/exclusions";
import { LOG_ROUTES, log } from "../log";
import type { TextModel } from "./client";
import type { AnalysisInput, AnalysisInputEntry } from "./input";
import { analysisOutputSchema, type AnalysisOutput } from "./schema";
import { collectNumbers, findUnknownNumeral, stringTokens } from "./numerals";
import { findMedicalClaimTerm } from "./medicalClaims";
import { mentionsProvisional } from "./provisional";
import { NEGATIVE_REASON_CODES, POSITIVE_REASON_CODES } from "./reasonText";

/** `analyse()`'s result: the prose plus who actually wrote it. */
export interface AnalyseResult {
  output: AnalysisOutput;
  source: AnalysisSource;
}

export interface AnalyseOptions {
  /**
   * Called immediately before EACH actual model call this function makes —
   * once per attempt, up to `MAX_ATTEMPTS` times — so a caller can charge
   * every real call against a shared budget (M2 hardening finding: the
   * site-wide daily model cap in `./handler.ts` used to be consumed once per
   * *request*, but a request can make up to `MAX_ATTEMPTS` real model calls,
   * so the real ceiling was ~2x the configured cap). Returning `false` stops
   * the retry loop immediately, WITHOUT making that call, and serves the
   * deterministic fallback instead — including on the very first attempt,
   * so a budget already exhausted before this request even started never
   * calls the model at all. Omit it to never gate a call.
   */
  beforeModelCall?: () => boolean | Promise<boolean>;
}

/** Plain words for each exclusion, close to what the results page says
 * (`excludedReason` in `src/lib/copy/results-page.ts`). A `Record` so a new reason cannot silently
 * reuse another's text. */
const EXCLUSION_TEXT: Record<ExclusionReason, string> = {
  wrong_hand: "doesn't fit your handedness",
  vertical_form_factor: "vertical shape, excluded from this comparison",
  trackball_form_factor: "trackball, excluded from this comparison",
};

/** zh-TW wording for the same reasons (candidate, 未拍板). No digit, no medical term. */
const EXCLUSION_TEXT_ZH_TW: Record<ExclusionReason, string> = {
  wrong_hand: "是為另一隻手設計的",
  vertical_form_factor: "垂直形狀，不納入這次比較",
  trackball_form_factor: "軌跡球，不納入這次比較",
};

const PROVISIONAL_NOTE =
  "This ranking is provisional: some shape descriptors it depends on are not classified yet.";

/** Names 暫定 (see `./provisional`), which the low-confidence check looks for. */
const PROVISIONAL_NOTE_ZH_TW =
  "這份排名是暫定的：它所依據的部分形狀描述尚未分類。";

function exclusionText(locale: Locale): Record<ExclusionReason, string> {
  return locale === "zh-TW" ? EXCLUSION_TEXT_ZH_TW : EXCLUSION_TEXT;
}

export const MAX_OUTPUT_TOKENS = 400;

const MAX_ATTEMPTS = 2;

/** `@google/genai` structured-output schema mirroring `analysisOutputSchema`. */
export const ANALYSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    whyTopPick: { type: Type.STRING },
    tradeoffs: { type: Type.ARRAY, items: { type: Type.STRING } },
    whatToAvoid: { type: Type.ARRAY, items: { type: Type.STRING } },
    caveats: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["headline", "whyTopPick", "tradeoffs", "whatToAvoid", "caveats"],
};

/**
 * The verbatim display-name tokens the model may legitimately reproduce:
 * brand/model of the top picks AND of the excluded mice — both come from the
 * same `mice` table shape, and both are sent to the model as literal JSON
 * strings it may reasonably name in prose (e.g. "avoid the Lift Vertical, a
 * vertical mouse" for an excluded entry). Gathered explicitly, field by
 * field, from `AnalysisInput`'s known shape — NOT by walking every string in
 * the input. `slug` (kebab-case, e.g. "logitech-g502-x") is deliberately
 * excluded: it is an internal identifier that never appears in prose a user
 * reads, so a model has no legitimate reason to emit it, and exempting it
 * would silently exempt its lowercase digit run too (see `stringTokens` in
 * numerals.ts for the bug this caused). `engineVersion`, `gripStyle`, and
 * reason codes are likewise excluded: they're fixed enum/version strings
 * with no legitimate reason to be echoed as a product name.
 */
function collectExemptTokens(input: AnalysisInput): Set<string> {
  const out = new Set<string>();
  const addNameTokens = (entry: { brand: string; model: string }) => {
    for (const token of stringTokens(entry.brand)) out.add(token);
    for (const token of stringTokens(entry.model)) out.add(token);
  };
  for (const entry of input.topPicks) addNameTokens(entry);
  for (const entry of input.excluded) addNameTokens(entry);
  return out;
}

function isLowConfidence(input: AnalysisInput): boolean {
  const top = input.topPicks[0];
  return top !== undefined && top.lowConfidence;
}

/**
 * Only display facts go into the prompt; identifiers stay in the engine data.
 *
 * Each top pick carries its band and what that band means for using the mouse
 * (`meaning`), and each sub-score its band and what its reason means for how
 * the mouse feels (`impact`). That wording is the anchor the prompt tells the
 * model to explain from. All of it is candidate copy (未拍板) from
 * `src/lib/copy/fit-bands.ts`, English and free of digits.
 */
function promptData(input: AnalysisInput, locale: Locale) {
  return {
    rankingStatus: input.rankingProvisional
      ? // Deliberately avoids the word "provisional": that word is what the
        // low-confidence caveat check looks for (`mentionsProvisional`, which
        // also knows the Chinese markers), and copying this sentence must not
        // satisfy it without saying descriptors are unclassified. A Chinese
        // version of this sentence must avoid 暫定 / 暂定 / 初步 too.
        locale === "zh-TW"
        ? "合手度的計算設定，尚未用實際持有者的評價核對過。"
        : "Fit settings have not yet been validated against owner ratings."
      : undefined,
    // Same rule for this one: it must not contain a provisional marker either
    // (a test pins that), or copying it would satisfy the low-confidence check.
    estimateNote: input.estimateNote,
    gripStyle: input.gripStyle,
    targets: input.targets,
    hand: input.hand,
    excluded: input.excluded.map(({ brand, model, reason }) => ({
      brand,
      model,
      reason: exclusionText(locale)[reason],
    })),
    topPicks: input.topPicks.map((entry) => ({
      rank: entry.rank,
      brand: entry.brand,
      model: entry.model,
      lengthMm: entry.lengthMm,
      widthMm: entry.widthMm,
      heightMm: entry.heightMm,
      weightG: entry.weightG,
      total: entry.total,
      band: entry.band,
      meaning: entry.bandMeaning,
      confidencePercent: entry.confidencePercent,
      subscores: Object.fromEntries(
        Object.entries(entry.subscores).map(([key, sub]) => [
          key,
          {
            score: sub.score,
            band: sub.band,
            impact: sub.impact,
            params: sub.params,
          },
        ]),
      ),
    })),
  };
}

/**
 * The base prompt: the compact JSON plus the hard rules. Exported so tests
 * can assert on its content (e.g. that low confidence adds the provisional
 * instruction) without re-deriving it.
 */
export function buildPrompt(input: AnalysisInput): string {
  if (input.locale === "zh-TW") return buildPromptZhTw(input);
  const lines = [
    "You are writing a short analysis of a mouse-fit ranking for a user, from the JSON data below.",
    "Explain how the top pick will feel to use for this hand. Do not just restate the scores.",
    "Rules:",
    '- Every number you write MUST already appear in the JSON data. Never compute, estimate, round differently, or invent a number. Number words count as numbers (for example "two" or "half").',
    '- Anchor on the wording in the data: each top pick has a "meaning" for its overall band, and each sub-score has an "impact" sentence. Say what they say, in plain words of your own, and do not add claims they do not make.',
    '- "headline": one short sentence on how the top pick will feel overall, starting from its band meaning.',
    '- "whyTopPick": one or two short sentences on the one or two things that matter most for this hand and this mouse, taken from the sub-scores with the most to say, and what to expect when using it.',
    '- "tradeoffs" (up to three): what may take getting used to, taken from the sub-scores in a lower band.',
    '- "whatToAvoid" (up to two): what to look for in another mouse, or an excluded mouse and why it was left out. Name a mouse only if it is in the data.',
    '- "caveats": include one short line saying this is an estimate from the hand measurements, using the "estimateNote" wording as written or close to it.',
    '- Keep every line short. Describe use experience only (reach, grip, where the palm and fingers rest, how a long session may feel), with "may" and "tends to". Never state a certainty.',
    "- Do not say how accurate or reliable the estimate is, and do not promise an outcome.",
    "- Do not compare with other people, other users' scores, averages, or percentiles.",
    '- Do not grade the fit in your own words (no "good fit", "bad fit", "excellent", "poor", "high score", "low score"). Use only the band meaning and impact wording supplied.',
    "- Write plainly for someone who has not seen the JSON.",
    "- Never mention internal identifiers, reason codes, band names, or version strings. Describe the facts in plain language.",
    "- If a grip style was stated, describe it as the user's choice, not a prediction.",
    "- Never make medical, diagnostic, therapeutic, or injury-prevention claims. Do not claim a mouse prevents or reduces strain or injury, or relieves pain.",
    "- Do not mention carpal tunnel syndrome, CTS, RSI, tendinitis, tendonitis, pain relief, or other health conditions. Do not call a mouse ergonomic, wrist-friendly, healthier, or safer for the body.",
    "- Describe only shape facts and how they affect use, such as vertical grip, taller hump, or wider shell. Never repeat vendor marketing copy about wrist health.",
    '- For an asymmetric, right-hand sculpted shape, say "asymmetric right-hand shape", not "ergonomic".',
  ];
  if (isLowConfidence(input)) {
    lines.push(
      '- The top pick has low confidence: some shape descriptors it depends on are not classified yet. Say explicitly that the ranking and descriptors are provisional, and the "caveats" array must mention it.',
    );
  }
  lines.push("", "Data:", JSON.stringify(promptData(input, "en")));
  return lines.join("\n");
}

/**
 * The zh-TW prompt (candidate wording, 未拍板): the same rules as the English
 * one, in Traditional Chinese as used in Taiwan. Brand and model names stay
 * verbatim. At low confidence it asks for 暫定 by name, which is the marker
 * `mentionsProvisional` looks for; the `rankingStatus` sentence in the data
 * deliberately carries none of that check's markers (see `./provisional`).
 */
function buildPromptZhTw(input: AnalysisInput): string {
  const lines = [
    "你要根據下方的 JSON 資料，為使用者寫一段簡短的滑鼠合手度排名分析。",
    "請用繁體中文（台灣用語）寫出每一個欄位。滑鼠的品牌與型號保持原文，不要翻譯。",
    "說明排名第一的滑鼠用起來會是什麼感覺，不要只是重述分數。",
    "規則：",
    "- 你寫出的每一個數字都必須已經出現在 JSON 資料中。不可計算、估算、換一種方式四捨五入或自創數字。數字的中文寫法也算數字（例如「兩」「三成」「一半」「百分之五十」）。",
    "- 以資料中的文字為準：每個排名靠前的滑鼠都有整體等級的「meaning」，每個子分數都有一句「impact」。用你自己的白話說出它們的意思，不要加上它們沒有說的內容。",
    '- "headline"：一句簡短的話，從整體等級的 meaning 出發，說明排名第一的滑鼠整體用起來的感覺。',
    '- "whyTopPick"：一到兩句簡短的話，從最值得一提的子分數，說明對你的手和這支滑鼠最重要的一兩件事，以及使用時可以預期什麼。',
    '- "tradeoffs"（最多三項）：可能需要適應的地方，取自等級較低的子分數。',
    '- "whatToAvoid"（最多兩項）：挑選其他滑鼠時要留意什麼，或說明某支被排除的滑鼠為何被排除。只能提到資料中出現的滑鼠。',
    '- "caveats"：包含一句簡短的話，說明這是依手部尺寸做的估算，用資料中「estimateNote」的說法，或相近的說法。',
    "- 每一句都要簡短。只描述使用感受（搆得到的距離、握法、手掌與手指放哪裡、長時間使用可能的感覺），用「可能」「容易」「往往」這類語氣，絕不用肯定、斷定的說法。",
    "- 不要說這個估算有多準確或多可靠，也不要承諾任何結果。",
    "- 不要和其他人、其他使用者的分數、平均值或百分位數比較。",
    "- 不要用自己的話替合手程度打分（不要寫「很適合」「不適合」「很棒」「很差」「高分」「低分」）。只用資料提供的等級說明（meaning）與 impact 的說法。",
    "- 用平實的話寫，讓沒看過 JSON 的人也看得懂。",
    "- 不要提到內部識別碼、原因代碼、等級代號（例如 very_good）或版本字串。用白話描述事實。",
    "- 如果資料中有使用者指定的握法，要寫成使用者自己的選擇，不是預測。",
    "- 絕不做醫療、診斷、治療或預防傷害的說法。不要說滑鼠能預防或減輕勞損、傷害，也不要說能舒緩疼痛。",
    "- 不要提到腕隧道症候群、滑鼠手、肌腱炎、腱鞘炎、重複性勞損、痠痛、疼痛緩解，或其他健康狀況。不要說滑鼠符合人體工學、對手腕友善、護腕、更健康或對身體更安全。",
    "- 只描述形狀的事實，以及它們如何影響使用，例如垂直握法、較高的拱起、較寬的外殼。絕不複述廠商關於手腕健康的行銷文案。",
    "- 對於不對稱的右手造型，寫「偏向右手的不對稱造型」，不要寫「人體工學」。",
  ];
  if (isLowConfidence(input)) {
    lines.push(
      '- 排名第一的滑鼠信心偏低：它所依據的部分形狀描述尚未分類。請明確用「暫定」這個詞，說明這份排名與形狀描述是暫定的，而且 "caveats" 陣列中必須提到。',
    );
  }
  lines.push("", "資料：", JSON.stringify(promptData(input, "zh-TW")));
  return lines.join("\n");
}

function retryPromptZhTw(basePrompt: string, violation: string): string {
  if (violation.startsWith("medical claim: ")) {
    return `${basePrompt}\n\n你上一次的回答用了禁止的醫療或健康用語（${violation.slice("medical claim: ".length)}）。請只用形狀的事實重寫完整的回答，不要有任何醫療、診斷、治療、預防傷害或身體安全的說法。`;
  }
  if (violation.startsWith("(missing)")) {
    return `${basePrompt}\n\n你上一次的回答缺少必要的內容：沒有在 "caveats" 中說明這份排名是暫定的。請重寫完整的回答，並在 "caveats" 中明確寫出「暫定」。`;
  }
  if (violation.startsWith("(")) {
    return `${basePrompt}\n\n你上一次的回答格式不符合規定。請依規定的格式重寫完整的回答。`;
  }
  const what =
    violation === "NaN"
      ? "一個特殊的數字符號（圈起來的、羅馬或其他特殊數字記號）"
      : `數字 ${violation}`;
  return `${basePrompt}\n\n你上一次的回答用了${what}，但它沒有出現在上方的資料中。回答裡的每一個數字都必須原樣來自資料。請重寫完整的回答，不要自創任何新數字。`;
}

function retryPrompt(
  basePrompt: string,
  violation: string,
  locale: Locale,
): string {
  if (locale === "zh-TW") return retryPromptZhTw(basePrompt, violation);
  if (violation.startsWith("medical claim: ")) {
    return `${basePrompt}\n\nYour previous answer used a prohibited medical or health term (${violation.slice("medical claim: ".length)}). Rewrite the full answer using only shape facts, with no medical, diagnostic, therapeutic, injury-prevention, or body-safety claims.`;
  }
  // `findUnknownNumeral` reports a numeral symbol it cannot read (❺, ⓴, Ⅴ...)
  // as NaN: there is no value to name, but the symbol is still a number.
  const what =
    violation === "NaN"
      ? "a numeral symbol (a circled, dingbat, Roman or other special number sign)"
      : `the number ${violation}`;
  return `${basePrompt}\n\nYour previous answer used ${what}, which does not appear anywhere in the Data above. Every number in your answer MUST come from Data verbatim. Rewrite your full answer without inventing any new numbers.`;
}

/**
 * Finds a reason `analyse()` should not accept a candidate output as-is:
 * a medical term, a numeral not traceable to the input, or a missing provisional caveat
 * when confidence is low. Returns a human-readable violation description,
 * or null when the output is acceptable.
 */
function findViolation(
  candidate: AnalysisOutput,
  input: AnalysisInput,
  allowedNumbers: ReadonlySet<number>,
  exemptTokens: ReadonlySet<string>,
): string | null {
  const fields = [
    candidate.headline,
    candidate.whyTopPick,
    ...candidate.tradeoffs,
    ...candidate.whatToAvoid,
    ...candidate.caveats,
  ];
  for (const text of fields) {
    const medicalTerm = findMedicalClaimTerm(text);
    if (medicalTerm !== null) return `medical claim: ${medicalTerm}`;
    const unknown = findUnknownNumeral(text, allowedNumbers, exemptTokens);
    if (unknown !== null) return String(unknown);
  }
  if (isLowConfidence(input)) {
    // In whichever language the model answered: see ./provisional.
    if (!candidate.caveats.some(mentionsProvisional)) {
      return "(missing) a caveat noting the ranking is provisional";
    }
  }
  return null;
}

/**
 * The impact sentences (what a reason means for how the mouse feels) of the
 * top pick's sub-scores whose reason is in `codes`, in sub-score order, each
 * sentence once.
 */
function describeReasons(
  entry: AnalysisInputEntry,
  codes: ReadonlySet<string>,
  limit: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sub of Object.values(entry.subscores)) {
    if (!codes.has(sub.reasonCode)) continue;
    if (seen.has(sub.impact)) continue;
    seen.add(sub.impact);
    out.push(sub.impact);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Deterministic, non-LLM answer built purely from what is already in the
 * input: the top pick's band meaning and the impact sentences of its reason
 * codes, so the fallback reads in use-experience terms like the prompt asks
 * the model to. Used when no model is configured, the call fails, or the model
 * can't produce output that respects the no-new-numerals and no-medical-claims
 * rules after a retry. Never invents a number: every sentence comes from
 * `src/lib/copy/fit-bands.ts` and carries no digit (a test pins that).
 */
export function buildFallbackOutput(input: AnalysisInput): AnalysisOutput {
  if (input.locale === "zh-TW") return buildFallbackOutputZhTw(input);
  const top = input.topPicks[0];
  if (!top) {
    return {
      headline: "No mice matched your measurements.",
      whyTopPick: "No candidates were available to rank.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    };
  }
  const positives = describeReasons(top, POSITIVE_REASON_CODES, 2);
  const tradeoffs = describeReasons(top, NEGATIVE_REASON_CODES, 3);
  // A `poor` top pick is still rank 1, but "the top match" next to "look at
  // other mice first" contradicts itself. It says what the results page says
  // ("None of these fits your hand well. The closest is below."), with the
  // name. `fair` keeps "top match": its meaning does not tell the reader to
  // look elsewhere. Candidate wording (未拍板).
  const headline =
    top.band === "poor"
      ? `None of these fits your hand well. The closest is ${top.brand} ${top.model}.`
      : `${top.brand} ${top.model} is the top match for your hand.`;
  const whyTopPick = [top.bandMeaning, ...positives].join(" ");
  const whatToAvoid = input.excluded
    .map(
      ({ brand, model, reason }) =>
        `${brand} ${model}: ${EXCLUSION_TEXT[reason]}.`,
    )
    .slice(0, 2);
  const caveats: string[] = [];
  if (top.lowConfidence) {
    caveats.push(PROVISIONAL_NOTE);
  }
  caveats.push(input.estimateNote);
  return { headline, whyTopPick, tradeoffs, whatToAvoid, caveats };
}

/**
 * The zh-TW fallback (candidate wording, 未拍板): the same shape as the English
 * one, every sentence from `src/lib/copy/fit-bands.ts` (`zhTW`, no digit) or
 * the digit-free strings above; the only numerals that can appear are those in
 * brand and model names, which come from the input.
 */
function buildFallbackOutputZhTw(input: AnalysisInput): AnalysisOutput {
  const top = input.topPicks[0];
  if (!top) {
    return {
      headline: "沒有找到符合你測量結果的滑鼠。",
      whyTopPick: "沒有可供排名的候選滑鼠。",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    };
  }
  const positives = describeReasons(top, POSITIVE_REASON_CODES, 2);
  const tradeoffs = describeReasons(top, NEGATIVE_REASON_CODES, 3);
  const headline =
    top.band === "poor"
      ? `這幾款都不太適合你的手，最接近的是 ${top.brand} ${top.model}。`
      : `${top.brand} ${top.model} 是最符合你手型的一款。`;
  const whyTopPick = [top.bandMeaning, ...positives].join("");
  const whatToAvoid = input.excluded
    .map(
      ({ brand, model, reason }) =>
        `${brand} ${model}：${EXCLUSION_TEXT_ZH_TW[reason]}。`,
    )
    .slice(0, 2);
  const caveats: string[] = [];
  if (top.lowConfidence) caveats.push(PROVISIONAL_NOTE_ZH_TW);
  caveats.push(input.estimateNote);
  return { headline, whyTopPick, tradeoffs, whatToAvoid, caveats };
}

/**
 * Calls the model, validates its structured output, and enforces the
 * no-new-numerals and no-medical-claims rules. Retries once, naming the violation; a second
 * violation returns the deterministic fallback instead of ever surfacing
 * unverified model output.
 *
 * `client` is `null` when no model is configured (`createAnalysisModel`
 * returned `null` — no `GEMINI_API_KEY`): this goes straight to the
 * fallback and makes no network call.
 *
 * `source` in the returned `AnalyseResult` is `"model"` in exactly one
 * place below — the branch where a model response was received, passed
 * `analysisOutputSchema`, AND passed `findViolation`'s output checks
 * check. Every other path (no model, JSON parse failure, schema failure,
 * a numeral, provisional-caveat, or medical-claim violation on both attempts, or
 * `options.beforeModelCall` refusing a call) returns `buildFallbackOutput`
 * with `source: "fallback"`. Never inferred from whether a key was
 * configured — a keyed call can still fail or violate the rule and fall
 * back, which is exactly what this function's retry loop exists to handle.
 */
export async function analyse(
  input: AnalysisInput,
  client: TextModel | null,
  options: AnalyseOptions = {},
): Promise<AnalyseResult> {
  const locale = input.locale;
  if (client === null) {
    return { output: buildFallbackOutput(input), source: "fallback" };
  }

  const allowedNumbers = collectNumbers(input);
  const exemptTokens = collectExemptTokens(input);
  const basePrompt = buildPrompt(input);
  let prompt = basePrompt;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (options.beforeModelCall) {
      // M2: charge THIS attempt against the shared budget before making the
      // call it gates. A `false` here (budget exhausted, whether before the
      // first attempt or before the retry) stops the loop outright — no
      // more model calls this request — and serves the fallback, same as
      // every other "can't produce a trustworthy answer" path above.
      const allowed = await options.beforeModelCall();
      if (!allowed) {
        return {
          output: buildFallbackOutput(input),
          source: "fallback",
        };
      }
    }
    let raw: string;
    const callStartedAt = Date.now();
    try {
      raw = await client.generate({
        prompt,
        schema: ANALYSIS_RESPONSE_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      // The call itself failed — an API error, a timeout, the network. The
      // retry loop below exists for a response that came back unusable; a
      // failed call is not fixed by rephrasing the prompt, so stop and give
      // the reader the deterministic answer instead of an error. Before this
      // guard, one rejected request config turned every analysis into a 500.
      // Log the status only. The SDK puts the whole API response body in
      // `error.message`, and a response that echoes the request could carry
      // hand measurements into logs that outlive the 24-hour promise.
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? String((error as { status: unknown }).status)
          : "none";
      log.error("analysis.model_call_failed", {
        route: LOG_ROUTES.analysis,
        ms: Date.now() - callStartedAt,
        status,
        action: "serve_fallback",
      });
      return { output: buildFallbackOutput(input), source: "fallback" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      prompt = retryPrompt(
        basePrompt,
        "(the response was not valid JSON)",
        locale,
      );
      continue;
    }
    const result = analysisOutputSchema.safeParse(parsed);
    if (!result.success) {
      prompt = retryPrompt(
        basePrompt,
        "(the response didn't match the expected shape)",
        locale,
      );
      continue;
    }
    const violation = findViolation(
      result.data,
      input,
      allowedNumbers,
      exemptTokens,
    );
    if (violation === null) return { output: result.data, source: "model" };
    prompt = retryPrompt(basePrompt, violation, locale);
  }

  return { output: buildFallbackOutput(input), source: "fallback" };
}
