/**
 * Pure env-parsing for the analysis model factory. Split out of `./gemini`
 * so it can be unit-tested without importing that file — `./gemini` imports
 * `server-only`, which throws unconditionally when loaded outside a real
 * server/bundler context (see the comment at the top of `./gemini`), so
 * nothing in `./gemini` can be imported from a test.
 *
 * Deliberately returns `null` rather than throwing when no key is set: "no
 * model configured" is a normal, expected state `analyse()` handles by
 * falling back, not an error condition.
 */

export const DEFAULT_GEMINI_ANALYSIS_MODEL = "gemini-3.8-flash";

export interface AnalysisModelConfig {
  apiKey: string;
  modelName: string;
}

/**
 * Reads `GEMINI_API_KEY` / `GEMINI_ANALYSIS_MODEL` from `env`. Returns `null`
 * when no key is set (blank/whitespace-only counts as unset); otherwise the
 * trimmed key and the model name (`GEMINI_ANALYSIS_MODEL`, trimmed, or the
 * default).
 */
export function resolveAnalysisModelConfig(
  env: Readonly<Record<string, string | undefined>>,
): AnalysisModelConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const modelName =
    env.GEMINI_ANALYSIS_MODEL?.trim() || DEFAULT_GEMINI_ANALYSIS_MODEL;
  return { apiKey, modelName };
}
