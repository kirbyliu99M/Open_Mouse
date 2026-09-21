/**
 * Analysis output contract — NOT in `src/lib/contracts/`. Unlike the fit
 * contract, this shape belongs to the analysis module only: it is prose
 * Gemini writes about engine-made numbers, never a source of numbers itself.
 *
 * Kept intentionally short (M5 spec): a headline, one sentence on the top
 * pick, up to three tradeoffs, up to two things to avoid, and caveats.
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
