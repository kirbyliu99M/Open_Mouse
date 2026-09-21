/**
 * Shape descriptor vocabulary — the single source of truth.
 *
 * Postgres enums, the classifier's closed output schema, the rubric validator
 * and the UI all derive from these arrays. Values are stable slugs; `LABELS`
 * holds the display text used in docs/shape-rubric.md.
 *
 * Ordered scales are listed low → high so that array index is the level, which
 * is what within-one-level agreement is measured on.
 */

export const SIZES = ["fingertip", "small", "medium", "large"] as const;
export const SHAPES = ["symmetrical", "ergonomic", "hybrid"] as const;
export const HAND_COMPATIBILITY = ["right", "left", "ambidextrous"] as const;
export const HUMP_PLACEMENTS = [
  "center",
  "back_minimal",
  "back_moderate",
  "back_aggressive",
] as const;
export const FRONT_FLARES = [
  "inward_aggressive",
  "inward_moderate",
  "inward_slight",
  "flat",
  "outward_slight",
  "outward_moderate",
  "outward_aggressive",
] as const;
export const SIDE_CURVATURES = [
  "inward_aggressive",
  "inward",
  "flat",
  "outward",
  "outward_aggressive",
] as const;
export const CONNECTIVITY = ["wired", "wireless"] as const;

export type Size = (typeof SIZES)[number];
export type Shape = (typeof SHAPES)[number];
export type HandCompatibility = (typeof HAND_COMPATIBILITY)[number];
export type HumpPlacement = (typeof HUMP_PLACEMENTS)[number];
export type FrontFlare = (typeof FRONT_FLARES)[number];
export type SideCurvature = (typeof SIDE_CURVATURES)[number];
export type Connectivity = (typeof CONNECTIVITY)[number];

/** Coarse classes the M1 gate is measured on. */
export type Direction = "inward" | "flat" | "outward";

export function flareDirection(level: FrontFlare): Direction {
  if (level === "flat") return "flat";
  return level.startsWith("inward") ? "inward" : "outward";
}

export function curvatureDirection(level: SideCurvature): Direction {
  if (level === "flat") return "flat";
  return level.startsWith("inward") ? "inward" : "outward";
}

export function humpIsBack(level: HumpPlacement): boolean {
  return level !== "center";
}

export const LABELS: Readonly<Record<string, string>> = {
  fingertip: "Fingertip",
  small: "Small",
  medium: "Medium",
  large: "Large",
  symmetrical: "Symmetrical",
  ergonomic: "Ergonomic",
  hybrid: "Hybrid",
  right: "Right",
  left: "Left",
  ambidextrous: "Ambidextrous",
  center: "Center",
  back_minimal: "Back – minimal",
  back_moderate: "Back – moderate",
  back_aggressive: "Back – aggressive",
  inward_aggressive: "Inward – aggressive",
  inward_moderate: "Inward – moderate",
  inward_slight: "Inward – slight",
  flat: "Flat",
  outward_slight: "Outward – slight",
  outward_moderate: "Outward – moderate",
  outward_aggressive: "Outward – aggressive",
  inward: "Inward",
  outward: "Outward",
  wired: "Wired",
  wireless: "Wireless",
};
