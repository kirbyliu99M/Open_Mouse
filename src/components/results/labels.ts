/**
 * Direct, user-facing labels for internal sub-score keys. Per
 * docs/design-guidelines.md ("Direct labels"): name things by what they are,
 * never the internal field name (e.g. "Grip width", not "gripWidth").
 */
import type { Subscore } from "@/lib/contracts/fit";

export const SUBSCORE_LABELS: Record<Subscore, string> = {
  length: "Length",
  gripWidth: "Grip width",
  heightHump: "Height & hump",
  frontFlare: "Front flare",
  thumb: "Thumb rest",
  weight: "Weight",
};

export const EXCLUDED_REASON_LABELS: Record<
  "wrong_hand" | "vertical_form_factor",
  string
> = {
  wrong_hand: "Doesn't fit your handedness",
  vertical_form_factor: "Vertical shape, excluded from this comparison",
};
