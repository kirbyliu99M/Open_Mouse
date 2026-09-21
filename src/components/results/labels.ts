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

/** "logitech-g-pro-x-superlight-2" -> "Logitech G Pro X Superlight 2" */
export function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
