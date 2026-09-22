/**
 * Analysis contract — what `POST /api/scans/{scanId}/analysis` returns and the
 * results UI renders in its analysis slot.
 *
 * Prose only. Gemini writes it about numbers the fit engine already produced
 * (AGENTS.md hard rule 2): the server rejects any numeral that does not trace
 * back to the fit response before this object is ever returned. Nothing here
 * is a source of numbers. Change this file only in a PR of its own.
 */
import { z } from "zod";

export const analysisOutputSchema = z.strictObject({
  headline: z.string().min(1).max(160),
  whyTopPick: z.string().min(1).max(400),
  tradeoffs: z.array(z.string().min(1).max(200)).max(3),
  whatToAvoid: z.array(z.string().min(1).max(200)).max(2),
  caveats: z.array(z.string().min(1).max(200)),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

/**
 * Who wrote the prose. `fallback` is the deterministic template the server
 * uses when no model is configured, the model call fails, or the model's
 * output breaks the no-new-numerals rule. The UI must not present fallback
 * text as if a model wrote it.
 */
export const ANALYSIS_SOURCES = ["model", "fallback"] as const;
export type AnalysisSource = (typeof ANALYSIS_SOURCES)[number];

/** 200 body of the analysis route. */
export const analysisResponseSchema = z.strictObject({
  output: analysisOutputSchema,
  source: z.enum(ANALYSIS_SOURCES),
  /** True when an identical fit was analysed before and no model call ran. */
  cached: z.boolean(),
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
