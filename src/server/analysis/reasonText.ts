/**
 * Which fit-contract reason codes the deterministic fallback
 * (`buildFallbackOutput`) files as something in the mouse's favour and which
 * as a tradeoff. The sentence for each code (what it means for how the mouse
 * feels in use) lives in `src/lib/copy/fit-bands.ts` and reaches the fallback
 * through `AnalysisInput`; it carries no digit, so the fallback never needs the
 * LLM and trivially satisfies the no-new-numerals rule.
 */
import type { ReasonCode } from "../../lib/contracts/fit";

/** True for reason codes that describe something working in the mouse's favour. */
export const POSITIVE_REASON_CODES: ReadonlySet<ReasonCode> = new Set([
  "length_ideal",
  "width_ideal",
  "height_ideal",
  "hump_matches_grip",
  "flare_supports_fingers",
  "thumb_rest_supports",
  "weight_in_range",
]);

/** True for reason codes worth surfacing as a tradeoff or thing to avoid. */
export const NEGATIVE_REASON_CODES: ReadonlySet<ReasonCode> = new Set([
  "length_short",
  "length_long",
  "width_narrow",
  "width_wide",
  "height_low",
  "height_high",
  "hump_mismatch_grip",
  "flare_crowds_fingers",
  "thumb_rest_missing",
  "weight_heavier",
  "weight_lighter",
]);
