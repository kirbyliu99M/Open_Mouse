import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_ANALYSIS_MODEL,
  resolveAnalysisModelConfig,
} from "../../src/server/analysis/model-config";

describe("resolveAnalysisModelConfig", () => {
  it("returns null when GEMINI_API_KEY is unset", () => {
    expect(resolveAnalysisModelConfig({})).toBeNull();
  });

  it("returns null when GEMINI_API_KEY is blank or whitespace-only", () => {
    expect(resolveAnalysisModelConfig({ GEMINI_API_KEY: "" })).toBeNull();
    expect(resolveAnalysisModelConfig({ GEMINI_API_KEY: "   " })).toBeNull();
  });

  it("returns the trimmed key and the default model when GEMINI_ANALYSIS_MODEL is unset", () => {
    expect(
      resolveAnalysisModelConfig({ GEMINI_API_KEY: "  secret-key  " }),
    ).toEqual({
      apiKey: "secret-key",
      modelName: DEFAULT_GEMINI_ANALYSIS_MODEL,
    });
  });

  it("uses GEMINI_ANALYSIS_MODEL, trimmed, when set", () => {
    expect(
      resolveAnalysisModelConfig({
        GEMINI_API_KEY: "secret-key",
        GEMINI_ANALYSIS_MODEL: "  gemini-3.5-flash-lite  ",
      }),
    ).toEqual({ apiKey: "secret-key", modelName: "gemini-3.5-flash-lite" });
  });

  it("falls back to the default model when GEMINI_ANALYSIS_MODEL is blank", () => {
    expect(
      resolveAnalysisModelConfig({
        GEMINI_API_KEY: "secret-key",
        GEMINI_ANALYSIS_MODEL: "   ",
      }),
    ).toEqual({
      apiKey: "secret-key",
      modelName: DEFAULT_GEMINI_ANALYSIS_MODEL,
    });
  });
});
