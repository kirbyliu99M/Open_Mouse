/**
 * Per-descriptor prompt text and view routing for M1 classification.
 * Definitions and levels are transcribed from docs/shape-rubric.md — keep
 * the two in sync if the rubric changes. Pure string-building only.
 */
import type { ImageView } from "./gemini";

export type ConstrainedDescriptor =
  "shape" | "handCompatibility" | "thumbRest" | "ringFingerRest";
export type VisualDescriptor = "humpPlacement" | "frontFlare" | "sideCurvature";
export type Descriptor = ConstrainedDescriptor | VisualDescriptor;

export const ALL_DESCRIPTORS: readonly Descriptor[] = [
  "shape",
  "handCompatibility",
  "humpPlacement",
  "frontFlare",
  "sideCurvature",
  "thumbRest",
  "ringFingerRest",
];

/** rubric §"Applying the rubric" step 2–3 + the M1 view-per-descriptor rule. */
export const DESCRIPTOR_VIEWS: Record<Descriptor, readonly ImageView[]> = {
  shape: ["top", "front"],
  handCompatibility: ["top", "front"],
  humpPlacement: ["side"],
  frontFlare: ["top"],
  sideCurvature: ["front", "rear"],
  thumbRest: ["top", "side"],
  ringFingerRest: ["top", "side"],
};

const COMMON_PREAMBLE =
  "You are classifying a computer mouse's shell shape from the manufacturer's own " +
  "product renders, for a rubric-based catalogue (never guess from marketing copy, " +
  "only from what the images show).";

function withViolation(prompt: string, violation?: string): string {
  if (!violation) return prompt;
  return (
    `${prompt}\n\nA previous answer for this mouse violated a consistency rule: ` +
    `${violation}\nReclassify from the images, correcting for that rule.`
  );
}

export function shapePrompt(violation?: string): string {
  return withViolation(
    `${COMMON_PREAMBLE}\n\nClassify Shape from these top-down and/or front views:\n` +
      `- symmetrical: left and right profiles mirror; the thumb side and ring-finger ` +
      `side are interchangeable.\n` +
      `- ergonomic: deliberately handed — a thumb scoop, a canted deck, or an ` +
      `asymmetric hump.\n` +
      `- hybrid: symmetrical in plan view but with mild asymmetric relief, e.g. a ` +
      `slight thumb-side scallop on an otherwise mirrored shell. This is rare ` +
      `(~1.5% of mice) — prefer symmetrical or ergonomic unless the asymmetry is ` +
      `obvious but minor.`,
    violation,
  );
}

export function handCompatibilityPrompt(violation?: string): string {
  return withViolation(
    `${COMMON_PREAMBLE}\n\nClassify Hand compatibility from these top-down and/or ` +
      `front views: right (shaped for a right hand only), left (shaped for a left ` +
      `hand only), or ambidextrous (symmetrical, usable by either hand). An ` +
      `ambidextrous mouse is always symmetrical; a handed (right/left) shell is ` +
      `never symmetrical.`,
    violation,
  );
}

export function humpPlacementPrompt(violation?: string): string {
  return withViolation(
    `${COMMON_PREAMBLE}\n\nClassify Hump placement — the position of peak shell ` +
      `height along the body, as a fraction of total length measured from the ` +
      `front — from this square-on side view. Find the highest point of the top ` +
      `shell, drop a perpendicular to the base line, and express its distance from ` +
      `the front edge as a fraction of total length. Ignore the scroll wheel and ` +
      `any buttons that break the silhouette — judge the shell the palm rests on.\n` +
      `Levels: center (peak at ≤55% of length), back_minimal (55–62%), ` +
      `back_moderate (62–70%), back_aggressive (>70%).`,
    violation,
  );
}

export function frontFlarePrompt(violation?: string): string {
  return withViolation(
    `${COMMON_PREAMBLE}\n\nClassify Front flare — how the sidewalls behave forward ` +
      `of the widest point: do they splay outward toward the click surface, run ` +
      `parallel, or tuck inward — from this top-down view. Compare the width at ` +
      `the front third against the width at the waist.\n` +
      `Levels, nose pinching in to nose splaying out: inward_aggressive, ` +
      `inward_moderate, inward_slight, flat (sidewalls run essentially parallel), ` +
      `outward_slight, outward_moderate, outward_aggressive.\n` +
      `Distribution prior: outward_slight, outward_moderate and flat together ` +
      `account for ~88% of real mice, and inward_aggressive is under 1%. Bias ` +
      `toward the common classes — reach for a tail label only on clear evidence.`,
    violation,
  );
}

export function sideCurvaturePrompt(violation?: string): string {
  return withViolation(
    `${COMMON_PREAMBLE}\n\nClassify Side curvature — the cross-section profile of ` +
      `the sidewalls between deck and base — from this front or rear view.\n` +
      `Levels: inward_aggressive (deeply concave, a pronounced grip channel), ` +
      `inward (gently concave — the most common case), flat (near-vertical walls), ` +
      `outward / outward_aggressive (convex, bulging walls — rare, ~1%).\n` +
      `Distribution prior: inward and flat cover ~96% of real mice. Bias toward ` +
      `the common classes — reach for a tail label only on clear evidence.`,
    violation,
  );
}

export function thumbRestPrompt(violation?: string): string {
  return withViolation(
    `${COMMON_PREAMBLE}\n\nDoes this mouse have a Thumb rest — a deliberate shelf ` +
      `or scoop that supports the thumb — visible in these top-down and/or side ` +
      `views? A merely concave sidewall is Side curvature, not a rest; answer true ` +
      `only for a clear dedicated thumb shelf/scoop. A symmetrical mouse almost ` +
      `never has one — if the shell looks symmetrical, re-check before answering true.`,
    violation,
  );
}

export function ringFingerRestPrompt(violation?: string): string {
  return withViolation(
    `${COMMON_PREAMBLE}\n\nDoes this mouse have a Ring finger rest — a deliberate ` +
      `shelf or scoop that supports the ring finger — visible in these top-down ` +
      `and/or side views? A merely concave sidewall is Side curvature, not a rest; ` +
      `answer true only for a clear dedicated ring-finger shelf/scoop. A ` +
      `symmetrical mouse almost never has one — if the shell looks symmetrical, ` +
      `re-check before answering true.`,
    violation,
  );
}
