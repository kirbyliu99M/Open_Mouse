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
import {
  CATALOGUE_CATEGORIES,
  CONNECTIVITY,
  SHAPES,
  SIZES,
} from "./descriptors";
import { PALM_THICKNESS_LEVELS } from "./measurement";

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
    /**
     * 2026-10-10 (Kirby, candidate): catalogue facts the results-page filter
     * reads (滑鼠握感 and 傳輸介面). `shape` is the catalogue's shape descriptor
     * (symmetrical, ergonomic, hybrid); `connectivity` is wired or wireless
     * (a mouse that also works wired is wireless). Values are lower case;
     * source data spelled `Wired`/`Wireless` is mapped before it gets here.
     * null = not known; the filter never guesses one. Facts only: no score depends on them here, and
     * like every catalogue fact they are not numbers the analysis may quote.
     * Optional until the server fills them.
     */
    shape: z.enum(SHAPES).nullable().optional(),
    connectivity: z.enum(CONNECTIVITY).nullable().optional(),
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
  /**
   * 2026-10-09 (Kirby, candidate): other catalogue entries with the same
   * shell as this one, shown on its card ("同款殼：Wireless、4K…", Kirby 2026-10-14).
   *
   * Same shell, compared with strict equality (`===`, no case folding, no
   * trimming, no rounding): `brand`, `lengthMm`, `widthMm`, `heightMm`, and
   * every shape descriptor of the catalogue row: `shape`,
   * `handCompatibility`, `humpPlacement`, `frontFlare`, `sideCurvature`,
   * `thumbRest` and `ringFingerRest` (a null matches only a null), and the
   * model family: the lower-cased `model` with its version words removed
   * (`shellFamily`, src/server/fit/shell-family.ts: connection, polling rate,
   * trim and finish words, a leading "x <partner>" tag; numbers, versions and
   * size words stay). Equal numbers alone are not enough, because different
   * mice can share them (Kirby 2026-10-14, candidate / 未拍板: 卡片不要亂併);
   * a doubtful pair stays two cards. Weight, connectivity and the version
   * words may differ.
   *
   * Which rows: only the ranked results. Grouping runs after the unlisted
   * filter, after exclusion and after scoring, so neither an unlisted row nor
   * a row excluded for this hand (a left-handed version, say) is ever a
   * variant.
   *
   * Groups, in order:
   * 1. Group the ranked results by the key above.
   * 2. A group's shown entry is its member with the best total; on a tie, the
   *    one with the earlier rank before grouping. Its other members become
   *    its `variants`, ordered by their rank before grouping.
   * 3. The shown entries keep their order before grouping and are renumbered
   *    1..n with no gaps; `rank` is that new number. Nothing else on an entry
   *    changes.
   * A variant carries catalogue facts only, no score and no rank: it is never
   * presented as a separate result. 2026-10-10 (candidate): a variant may
   * carry its `connectivity` (same meaning and values as `mouse.connectivity`),
   * so the results filter can keep a card when any member matches 連線方式
   * (members of one shell may differ in connectivity and weight, never in
   * shape). Optional until the server fills it.
   *
   * Hard rule 2: variants are not part of the analysis input. The analysis
   * input (src/server/analysis/input.ts, `toInputEntry`) and the share card
   * input must not carry them, and no variant number (weightG) may enter the
   * analysis numeral allow-list. The PR that fills this field adds a test
   * that pins it: a response with variants yields the same analysis input as
   * one without.
   *
   * Optional until the server fills it; absent or [] means no variants.
   */
  variants: z
    .array(
      z.strictObject({
        slug: z.string(),
        model: z.string(),
        weightG: z.number().nullable(),
        connectivity: z.enum(CONNECTIVITY).nullable().optional(),
      }),
    )
    .optional(),
  /**
   * 2026-10-18 (fit-v2.0 candidate, 未拍板): the share of resampled inputs,
   * 0 to 1, under which this entry stays in the top 5. The engine perturbs the
   * measured hand length and palm width by their assumed measurement noise
   * (v1's σ_meas, 6 mm and 4 mm, which nobody has validated), re-ranks, and
   * counts. It says how much the ranking would move if the measurement moved;
   * it is NOT a probability that the mouse fits, and no copy may call it that
   * (no "match chance", no "confidence"). Only the first 10 entries carry it,
   * and only a v2 engine fills it.
   *
   * Hard rule 2: not part of the analysis input; `toInputEntry` picks fields
   * by name and must keep leaving it out, and its numbers stay out of the
   * numeral allow-list. Optional until a v2 engine fills it.
   */
  rankStability: z.number().min(0).max(1).optional(),
});

