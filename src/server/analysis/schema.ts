/**
 * The analysis output shape now lives in `src/lib/contracts/analysis.ts`,
 * because the results UI consumes it over HTTP and a seam belongs in the
 * contracts. Re-exported here so the analysis module's imports stay short.
 */
export {
  analysisOutputSchema,
  type AnalysisOutput,
} from "../../lib/contracts/analysis";
