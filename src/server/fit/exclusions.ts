import type { ExclusionReason, FitPreferences } from "../../lib/contracts/fit";
import { VERTICAL_FORM_FACTOR_RATIO } from "./coefficients";
import type { CatalogueMouse } from "./types";

export type { ExclusionReason };

/**
 * §5 (revised): right-hand scan excludes left-handed mice; left-hand scan
 * excludes right-handed mice shaped *ergonomic* or *hybrid* — only
 * symmetrical right mice stay. Height/Length > 0.55 excludes unless
 * prefs.includeVertical. Unknown handedness is never excluded, and unknown
 * shape is never excluded (a right-handed mouse with shape null stays for a
 * left-hand scan). Handedness is checked before the vertical form factor
 * when both would apply.
 */
export function excludeReason(
  mouse: CatalogueMouse,
  hand: "left" | "right",
  prefs: FitPreferences,
): ExclusionReason | null {
  if (mouse.handCompatibility !== null) {
    if (hand === "right" && mouse.handCompatibility === "left")
      return "wrong_hand";
    if (
      hand === "left" &&
      mouse.handCompatibility === "right" &&
      (mouse.shape === "ergonomic" || mouse.shape === "hybrid")
    ) {
      return "wrong_hand";
    }
  }
  if (
    mouse.heightMm / mouse.lengthMm > VERTICAL_FORM_FACTOR_RATIO &&
    !prefs.includeVertical
  ) {
    return "vertical_form_factor";
  }
  return null;
}

/**
 * Whether the length/width model applies to this device, for showing a score
 * on an excluded mouse. Vertical devices (a `vertical` form factor, or
 * height/length above the vertical ratio) and trackballs sit outside it, so a
 * `wrong_hand` exclusion of one carries no total. An absent `formFactor` is a
 * standard mouse. This looks at the device only: it ignores
 * `prefs.includeVertical` and `allowTrackball`, which decide ranking, not
 * whether a number means anything for the device.
 */
export function totalApplies(mouse: CatalogueMouse): boolean {
  if (mouse.formFactor === "vertical" || mouse.formFactor === "trackball") {
    return false;
  }
  return mouse.heightMm / mouse.lengthMm <= VERTICAL_FORM_FACTOR_RATIO;
}
