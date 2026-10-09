/**
 * Fit contract — what the fit engine returns and the results UI renders.
 *
 * Numbers a user sees originate HERE, in the engine. Gemini (M5) receives this
 * object and writes prose about it; it never computes. Reasons are codes plus
 * numeric params so the UI and the LLM render the same engine-made facts.
 * Change this file only in a contract PR of its own, carrying no more than the
 * minimal consumer updates that keep `main` green.
 */
import { z } from "zod";
import { CATALOGUE_CATEGORIES, SIZES } from "./descriptors";

export const GRIP_STYLES = ["palm", "claw", "fingertip"] as const;
export type GripStyle = (typeof GRIP_STYLES)[number];

/**
 * A path on this site: one leading slash, never `//` (protocol-relative, i.e.
 * another host), no backslash (browsers read it as a slash) and no `..`.
 */
const sitePathSchema = z
  .string()
  .refine(
    (v) =>
      /^\/[^/\\]/.test(v) && !v.includes("\\") && !v.split("/").includes(".."),
    { message: "must be a path on this site" },
  );

export const HAND_TYPE_SIZES = ["small", "medium", "large"] as const;
export const HAND_TYPE_WIDTHS = ["slim", "wide"] as const;

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
    /** 2026-10-08, optional until every engine version fills it. */
    category: z.enum(CATALOGUE_CATEGORIES).optional(),
    /** Site-relative path of the official product photo, or null when none. */
    imageUrl: sitePathSchema.nullable().optional(),
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
    /**
     * fit-v1 (candidate): how much each grip contributed when none was
     * stated (sums to 1). Absent under fit-v0, which uses one grip only.
     */
    weights: z
      .strictObject({
        palm: z.number().min(0).max(1),
        claw: z.number().min(0).max(1),
        fingertip: z.number().min(0).max(1),
      })
      .optional(),
  }),
  /**
   * Display-only hand type (2026-10-08, candidate): the catalogue size class
   * the target length falls in, the grip used, and wide vs slim. Anchored to
   * mouse sizes, never a comparison with other people. Does not affect scores.
   */
  handType: z
    .strictObject({
      size: z.enum(HAND_TYPE_SIZES),
      grip: z.enum(GRIP_STYLES),
      width: z.enum(HAND_TYPE_WIDTHS),
    })
    .optional(),
  /** Engine targets for this hand + grip — the "ideal mouse" in numbers. */
  targets: z.strictObject({
    lengthMm: z.number(),
    gripWidthMm: z.number(),
    heightMm: z.number(),
  }),
  /** Mice excluded before ranking, with why (handedness, form factor). */
  excluded: z.array(
    z
      .strictObject({
        slug: z.string(),
        brand: z.string(),
        model: z.string(),
        reason: z.enum(EXCLUSION_REASONS),
        /**
         * 2026-10-09 (Kirby: an excluded mouse should still show a score).
         *
         * What it means: the weighted total this mouse's mirror image would
         * get for the scanned hand. It uses the same sub-scores, weights and
         * neutral prior as a ranked entry. Mirroring leaves length, width,
         * height, hump and flare unchanged and moves a thumb rest to the
         * person's thumb side, so every sub-score keeps its meaning. Read it
         * as "how this shape fits you, in your hand's version", never as
         * "this mouse fits you".
         *
         * When: only on a `wrong_hand` exclusion of a device the length/width
         * model covers. Hard rule 2: no number without a model behind it.
         * Handedness is checked before form factor, so a right-only trackball
         * or vertical mouse can be `wrong_hand` too. The schema cannot see
         * form factor, so the engine must leave `total` out for vertical and
         * trackball devices (`totalApplies` in src/server/fit/exclusions.ts).
         * The schema refuses a total on any other reason.
         *
         * Not part of the analysis input: the written analysis never sees it.
         * It must stay out of the analysis numeral allow-list
         * (src/server/analysis/input.ts).
         *
         * Optional until the engine fills it.
         */
        total: z.number().int().min(0).max(100).optional(),
      })
      .refine((e) => e.total === undefined || e.reason === "wrong_hand", {
        message: "only a wrong_hand exclusion may carry a total",
        path: ["total"],
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
export type HandType = NonNullable<FitResponse["handType"]>;
export type FitResponse = z.infer<typeof fitResponseSchema>;
export type FitPreferences = z.infer<typeof fitPreferencesSchema>;