/**
 * 2026-10-18 (fit-v2.0 candidate, 未拍板): how the hand's length target sits
 * against the length range of the mice this response ranked. Only a v2 engine
 * fills it; v0 and v1 responses never carry it.
 *
 * What it means: when the length target of any grip in play falls outside
 * [min, max] of the ranked mice's lengths, the engine ranks against the
 * nearest edge of that range (a "clamp") instead of the true target.
 * `lengthOutOfRange` is true then. `usedGripLengthTargetMm` is the true,
 * unclamped length target of the grip used (the same number as
 * `targets.lengthMm`), and `catalogueLengthRangeMm` is [min, max] of the ranked
 * lengths (the two may be equal when one mouse is ranked). When nothing is
 * rankable (an empty catalogue, or every mouse excluded) the engine leaves the
 * whole block out.
 *
 * `direction` is "above" or "below" when the grip USED is clamped, and null
 * otherwise: a blended, unstated grip can have a clamped palm target while the
 * used (arg-max) grip is not, so `direction` null with `lengthOutOfRange` true
 * is valid.
 *
 * Hard rule for every consumer: while `lengthOutOfRange` is true, never show a
 * numeric score or a band. The ranking ORDER is meaningful; `total` is not, it
 * is the value the engine sorted by against an edge of the catalogue, not a
 * distance to this person's hand. That covers `results[].total`, the
 * `excluded[].total` of a wrong-hand mouse, the results page, the share card
 * (`share/input.ts`: `total`, `bandLabel`) and the analysis input
 * (`src/server/analysis/input.ts`: `total`, `band`, and sub-score `params`).
 * The engine keeps `subscores` (scores, reason codes, params) on the TRUE
 * target, so they stay honest; they will not average to `total` here.
 *
 * Gate: until every consumer above handles `coverage`, a v2 engine must not
 * become `DEFAULT_ENGINE` nor be wired into those paths (a test pins the
 * default). Facts only: hard rule 2 applies, so nothing here may enter the
 * analysis input or the share card input, or the analysis numeral allow-list.
 * The one exception (2026-10-20): the analysis input may carry that the fit is
 * unscored (a mode, not a number), so the prompt can write without a score.
 *
 * Rollout: this contract ships and deploys before any engine that fills it.
 * Clients parse the response with a strict schema, so a client from before
 * this change refuses a response that carries these keys.
 */
export const fitCoverageSchema = z
  .strictObject({
    lengthOutOfRange: z.boolean(),
    direction: z.enum(["above", "below"]).nullable(),
    usedGripLengthTargetMm: z.number().finite(),
    catalogueLengthRangeMm: z.tuple([z.number().finite(), z.number().finite()]),
  })
  .refine((c) => c.catalogueLengthRangeMm[0] <= c.catalogueLengthRangeMm[1], {
    message: "range minimum must not exceed its maximum",
    path: ["catalogueLengthRangeMm"],
  })
  .refine((c) => c.direction === null || c.lengthOutOfRange, {
    message: "a direction needs lengthOutOfRange to be true",
    path: ["direction"],
  });

/**
 * 2026-10-19 (fit-v3.0 candidate, 未拍板): one dimension of the personal
 * calibration a v3 engine applies when the request carries `references`.
 *
 * `shiftMm` is what the engine added to this dimension's target, after its
 * per-dimension Bayesian update from the person's "short / right / long"
 * answers about mice they own. `answers` counts the references that answered
 * this dimension and took part. `conflict` is true when those answers cannot
 * all hold at once (the engine's own fit test); the dimension is then frozen:
 * `shiftMm` is exactly 0 and the target is the uncalibrated one.
 */
export const fitCalibrationDimSchema = z
  .strictObject({
    shiftMm: z.number().finite(),
    answers: z.number().int().min(0).max(8),
    conflict: z.boolean(),
  })
  .refine((d) => !d.conflict || d.shiftMm === 0, {
    message: "a dimension in conflict is frozen at a shift of 0",
    path: ["shiftMm"],
  })
  .refine((d) => d.answers > 0 || (d.shiftMm === 0 && !d.conflict), {
    message: "a dimension nobody answered has no shift and no conflict",
    path: ["shiftMm"],
  });

/**
 * 2026-10-19 (fit-v3.0 candidate, 未拍板): the personal calibration of a v3
 * engine. Present only when a v3 engine scored a request that carried
 * `references`; v0, v1 and v2 never fill it.
 *
 * `referencesUsed` counts the references that took part in at least one
 * dimension: a known, listed slug, not `specialUse`. The response `targets`
 * already include the shifts.
 *
 * Facts only, hard rule 2: nothing here enters the analysis input, the share
 * card input or the analysis numeral allow-list, except one boolean
 * (2026-10-20): the analysis input may say that the targets were personally
 * adjusted (a non-zero shift exists), never by how much or from which mice, so
 * the analysis does not claim the targets come from the hand alone. Gate: a v3 engine must not
 * become `DEFAULT_ENGINE` nor be wired into those paths until every consumer
 * handles this block (a test pins the default).
 */
