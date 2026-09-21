/**
 * Gemini text client, behind an interface `analyse.ts` codes against.
 * Mirrors the `VisionClassifier` pattern in `src/server/classification/gemini.ts`
 * (M1): a small interface, a real `@google/genai` implementation that is
 * never exercised in tests, and a fake for tests/unit.
 *
 * `GeminiTextModel` is never called from a test — there is no API key in CI
 * and the real API must never be called from this repo.
 */
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export interface TextModelArgs {
  prompt: string;
  /** Structured-output schema (a `@google/genai` `Schema`-shaped object). */
  schema: object;
  maxOutputTokens: number;
}

/** Everything `analyse.ts` needs from a text model. One call per attempt. */
export interface TextModel {
  readonly modelName: string;
  generate(args: TextModelArgs): Promise<string>;
}

export class GeminiResponseError extends Error {}

/**
 * Real Gemini implementation, using `@google/genai`. Model from
 * `GEMINI_ANALYSIS_MODEL` (default `gemini-3.8-flash`), key from
 * `GEMINI_API_KEY`. Thinking is set to the SDK's minimal level — this is a
 * short structured-writing task, not a reasoning one.
 */
export class GeminiTextModel implements TextModel {
  private readonly client: GoogleGenAI;
  readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async generate(args: TextModelArgs): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: [args.prompt],
      config: {
        responseMimeType: "application/json",
        responseSchema: args.schema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        maxOutputTokens: args.maxOutputTokens,
      },
    });
    const text = response.text;
    if (!text)
      throw new GeminiResponseError("Gemini returned an empty response.");
    return text;
  }
}

export const DEFAULT_GEMINI_ANALYSIS_MODEL = "gemini-3.8-flash";

/** Reads GEMINI_ANALYSIS_MODEL / GEMINI_API_KEY. Throws if the key is absent. */
export function createGeminiTextModel(
  env: Readonly<Record<string, string | undefined>>,
): GeminiTextModel {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Analysis calls the real Gemini API and needs a key.",
    );
  }
  const modelName = env.GEMINI_ANALYSIS_MODEL?.trim() || DEFAULT_GEMINI_ANALYSIS_MODEL;
  return new GeminiTextModel(apiKey, modelName);
}

export type FakeTextModelCall = TextModelArgs;

export interface FakeTextModelConfig {
  modelName?: string;
  /** Called once per `generate()`; index 0 is the first attempt, 1 the retry. */
  answer: (
    args: TextModelArgs,
    callIndex: number,
  ) => string | Promise<string>;
}

/**
 * In-memory `TextModel` for tests. Records every call (prompt + schema) so
 * tests can assert what `analyse.ts` sent — e.g. that a retry names the
 * numeral violation, or that a low-confidence prompt says "provisional".
 */
export class FakeTextModel implements TextModel {
  readonly modelName: string;
  readonly calls: FakeTextModelCall[] = [];

  constructor(private readonly config: FakeTextModelConfig) {
    this.modelName = config.modelName ?? "fake-text-model";
  }

  async generate(args: TextModelArgs): Promise<string> {
    this.calls.push(args);
    return await this.config.answer(args, this.calls.length - 1);
  }
}
