/**
 * The `TextModel` seam `analyse.ts` codes against, plus the in-memory fake
 * used by tests. The real `@google/genai`-backed implementation
 * (`GeminiTextModel`, which reads `GEMINI_API_KEY`) lives in `./gemini`,
 * which imports `server-only` — kept out of this file so tests can import
 * `FakeTextModel` here without pulling in a module that throws outside a
 * server context. See `./gemini` for the real client.
 */

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

export type FakeTextModelCall = TextModelArgs;

export interface FakeTextModelConfig {
  modelName?: string;
  /** Called once per `generate()`; index 0 is the first attempt, 1 the retry. */
  answer: (args: TextModelArgs, callIndex: number) => string | Promise<string>;
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
