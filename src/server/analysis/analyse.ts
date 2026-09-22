/**
 * Turns engine-made fit numbers into short, structured prose. The LLM never
 * computes (AGENTS.md #2): every number it writes must already be in
 * `AnalysisInput`. `analyse()` enforces that itself, with a bounded retry
 * and a deterministic, non-LLM fallback — it never returns an unverified
 * answer.
 */
import { Type } from "@google/genai";
import type { TextModel } from "./client";
import type { AnalysisInput, AnalysisInputEntry } from "./input";
import { analysisOutputSchema, type AnalysisOutput } from "./schema";
import { collectNumbers, findUnknownNumeral, stringTokens } from "./numerals";
import {
  NEGATIVE_REASON_CODES,
  POSITIVE_REASON_CODES,
  REASON_TEXT,
} from "./reasonText";

/** Confidence below this means real descriptors are missing for the ranking. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

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
  return top !== undefined && top.confidence < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * The base prompt: the compact JSON plus the hard rules. Exported so tests
 * can assert on its content (e.g. that low confidence adds the provisional
 * instruction) without re-deriving it.
 */
export function buildPrompt(input: AnalysisInput): string {
  const lines = [
    "You are writing a short analysis of a mouse-fit ranking for a user, from the JSON data below.",
    "Rules:",
    "- Every number you write MUST already appear in the JSON data. Never compute, estimate, round differently, or invent a number.",
    "- Be concise: a one-sentence headline, one sentence on why the top pick fits, up to 3 tradeoffs, up to 2 things to avoid, and any caveats.",
    "- Write plainly for someone who has not seen the JSON.",
  ];
  if (isLowConfidence(input)) {
    lines.push(
      `- The top pick's confidence is below ${LOW_CONFIDENCE_THRESHOLD}: some shape descriptors it depends on are not classified yet. Say explicitly that the ranking and descriptors are provisional, and the "caveats" array must mention it.`,
    );
  }
  lines.push("", "Data:", JSON.stringify(input));
  return lines.join("\n");
}

function retryPrompt(basePrompt: string, violation: string): string {
  return `${basePrompt}\n\nYour previous answer used the number ${violation}, which does not appear anywhere in the Data above. Every number in your answer MUST come from Data verbatim. Rewrite your full answer without inventing any new numbers.`;
}

/**
 * Finds a reason `analyse()` should not accept a candidate output as-is:
 * a numeral not traceable to the input, or a missing provisional caveat
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
    const unknown = findUnknownNumeral(text, allowedNumbers, exemptTokens);
    if (unknown !== null) return String(unknown);
  }
  if (isLowConfidence(input)) {
    const mentionsProvisional = candidate.caveats.some((c) =>
      /provisional/i.test(c),
    );
    if (!mentionsProvisional) {
      return "(missing) a caveat noting the ranking is provisional";
    }
  }
  return null;
}

function describeReasons(
  entry: AnalysisInputEntry,
  codes: ReadonlySet<string>,
  limit: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sub of Object.values(entry.subscores)) {
    if (!codes.has(sub.reasonCode)) continue;
    const text = REASON_TEXT[sub.reasonCode];
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Deterministic, non-LLM answer built purely from reason codes already in
 * the input. Used when the model can't produce output that respects the
 * no-new-numerals rule after a retry. Never invents a number.
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
  const negatives = describeReasons(top, NEGATIVE_REASON_CODES, 3);
  const headline = `${top.brand} ${top.model} is the top match for your hand.`;
  const whyTopPick =
    positives.length > 0
      ? `It's the top pick because ${positives.join(" and ")}.`
      : "It's the top pick based on your measurements and grip style.";
  const tradeoffs = negatives
    .slice(0, 3)
    .map((t) => t[0]!.toUpperCase() + t.slice(1));
  const whatToAvoid = negatives
    .slice(0, 2)
    .map((t) => t[0]!.toUpperCase() + t.slice(1));
  const caveats: string[] = [];
  if (top.confidence < LOW_CONFIDENCE_THRESHOLD) {
    caveats.push(PROVISIONAL_NOTE);
  }
  return { headline, whyTopPick, tradeoffs, whatToAvoid, caveats };
}

/**
 * Calls the model, validates its structured output, and enforces the
 * no-new-numerals rule. Retries once, naming the violation; a second
 * violation returns the deterministic fallback instead of ever surfacing
 * unverified model output.
 */
export async function analyse(
  input: AnalysisInput,
  client: TextModel,
): Promise<AnalysisOutput> {
  const allowedNumbers = collectNumbers(input);
  const exemptTokens = collectExemptTokens(input);
  const basePrompt = buildPrompt(input);
  let prompt = basePrompt;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await client.generate({
      prompt,
      schema: ANALYSIS_RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

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
    if (violation === null) return result.data;
    prompt = retryPrompt(basePrompt, violation);
  }

  return buildFallbackOutput(input);
}
