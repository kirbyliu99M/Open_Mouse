import type { ExclusionReason, FitPreferences } from "../../lib/contracts/fit";
import { VERTICAL_FORM_FACTOR_RATIO } from "./coefficients";
import { excludeReason } from "./exclusions";
import type { CatalogueMouse } from "./types";

export interface ExclusionOptions {
  /** Keep trackballs in the ranking. There is no such preference in the contract yet. */
  allowTrackball?: boolean;
}

/**
 * v1 §5, in order: wrong hand (v0's rule, unchanged), trackball form factor
 * unless allowed, then vertical, which is `formFactor = vertical` OR
 * height/length above the ratio, unless `includeVertical`. An absent
 * `formFactor` is a standard mouse.
 */
export function excludeReasonV1(
  mouse: CatalogueMouse,
  hand: "left" | "right",
  prefs: FitPreferences,
  options: ExclusionOptions = {},
): ExclusionReason | null {
  // Reuse v0's handedness rule; includeVertical is forced on so only the
  // handedness branch can answer.
  const v0 = excludeReason(mouse, hand, { ...prefs, includeVertical: true });
  if (v0 === "wrong_hand") return v0;
  if (mouse.formFactor === "trackball" && !options.allowTrackball) {
    return "trackball_form_factor";
  }
  if (
    !prefs.includeVertical &&
    (mouse.formFactor === "vertical" ||
      mouse.heightMm / mouse.lengthMm > VERTICAL_FORM_FACTOR_RATIO)
  ) {
    return "vertical_form_factor";
  }
  return null;
}