export const fitCalibrationSchema = z.strictObject({
  referencesUsed: z.number().int().min(0).max(8),
  dims: z.strictObject({
    length: fitCalibrationDimSchema,
    gripWidth: fitCalibrationDimSchema,
    height: fitCalibrationDimSchema,
  }),
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
  /** fit-v2.0 candidate: see `fitCoverageSchema`. Optional until a v2 engine fills it. */
  coverage: fitCoverageSchema.optional(),
  /** fit-v3.0 candidate: see `fitCalibrationSchema`. Optional until a v3 engine fills it. */
  calibration: fitCalibrationSchema.optional(),
});

/** "Short / narrow / low" (-1), "just right" (0), "long / wide / high" (1), or no answer (null). */
export const fitFeelSchema = z
  .union([z.literal(-1), z.literal(0), z.literal(1)])
  .nullable();

/**
 * 2026-10-19 (fit-v3.0 candidate, 未拍板): a mouse the person owns and how it
 * feels to them in their usual grip(s). Only a v3 engine reads references;
 * every other engine ignores them and scores exactly as before.
 *
 * - `slug` is a catalogue slug; an unknown or unlisted slug is ignored.
 * - `grips` are the grips the person uses on this mouse (any of three; empty
 *   means "the grip used for this hand").
 * - `feel` answers per dimension, each -1 / 0 / 1 or null (not answered); a
 *   dimension left out is read as null, so a client that only asks about
 *   length still sends a valid reference.
 * - `specialUse` marks a mouse chosen for a feature rather than for fit (it
 *   works on glass, it travels): it never calibrates.
 *
 * Engine rules a v3 engine must follow (candidate): an ergonomic shell's
 * catalogue height is the top of the shell, not where the palm rests, so an
 * ergonomic reference calibrates length and grip width only, never height.
 *
 * Privacy: the server uses references for this request only and stores none
 * of them; storing them needs Kirby's decision and a consented table.
 *
 * Automatic references (Kirby, 2026-10-20, candidate): when a request sends no
 * `references`, a v3 engine serving a signed-in person may build them on the
 * server from that person's own survey ratings (a catalogue mouse rated 4 or 5
 * gives "just right" for each dimension it has no pain point on), and only
 * calibrates when at least two of them would be used. They are read for that
 * request and stored nowhere else.
 */
export const fitReferenceSchema = z
  .strictObject({
    slug: z.string().min(1).max(160),
    grips: z.array(z.enum(GRIP_STYLES)).max(3),
    feel: z.strictObject({
      length: fitFeelSchema.default(null),
      width: fitFeelSchema.default(null),
      height: fitFeelSchema.default(null),
    }),
    specialUse: z.boolean().default(false),
  })
  .refine((r) => new Set(r.grips).size === r.grips.length, {
    message: "each grip at most once",
    path: ["grips"],
  });

/**
 * Optional user preferences sent with a fit request.
 *
 * `palmThickness` (candidate, 2026-10-11) is the person's own three-way answer,
 * the same levels as `scanSubmissionSchema.palmThicknessStated`. Like
 * `gripStyle` it overrides what is stored with the scan for this request. Absent
 * means no answer: the engine must then score exactly as before, and a client
 * never sends `"medium"` as a default (a default would be read as a choice).
 */
export const fitPreferencesSchema = z.strictObject({
  gripStyle: z.enum(GRIP_STYLES).optional(),
  palmThickness: z.enum(PALM_THICKNESS_LEVELS).optional(),
  weightG: z
    .strictObject({
      min: z.number().min(20).max(200),
      max: z.number().min(20).max(200),
    })
    .refine((w) => w.min <= w.max, { message: "min must not exceed max" })
    .optional(),
  includeVertical: z.boolean().default(false),
  /** fit-v3.0 candidate: see `fitReferenceSchema`. At most 8, one per slug. */
  references: z
    .array(fitReferenceSchema)
    .max(8)
    .refine((rs) => new Set(rs.map((r) => r.slug)).size === rs.length, {
      message: "each mouse at most once",
    })
    .optional(),
});

export type FitEntry = z.infer<typeof fitEntrySchema>;
export type HandType = NonNullable<FitResponse["handType"]>;
export type FitResponse = z.infer<typeof fitResponseSchema>;
export type FitCoverage = z.infer<typeof fitCoverageSchema>;
export type FitPreferences = z.infer<typeof fitPreferencesSchema>;
export type FitCalibration = z.infer<typeof fitCalibrationSchema>;
export type FitReference = z.infer<typeof fitReferenceSchema>;
export type FitFeel = z.infer<typeof fitFeelSchema>;
