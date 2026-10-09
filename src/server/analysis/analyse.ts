/**
 * Turns engine-made fit numbers into short, structured prose. The LLM never
 * computes (AGENTS.md #2): every number it writes must already be in
 * `AnalysisInput`. `analyse()` enforces that itself, with a bounded retry
 * and a deterministic, non-LLM fallback — it never returns an unverified
 * answer.
 */
import { Type } from "@google/genai";
import type { AnalysisSource } from "../../lib/contracts/analysis";
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

const PROVISIONAL_NOTE =
  "This ranking is provisional: some shape descriptors it depends on are not classified yet.";

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
function promptData(input: AnalysisInput) {
  return {
    rankingStatus: input.rankingProvisional
      ? // Deliberately avoids the word "provisional": that word is what the
        // low-confidence caveat check looks for (`mentionsProvisional`, which
        // also knows the Chinese markers), and copying this sentence must not
        // satisfy it without saying descriptors are unclassified. A Chinese
        // version of this sentence must avoid 暫定 / 暂定 / 初步 too.
        "Fit settings have not yet been validated against owner ratings."
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
      reason: EXCLUSION_TEXT[reason],
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
  lines.push("", "Data:", JSON.stringify(promptData(input)));
  return lines.join("\n");
}

function retryPrompt(basePrompt: string, violation: string): string {
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
        return { output: buildFallbackOutput(input), source: "fallback" };
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
      prompt = retryPrompt(basePrompt, "(the response was not valid JSON)");
      continue;
    }
    const result = analysisOutputSchema.safeParse(parsed);
    if (!result.success) {
      prompt = retryPrompt(
        basePrompt,
        "(the response didn't match the expected shape)",
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
    prompt = retryPrompt(basePrompt, violation);
  }

  return { output: buildFallbackOutput(input), source: "fallback" };
}
