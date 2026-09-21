import type { FitPreferences } from "../../lib/contracts/fit";
import { VERTICAL_FORM_FACTOR_RATIO } from "./coefficients";
import type { CatalogueMouse } from "./types";

export type ExclusionReason = "wrong_hand" | "vertical_form_factor";

/**
 * §5: right-hand scan excludes left-handed mice; left-hand scan excludes
 * right-handed *ergonomic* mice (symmetric/hybrid right mice stay).
 * Height/Length > 0.55 excludes unless prefs.includeVertical. Unknown
 * handedness is never excluded. Handedness is checked before the vertical
 * form factor when both would apply.
 */
export function excludeReason(
  mouse: CatalogueMouse,
  hand: "left" | "right",
  prefs: FitPreferences,
): ExclusionReason | null {
  if (mouse.handCompatibility !== null) {
    if (hand === "right" && mouse.handCompatibility === "left") return "wrong_hand";
    if (hand === "left" && mouse.handCompatibility === "right" && mouse.shape === "ergonomic") {
      return "wrong_hand";
    }
  }
  if (mouse.heightMm / mouse.lengthMm > VERTICAL_FORM_FACTOR_RATIO && !prefs.includeVertical) {
    return "vertical_form_factor";
  }
  return null;
}
