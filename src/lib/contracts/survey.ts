/**
 * Survey contract — the optional questionnaire on the results page, and the
 * consent that goes with it. Everything here is a candidate (未拍板) until
 * Kirby confirms the questions and the consent copy.
 *
 * What is kept, and what is not:
 *   - Kept only after an explicit tick: which mice the person has used, how
 *     satisfied they are, and a coarse hand profile (hand length and palm width
 *     rounded DOWN to `CONTRIBUTION_BIN_MM`, plus the grip). The profile is
 *     read by the server from the scan named in the request, never taken from
 *     the client, and it is stored apart from the scan: it does not expire
 *     with the anonymous session and does not point back to the scan.
 *   - Never kept: photos, names, email, free text.
 *
 * The grip that is stored: `gripStyle` from the body when given, else the
 * scan's stated grip, else the grip the fit engine used for that scan. It is
 * therefore never empty, which is what the similar-hand answer matches on.
 *
 * Who can take a contribution back, and what removes it:
 *   - A signed-in contributor can withdraw everything they contributed
 *     (`DELETE /api/survey`), and the account's "Delete everything" MUST
 *     withdraw it too: it is the person's own data, and that button promises
 *     everything. The two existing delete texts (the account page and the
 *     "Delete this scan" dialog) must be revisited before this ships: deleting
 *     a scan does NOT remove a contribution made from it. The wording is not
 *     decided here.
 *   - An anonymous contributor has nothing to identify them by afterwards, so
 *     they cannot withdraw; the consent copy must say so before the tick.
 *
 * Repeats:
 *   - One contribution per scan: a second POST naming the same `scanId` is
 *     refused with 409. The contribution still does not point back to the scan;
 *     the server marks the scan itself as having contributed, and that mark
 *     goes away with the scan.
 *   - A signed-in person has at most one rating per mouse: a later submission
 *     that rates a mouse they already rated replaces the earlier rating (still
 *     201), so scanning twice does not count them twice.
 *   - An anonymous person scanning twice can contribute twice. Nothing ties
 *     those scans together; the per-IP rate limit and the minimum number of
 *     raters the similar-hand answer needs (recommend.ts) are the only
 *     mitigation, and that is a known limit, not a promise.
 * Change this file only in a PR of its own.
 */
import { z } from "zod";
import { GRIP_STYLES } from "./fit";

/** Version of the consent text the person ticked. Bump it when the copy changes. */
export const SURVEY_CONSENT_VERSION = "survey-consent-v1-draft";

/** A contributed hand profile is rounded down to this many millimetres. */
export const CONTRIBUTION_BIN_MM = 5;

export const USE_DURATIONS = [
  "under_1_month",
  "1_to_6_months",
  "6_to_12_months",
  "1_to_3_years",
  "over_3_years",
] as const;
export type UseDuration = (typeof USE_DURATIONS)[number];

/** What bothered them most about a mouse they have used. */
export const PAIN_POINTS = [
  "length",
  "width",
  "height",
  "weight",
  "thumb",
  "buttons",
  "other",
] as const;
export type PainPoint = (typeof PAIN_POINTS)[number];

export const MAX_RATED_MICE = 5;

const ratingSchema = z.strictObject({
  /** A catalogue slug; the server rejects one that is not in the catalogue. */
  slug: z.string().min(1).max(100),
  satisfaction: z.number().int().min(1).max(5),
  duration: z.enum(USE_DURATIONS).optional(),
  painPoints: z
    .array(z.enum(PAIN_POINTS))
    .max(PAIN_POINTS.length)
    .refine((points) => new Set(points).size === points.length, {
      message: "each pain point can be named once",
    })
    .default([]),
});

/** `POST /api/survey` body. */
export const surveySubmissionSchema = z.strictObject({
  /** The scan whose hand profile is contributed. Ownership rule: routes.ts. */
  scanId: z.string().uuid(),
  consent: z.strictObject({
    accepted: z.literal(true),
    version: z.literal(SURVEY_CONSENT_VERSION),
  }),
  /** The grip the person says they use, if they say. */
  gripStyle: z.enum(GRIP_STYLES).optional(),
  ratings: z
    .array(ratingSchema)
    .min(1)
    .max(MAX_RATED_MICE)
    .refine((rows) => new Set(rows.map((r) => r.slug)).size === rows.length, {
      message: "each mouse can be rated once",
    }),
});

/** `201` body: what the page may truthfully tell the person afterwards. */
export const surveySubmitResponseSchema = z.strictObject({
  stored: z.literal(true),
  /** True only when the contribution is tied to a signed-in account. */
  withdrawable: z.boolean(),
});

export type SurveySubmission = z.infer<typeof surveySubmissionSchema>;
export type SurveySubmitResponse = z.infer<typeof surveySubmitResponseSchema>;
