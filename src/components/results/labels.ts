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
  thumb: "Thumb support",
  weight: "Weight",
};
