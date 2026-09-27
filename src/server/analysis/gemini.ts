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
import { resolveAnalysisModelConfig } from "./model-config";

export class GeminiResponseError extends Error {}

/**
 * Real Gemini implementation, using `@google/genai`. Model from
 * `GEMINI_ANALYSIS_MODEL` (default `gemini-3.8-flash`), key from
 * `GEMINI_API_KEY`. This is a short structured-writing task, not a
 * reasoning one.
 *
 * Thinking is `ThinkingLevel.LOW`, the lowest level `gemini-3.8-flash`
 * accepts. The SDK's types also offer `MINIMAL`, but the live API rejects it
 * for this model — "Thinking level MINIMAL is not supported for this model"
 * (400, verified against the API on 2026-09-23) — and that error took the
 * analysis route down in production. Types are not evidence of what the API
 * accepts. Output billing includes thinking tokens, and thinking counts
 * against `maxOutputTokens`, so keep it at the lowest accepted level.
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
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: args.maxOutputTokens,
      },
    });
    const text = response.text;
    if (!text)
      throw new GeminiResponseError("Gemini returned an empty response.");
    return text;
  }
}

export { DEFAULT_GEMINI_ANALYSIS_MODEL } from "./model-config";

/**
 * Returns a real Gemini-backed `TextModel` when `GEMINI_API_KEY` is set
 * (reading `GEMINI_ANALYSIS_MODEL` for the model name, default
 * `gemini-3.8-flash`), otherwise `null` — never throws. `analyse()` treats
 * `null` as "no model configured": it goes straight to the deterministic
 * fallback with `source: "fallback"` and makes no network call, so the app
 * runs with or without a key (issue #28 acceptance criterion 4).
 *
 * Env parsing itself is `resolveAnalysisModelConfig` in `./model-config`,
 * which has no `server-only` import and is unit-tested directly; this
 * function only adds the actual client construction, which needs the real
 * `@google/genai` import this file keeps behind `server-only`.
 */
export function createAnalysisModel(
  env: Readonly<Record<string, string | undefined>>,
): GeminiTextModel | null {
  const config = resolveAnalysisModelConfig(env);
  if (!config) return null;
  return new GeminiTextModel(config.apiKey, config.modelName);
}
