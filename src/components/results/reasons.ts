/**
 * Reason-code -> sentence.
 *
 * The fit engine is the only thing that decides *why* a sub-score is what it
 * is; it hands the UI a `code` plus numeric `params` (mm, g). This file only
 * formats those params into text and hands them to the sentence for the
 * locale (`src/lib/copy/results-reasons.ts`). It does no arithmetic of its own
 * (Math.abs below is display formatting of a sign, not a new derived value)
 * and invents no numbers. Every `ReasonCode` must have an entry: a test
 * iterates `REASON_CODES` and asserts each renders a non-empty sentence.
 */
import { REASON_CODES, type ReasonCode } from "@/lib/contracts/fit";
import type { Locale } from "@/lib/contracts/locale";
import { reasonsCopy, type ReasonAmounts } from "@/lib/copy/results-reasons";
import { formatMm } from "./format";

type Params = Record<string, number>;

function mm(params: Params, key: string): string | null {
  const value = params[key];
  return typeof value === "number" ? formatMm(Math.abs(value)) : null;
}

function grams(value: number): string {
  return `${Math.round(value)} g`;
}

function amountsOf(params: Params): ReasonAmounts {
  const { minG, maxG, deltaG } = params;
  return {
    delta: mm(params, "deltaMm"),
    // The engine sends `{ minG, maxG }` for an in-range weight (there is no
    // gap to report), and `{ deltaG, minG, maxG }` for heavier and lighter.
    range:
      typeof minG === "number" && typeof maxG === "number"
        ? `${Math.round(minG)}–${grams(maxG)}`
        : null,
    deltaG: typeof deltaG === "number" ? grams(Math.abs(deltaG)) : null,
  };
}

/** Renders the plain-language sentence for a reason code + its params. */
export function reasonText(
  code: ReasonCode,
  params: Params,
  locale: Locale,
): string {
  return reasonsCopy(locale)[code](amountsOf(params));
}

/** Every reason code must render something — used to keep this file honest. */
export function allReasonCodesHaveTemplates(): boolean {
  const table = reasonsCopy("en");
  return REASON_CODES.every((code) => table[code] !== undefined);
}
