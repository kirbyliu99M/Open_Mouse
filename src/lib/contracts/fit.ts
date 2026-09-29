/**
 * Fit contract — what the fit engine returns and the results UI renders.
 *
 * Numbers a user sees originate HERE, in the engine. Gemini (M5) receives this
 * object and writes prose about it; it never computes. Reasons are codes plus
 * numeric params so the UI and the LLM render the same engine-made facts.
 * Change this file only in a PR of its own.
 */
import { z } from "zod";
import { SIZES } from "./descriptors";

export const GRIP_STYLES = ["palm", "claw", "fingertip"] as const;
export type GripStyle = (typeof GRIP_STYLES)[number];

export const SUBSCORES = [
  "length",
  "gripWidth",
  "heightHump",
  "frontFlare",
  "thumb",
  "weight",
] as const;
export type Subscore = (typeof SUBSCORES)[number];

/**
 * Why a sub-score is what it is. Params are engine-computed numbers in mm/g;
 * the UI formats them, Gemini may quote them, nobody recomputes them.
 */
export const REASON_CODES = [
  "length_ideal", // |delta| small
  "length_short", // mouse shorter than target by deltaMm
  "length_long",
  "width_ideal",
  "width_narrow",
  "width_wide",
  "height_low",
  "height_ideal",
  "height_high",
  "hump_matches_grip",
  "hump_mismatch_grip",
  "flare_supports_fingers",
  "flare_neutral",
  "flare_crowds_fingers",
  "thumb_rest_supports",
  "thumb_neutral", // no thumb rest, and the grip used doesn't rely on one
  "thumb_rest_missing", // no thumb rest, and the grip used (palm) would rest the thumb on one
  "thumb_rest_unneeded",
  "weight_in_range",
  "weight_heavier",
  "weight_lighter",
  "descriptor_unknown", // the descriptor this sub-score needs is not classified yet
  "no_preference", // e.g. no weight preference given
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * Why a mouse was left out of the ranking. `trackball_form_factor` (like
 * `vertical_form_factor`) marks a device the length/width model does not
 * score; which entries are trackballs comes from catalogue facts
 * (`FORM_FACTORS` in ./descriptors).
 */
export const EXCLUSION_REASONS = [
  "wrong_hand",
  "vertical_form_factor",
  "trackball_form_factor",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

const reasonSchema = z.strictObject({
  code: z.enum(REASON_CODES),
  params: z.record(z.string(), z.number().finite()).default({}),
});

const subscoreSchema = z.strictObject({
  /** 0–100, or null when the inputs it needs are unknown (never guessed). */
  score: z.number().int().min(0).max(100).nullable(),
  weight: z.number().min(0).max(1),
  reason: reasonSchema,
});

export const fitEntrySchema = z.strictObject({
  rank: z.number().int().min(1),
  mouse: z.strictObject({
    slug: z.string(),
    brand: z.string(),
    model: z.string(),
    lengthMm: z.number(),
    widthMm: z.number(),
    heightMm: z.number(),
    weightG: z.number().nullable(),
    size: z.enum(SIZES),
  }),
  /**
   * Weighted mean over applicable sub-scores. A null (unknown) sub-score
   * contributes a neutral prior score rather than being dropped, so knowing
   * less about a mouse never raises its rank. `weight` is not applicable
   * without a user preference.
   */
  total: z.number().int().min(0).max(100),
  /** Share of total weight that had real inputs, 0–1. Low = provisional ranking. */
  confidence: z.number().min(0).max(1),
  subscores: z.strictObject(
    Object.fromEntries(SUBSCORES.map((k) => [k, subscoreSchema])) as Record<
      Subscore,
      typeof subscoreSchema
    >,
  ),
});

export const fitResponseSchema = z.strictObject({
  scanId: z.string().uuid(),
  engineVersion: z.string(),
  /** The hand this scan measured — the one exclusions and disclosures use (#62). */
  hand: z.enum(["left", "right"]),
  gripStyle: z.strictObject({
    stated: z.enum(GRIP_STYLES).nullable(),
    predicted: z.enum(GRIP_STYLES),
    /** The one scoring used: stated when given, else predicted. */
    used: z.enum(GRIP_STYLES),
  }),
  /** Engine targets for this hand + grip — the "ideal mouse" in numbers. */
  targets: z.strictObject({
    lengthMm: z.number(),
    gripWidthMm: z.number(),
    heightMm: z.number(),
  }),
  /** Mice excluded before ranking, with why (handedness, form factor). */
  excluded: z.array(
    z.strictObject({
      slug: z.string(),
      brand: z.string(),
      model: z.string(),
      reason: z.enum(EXCLUSION_REASONS),
    }),
  ),
  results: z.array(fitEntrySchema),
});

/** Optional user preferences sent with a fit request. */
export const fitPreferencesSchema = z.strictObject({
  gripStyle: z.enum(GRIP_STYLES).optional(),
  weightG: z
    .strictObject({
      min: z.number().min(20).max(200),
      max: z.number().min(20).max(200),
    })
    .refine((w) => w.min <= w.max, { message: "min must not exceed max" })
    .optional(),
  includeVertical: z.boolean().default(false),
});

export type FitEntry = z.infer<typeof fitEntrySchema>;
export type FitResponse = z.infer<typeof fitResponseSchema>;
export type FitPreferences = z.infer<typeof fitPreferencesSchema>;
