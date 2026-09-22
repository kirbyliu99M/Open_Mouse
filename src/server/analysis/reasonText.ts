/**
 * Plain-English, number-free descriptions of each fit-contract reason code.
 * Used by the deterministic fallback (`buildFallbackOutput`) so it never
 * needs the LLM — and, because it never emits a number that isn't already
 * guaranteed to be in the input, it trivially satisfies the no-new-numerals
 * rule.
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
  "weight_heavier",
  "weight_lighter",
]);

export const REASON_TEXT: Record<ReasonCode, string> = {
  length_ideal: "its length matches your hand well",
  length_short: "it runs shorter than your hand would ideally want",
  length_long: "it runs longer than your hand would ideally want",
  width_ideal: "its grip width matches your hand well",
  width_narrow: "it's narrower than your hand would ideally want",
  width_wide: "it's wider than your hand would ideally want",
  height_low: "it sits lower than your palm would ideally want",
  height_ideal: "its height matches your palm well",
  height_high: "it sits higher than your palm would ideally want",
  hump_matches_grip: "its hump placement suits your grip style",
  hump_mismatch_grip: "its hump placement doesn't suit your grip style",
  flare_supports_fingers: "its front flare supports your fingertips",
  flare_neutral: "its front flare is neutral for your fingertips",
  flare_crowds_fingers: "its front flare may crowd your fingertips",
  thumb_rest_supports: "its thumb rest supports your grip",
  thumb_neutral: "its thumb area is neutral for your grip",
  thumb_rest_unneeded: "its thumb rest isn't needed for your grip",
  weight_in_range: "its weight is within your preferred range",
  weight_heavier: "it's heavier than your preferred range",
  weight_lighter: "it's lighter than your preferred range",
  descriptor_unknown: "one of its shape descriptors isn't classified yet",
  no_preference: "you didn't state a preference here",
};
