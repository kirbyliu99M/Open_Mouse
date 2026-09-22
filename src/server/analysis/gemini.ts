/**
 * Real Gemini text client. Mirrors the `VisionClassifier` pattern in
 * `src/server/classification/gemini.ts` (M1): a small interface in `./client`
 * that both this and the fake implement, this real `@google/genai`
 * implementation, and a fake for tests/unit.
 *
 * `GeminiTextModel` is never called from a test — there is no API key in CI
 * and the real API must never be called from this repo.
 *
 * This file (and anything else that reads `GEMINI_API_KEY`) imports
 * `server-only` so it can never end up in the client bundle — kept in its
 * own module, separate from `./client`'s `TextModel` interface and fake, so
 * that importing the fake for tests never pulls this in.
 */
import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { TextModel, TextModelArgs } from "./client";

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
  const modelName =
    env.GEMINI_ANALYSIS_MODEL?.trim() || DEFAULT_GEMINI_ANALYSIS_MODEL;
  return new GeminiTextModel(apiKey, modelName);
}
