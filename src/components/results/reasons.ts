/**
 * Reason-code -> sentence templates.
 *
 * The fit engine is the only thing that decides *why* a sub-score is what it
 * is; it hands the UI a `code` plus numeric `params` (mm, g). This file only
 * formats those params into a sentence — it does no arithmetic of its own
 * (Math.abs below is display formatting of a sign, not a new derived value)
 * and invents no numbers. Every `ReasonCode` must have an entry: a test
 * iterates `REASON_CODES` and asserts each renders a non-empty sentence.
 */
import { REASON_CODES, type ReasonCode } from "@/lib/contracts/fit";
import { formatMm } from "./format";

type Params = Record<string, number>;

function mm(params: Params, key: string): string | null {
  const value = params[key];
  return typeof value === "number" ? formatMm(Math.abs(value)) : null;
}

function withFallback(
  amount: string | null,
  template: (amount: string) => string,
  fallback: string,
): string {
  return amount ? template(amount) : fallback;
}

const TEMPLATES: Record<ReasonCode, (params: Params) => string> = {
  length_ideal: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `Length is within ${d} of your ideal — about as close as it gets.`,
      "Length matches your ideal closely.",
    ),
  length_short: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `This mouse is ${d} shorter than your ideal length.`,
      "This mouse is shorter than your ideal length.",
    ),
  length_long: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `This mouse is ${d} longer than your ideal length.`,
      "This mouse is longer than your ideal length.",
    ),
  width_ideal: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `Grip width is within ${d} of your ideal — a close match.`,
      "Grip width matches your hand well.",
    ),
  width_narrow: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `This mouse is ${d} narrower than your ideal grip width.`,
      "This mouse is narrower than your ideal grip width.",
    ),
  width_wide: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `This mouse is ${d} wider than your ideal grip width.`,
      "This mouse is wider than your ideal grip width.",
    ),
  height_low: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `This mouse sits ${d} lower than your ideal palm height.`,
      "This mouse sits lower than your ideal palm height.",
    ),
  height_ideal: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `Palm height is within ${d} of your ideal.`,
      "Palm height matches your hand well.",
    ),
  height_high: (p) =>
    withFallback(
      mm(p, "deltaMm"),
      (d) => `This mouse sits ${d} higher than your ideal palm height.`,
      "This mouse sits higher than your ideal palm height.",
    ),
  hump_matches_grip: () => "The hump position suits how you hold a mouse.",
  hump_mismatch_grip: () =>
    "The hump position doesn't line up with how you hold a mouse.",
  flare_supports_fingers: () =>
    "The front flares outward, giving your fingertips somewhere to rest.",
  flare_neutral: () => "The front shape neither helps nor crowds your fingers.",
  flare_crowds_fingers: () =>
    "The front flares inward and may crowd your fingertips.",
  thumb_rest_supports: () => "The thumb rest supports how you grip.",
  thumb_neutral: () => "There's no thumb rest, which suits your grip fine.",
  thumb_rest_missing: () =>
    "There's no thumb rest, and a palm grip usually rests the thumb on one.",
  thumb_rest_unneeded: () =>
    "There's a thumb rest, but your grip doesn't need one.",
  weight_in_range: (p) => {
    const value = p.deltaG;
    if (typeof value === "number") {
      return `Weight is within ${Math.round(Math.abs(value))} g of your preferred range.`;
    }
    return "Weight is within your preferred range.";
  },
  weight_heavier: (p) => {
    const value = p.deltaG;
    if (typeof value === "number") {
      return `This mouse is about ${Math.round(Math.abs(value))} g heavier than you prefer.`;
    }
    return "This mouse is heavier than you prefer.";
  },
  weight_lighter: (p) => {
    const value = p.deltaG;
    if (typeof value === "number") {
      return `This mouse is about ${Math.round(Math.abs(value))} g lighter than you prefer.`;
    }
    return "This mouse is lighter than you prefer.";
  },
  descriptor_unknown: () => "Shape not rated yet",
  no_preference: () => "No weight preference given",
};

/** Renders the plain-language sentence for a reason code + its params. */
export function reasonText(code: ReasonCode, params: Params = {}): string {
  return TEMPLATES[code](params);
}

/** Every reason code must render something — used to keep this file honest. */
export function allReasonCodesHaveTemplates(): boolean {
  return REASON_CODES.every((code) => TEMPLATES[code] !== undefined);
}
