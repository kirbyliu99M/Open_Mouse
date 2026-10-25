/**
 * Result feedback contract — the 1-to-5-star rating of a scan's results, with
 * one optional comment, asked in a sheet on the results page. Everything here
 * is a candidate (未拍板) until Kirby confirms it.
 *
 * How it differs from the survey (survey.ts): the survey asks how the person
 * gets on with mice they have used and contributes a hand profile; this asks
 * whether the ranking the engine gave them feels right. The two never share a
 * row.
 *
 * What is kept, and what is not:
 *   - From the body: the stars, the comment if any, and the page's language.
 *   - Read by the server from the scan named in the path, never taken from the
 *     client (a snapshot, `resultFeedbackSnapshotSchema`): the engine version,
 *     the hand type (size class and width class, `HAND_TYPE_SIZES` and
 *     `HAND_TYPE_WIDTHS`, the same display-only classes the results page
 *     shows), the grip the engine used, how the scan was calibrated, the
 *     palm thickness the person stated, and the engine's first three mice with
 *     their fit band.
 *   - How the snapshot is computed, so it does not depend on what the page
 *     last asked for: the server runs the current default engine on the
 *     scan's stored measurements with EMPTY preferences (`{}`: the same result
 *     an empty fit request gets, which for a signed-in person under a v3
 *     engine includes the automatic survey calibration), at the moment of the
 *     POST. It does NOT read `fit_results`, which is no longer written
 *     (2026-10-20) and only holds older rows.
 *     So `grip` is the grip the engine used for `{}` (the stated grip, else
 *     the predicted one), `palmThicknessStated` is the scan's own column, the
 *     ranking is before any filter or preference the page had on, the band is
 *     `bandOf` (src/lib/fit/bands.ts) of each mouse's total score, and the
 *     hand type is what the fit response's `handType` would say (null when
 *     that response has none). A first-three mouse with no band (`bandOf`
 *     gives null) is a 500, not a guess: a ranked mouse always has a total.
 *     2026-10-20 (fit-v3.0 candidate): when the fit response says the hand's
 *     length is outside what the catalogue covers (`coverage.lengthOutOfRange`),
 *     no band may be shown or kept, so each `band` is null for that snapshot.
 *     null means "out of the catalogue's range", never "unknown".
 *   - Never kept: photos, a millimetre value, a hand-length or palm-width bin,
 *     names, email. Without a measurement, nothing here needs the survey's
 *     consent tick; the page shows a notice above the button instead
 *     (`RESULT_FEEDBACK_NOTICE_VERSION` records which one).
 *   - No link to the scan, as for the survey: the row has no `scan_id` and no
 *     `session_id`, and no timestamp finer than a day, so it outlives the 24 h
 *     anonymous expiry and cannot be matched back to a scan by time. The only
 *     link is a mark on the scan itself, which goes away with the scan and is
 *     what makes a second rating of the same scan a 409.
 *   - The comment follows the survey's rules (`commentText`: control
 *     characters, unpaired surrogates and what looks like contact details are
 *     refused; a name cannot be recognised and is kept). It is read by the
 *     maintainers only: no response schema carries it.
 *
 * Who can take it back:
 *   - A signed-in person's feedback carries their user id and goes with the
 *     account: the account's "Delete everything" MUST remove it, and so does
 *     the inactive-account purge. Deleting one scan does not remove it (there
 *     is no link to follow).
 *   - Anonymous feedback is tied to nothing; it cannot be taken back, and the
 *     notice says so before the button. Signing in later and claiming the
 *     scan does not change that: the row keeps a null user id.
 *   - There is no route that withdraws one rating (no `DELETE`): the page must
 *     not offer one. `withdrawable: true` means "Delete everything" removes it.
 *   - The "Delete this scan" dialog and the account page's delete text must
 *     not promise that deleting a scan removes its feedback. Their wording is
 *     revisited together with the survey's (survey.ts says the same).
 *
 * Manual-entry scans can be rated: the calibration method in the snapshot is
 * what lets them be told apart (the survey refuses them for another reason,
 * the similar-hand pool).
 *
 * Change this file only in a PR of its own.
 */
import { z } from "zod";
import { FIT_BANDS } from "./fit-bands";
import { GRIP_STYLES, HAND_TYPE_SIZES, HAND_TYPE_WIDTHS } from "./fit";
import { LOCALES } from "./locale";
import { CALIBRATION_METHODS, PALM_THICKNESS_LEVELS } from "./measurement";
import { commentText } from "./survey";

/**
 * Version of the notice shown above the button. Bump it when the copy
 * changes; the server stores the version it was given, and an unknown one is
 * refused.
 */
export const RESULT_FEEDBACK_NOTICE_VERSION = "result-feedback-notice-v2-draft";

export const RESULT_FEEDBACK_MIN_STARS = 1;
export const RESULT_FEEDBACK_MAX_STARS = 5;

/** How many of the engine's first places the snapshot keeps. */
export const RESULT_FEEDBACK_TOP_MICE = 3;

/** `POST` body (routes.ts: `resultFeedbackPath`). The scan is in the path. */
export const resultFeedbackSubmissionSchema = z.strictObject({
  notice: z.literal(RESULT_FEEDBACK_NOTICE_VERSION),
  stars: z
    .number()
    .int()
    .min(RESULT_FEEDBACK_MIN_STARS)
    .max(RESULT_FEEDBACK_MAX_STARS),
  comment: commentText.optional(),
  locale: z.enum(LOCALES),
});

/**
 * What the server stores beside the body, read from the scan. Not a request
 * or response body: it is here so the repo and its tests share one shape.
 * A field the scan does not have is `null` (a scan with no stated palm
 * thickness, a ranking shorter than three, a scan scored before hand types).
 */
export const resultFeedbackSnapshotSchema = z.strictObject({
  engineVersion: z.string().min(1).max(100),
  handSize: z.enum(HAND_TYPE_SIZES).nullable(),
  handWidth: z.enum(HAND_TYPE_WIDTHS).nullable(),
  grip: z.enum(GRIP_STYLES),
  calibrationMethod: z.enum(CALIBRATION_METHODS),
  palmThicknessStated: z.enum(PALM_THICKNESS_LEVELS).nullable(),
  /** The engine's places 1 to `RESULT_FEEDBACK_TOP_MICE`, in order. */
  topMice: z
    .array(
      z.strictObject({
        slug: z.string().min(1).max(100),
        /** null only when the fit response's length is out of range (above). */
        band: z.enum(FIT_BANDS).nullable(),
      }),
    )
    .max(RESULT_FEEDBACK_TOP_MICE),
});

/** `201` body: what the page may truthfully say afterwards. */
export const resultFeedbackSubmitResponseSchema = z.strictObject({
  stored: z.literal(true),
  /** True only when the feedback is tied to a signed-in account. */
  withdrawable: z.boolean(),
});

/** `GET` 200 body: whether this scan was already rated, so the sheet stays away. */
export const resultFeedbackStatusResponseSchema = z.strictObject({
  answered: z.boolean(),
});

export type ResultFeedbackSubmission = z.infer<
  typeof resultFeedbackSubmissionSchema
>;
export type ResultFeedbackSnapshot = z.infer<
  typeof resultFeedbackSnapshotSchema
>;
export type ResultFeedbackSubmitResponse = z.infer<
  typeof resultFeedbackSubmitResponseSchema
>;
export type ResultFeedbackStatusResponse = z.infer<
  typeof resultFeedbackStatusResponseSchema
>;
