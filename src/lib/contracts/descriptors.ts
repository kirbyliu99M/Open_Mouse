/**
 * Shape descriptor vocabulary — the single source of truth.
 *
 * Postgres enums, the classifier's closed output schema, the rubric validator
 * and the UI all derive from these arrays. Values are stable slugs; the
 * per-descriptor `*_LABELS` maps hold the display text used in
 * docs/shape-rubric.md.
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
/**
 * What kind of device a catalogue entry is. A fact from first-party specs, not
 * a visual judgement: the fit engine's length/width model is built for a
 * standard mouse, so the other two are excluded unless the user opts in.
 */
export const FORM_FACTORS = ["standard", "vertical", "trackball"] as const;

/**
 * Catalogue category (2026-10-08). `gaming` vs everything else; which rows are
 * shown is a separate `listed` flag on the catalogue row, not a category.
 */
export const CATALOGUE_CATEGORIES = ["gaming", "office"] as const;
export type CatalogueCategory = (typeof CATALOGUE_CATEGORIES)[number];

/**
 * Where a catalogue row's numbers came from: a brand's own published specs,
 * or the EloShapes import (Kirby's call of 2026-10-08; the matching AGENTS
 * rule 1 revision lands in its own docs commit).
 */
export const DATA_SOURCES = ["first_party", "eloshapes"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export type Size = (typeof SIZES)[number];
export type Shape = (typeof SHAPES)[number];
export type HandCompatibility = (typeof HAND_COMPATIBILITY)[number];
export type HumpPlacement = (typeof HUMP_PLACEMENTS)[number];
export type FrontFlare = (typeof FRONT_FLARES)[number];
export type SideCurvature = (typeof SIDE_CURVATURES)[number];
export type Connectivity = (typeof CONNECTIVITY)[number];
export type FormFactor = (typeof FORM_FACTORS)[number];

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

/*
 * Display text, one map per descriptor. Front flare and side curvature share
 * three slugs (`inward_aggressive`, `flat`, `outward_aggressive`) but not their
 * meaning, so a single flat map could never give them different wording (the
 * zh-TW copy says 內收/外擴 for the front and 內凹/外凸 for the sides).
 */
export const SIZE_LABELS: Readonly<Record<Size, string>> = {
  fingertip: "Fingertip",
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export const SHAPE_LABELS: Readonly<Record<Shape, string>> = {
  symmetrical: "Symmetrical",
  ergonomic: "Ergonomic",
  hybrid: "Hybrid",
};

export const HAND_COMPATIBILITY_LABELS: Readonly<
  Record<HandCompatibility, string>
> = {
  right: "Right",
  left: "Left",
  ambidextrous: "Ambidextrous",
};

export const HUMP_PLACEMENT_LABELS: Readonly<Record<HumpPlacement, string>> = {
  center: "Center",
  back_minimal: "Back – minimal",
  back_moderate: "Back – moderate",
  back_aggressive: "Back – aggressive",
};

export const FRONT_FLARE_LABELS: Readonly<Record<FrontFlare, string>> = {
  inward_aggressive: "Inward – aggressive",
  inward_moderate: "Inward – moderate",
  inward_slight: "Inward – slight",
  flat: "Flat",
  outward_slight: "Outward – slight",
  outward_moderate: "Outward – moderate",
  outward_aggressive: "Outward – aggressive",
};

export const SIDE_CURVATURE_LABELS: Readonly<Record<SideCurvature, string>> = {
  inward_aggressive: "Inward – aggressive",
  inward: "Inward",
  flat: "Flat",
  outward: "Outward",
  outward_aggressive: "Outward – aggressive",
};

export const CONNECTIVITY_LABELS: Readonly<Record<Connectivity, string>> = {
  wired: "Wired",
  wireless: "Wireless",
};

export const FORM_FACTOR_LABELS: Readonly<Record<FormFactor, string>> = {
  standard: "Standard",
  vertical: "Vertical",
  trackball: "Trackball",
};
