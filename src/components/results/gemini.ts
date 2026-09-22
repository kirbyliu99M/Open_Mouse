/**
 * Shape of the optional Gemini analysis slot (M5, not built yet).
 *
 * `src/lib/contracts/` has no schema for this yet — there is nothing to
 * import. This local type is a provisional placeholder for wiring the UI's
 * optional slot and should be replaced by a real contract type (and this
 * file deleted) once M5 defines one. Never computed here: it is prose only,
 * about numbers the fit engine already produced.
 */
export type GeminiAnalysis = {
  headline: string;
  whyTopPick: string;
  tradeoffs: string[];
  whatToAvoid: string[];
  caveats: string[];
};

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; analysis: GeminiAnalysis };
