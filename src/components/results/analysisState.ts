/**
 * Shape of the results page's optional written-analysis slot.
 *
 * Replaces the provisional local type that used to live in `./gemini.ts`
 * (deleted — see issue #30): `AnalysisResponse` now comes from the real
 * contract, `src/lib/contracts/analysis.ts`. `AnalysisState` adds the
 * transport-level states (loading, rate limited, error) that the contract
 * itself doesn't need to know about.
 *
 * `rateLimited` is its own state, not folded into `error`, because
 * docs/design-guidelines.md and issue #30 both call for it to say
 * specifically that the ranking above is unaffected and to retry later,
 * rather than the generic "something went wrong" of `error`.
 */
import type { AnalysisResponse } from "@/lib/contracts/analysis";

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "rateLimited" }
  | { status: "error" }
  | { status: "ready"; response: AnalysisResponse };
