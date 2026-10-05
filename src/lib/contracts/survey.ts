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
 *   - A signed-in contributor can withdraw everything they contributed. An
 *     anonymous contributor has nothing to identify them by afterwards, so
 *     they cannot; the consent copy must say so before the tick.
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
  painPoints: z.array(z.enum(PAIN_POINTS)).max(PAIN_POINTS.length).default([]),
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
