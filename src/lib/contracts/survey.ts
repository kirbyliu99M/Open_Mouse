/**
 * Survey contract — the optional questionnaire on the results page, and the
 * consent that goes with it. Everything here is a candidate (未拍板) until
 * Kirby confirms the questions and the consent copy.
 *
 * What is kept, and what is not:
 *   - Kept only after an explicit tick: which mice the person has used (and
 *     which one they use now), how satisfied they are, what they mainly use a
 *     mouse for, the brand (picked from `OTHER_MOUSE_BRANDS`) and the size feel
 *     (`SIZE_FEELS`) of a mouse that is not in the catalogue, and a coarse
 *     hand profile (hand length and palm width rounded DOWN to
 *     `CONTRIBUTION_BIN_MM`, plus the grip). The profile is
 *     read by the server from the scan named in the request, never taken from
 *     the client, and it is stored apart from the scan: it does not expire
 *     with the anonymous session and does not point back to the scan.
 *   - Free text, ONE field (Kirby, 2026-10-05: an ordinary questionnaire may
 *     have an open box): one open comment (`MAX_FEEDBACK_CHARS`). The brand of
 *     another mouse was free text in the first v2 draft and is a pick from a
 *     list since 2026-10-06. No response schema in the contracts carries the
 *     comment: it is read by the maintainers only, never shown to other
 *     visitors. A signed-in contributor's withdrawal removes it too.
 *   - What the schema refuses in the comment: control characters other than
 *     line breaks and tabs, and unpaired surrogates (a NUL cannot be stored in
 *     a Postgres text column, so it must be a 400, not a failed write), and
 *     what is mechanically recognisable as contact details, an email address
 *     or a phone-like run of digits (`looksLikeContactDetails`, the same check
 *     the learning-kit free text uses; a candidate, and Kirby may drop it). A
 *     name cannot be recognised, so a name typed into the box IS kept: no
 *     question asks for one, the consent copy must tell people not to write
 *     personal details, and it must not say that none are stored.
 *   - Never asked for: photos, names, email. No question asks about health or
 *     discomfort (Kirby): `PAIN_POINTS` is about what bothered the person
 *     in the mouse, not about their body.
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
 *   - The v2 answers of a signed-in person across submissions (candidate rules,
 *     Kirby decides): at most one mouse is `current` for the account, so a
 *     later submission that marks one moves the marker and one that marks none
 *     leaves it where it was; an `otherMouse` is matched on its brand, so the
 *     same brand replaces the earlier answer and a new brand is added;
 *     `mainUse` is replaced by the latest
 *     answer, and kept when the later body gives none; each `feedback` is kept
 *     as written, since it is a message and not a profile. Withdrawal removes
 *     all of it.
 *   - An anonymous person scanning twice can contribute twice. Nothing ties
 *     those scans together; the per-IP rate limit and the minimum number of
 *     raters the similar-hand answer needs (recommend.ts) are the only
 *     mitigation, and that is a known limit, not a promise.
 * Change this file only in a PR of its own.
 */
import { z } from "zod";
import { looksLikeContactDetails } from "../learning/session";
import { GRIP_STYLES } from "./fit";

/**
 * Version of the consent text the person ticked. Bump it when the copy changes.
 * v2 (candidate): the survey gained free text, so the consent copy changed.
 * The server stores the version it was given; nothing is migrated by this
 * contract, and a v1 body is refused.
 */
export const SURVEY_CONSENT_VERSION = "survey-consent-v2-draft";

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

/** What the person mainly uses a mouse for: office, gaming or both (Kirby, 2026-10-06). */
export const MAIN_USES = ["office", "gaming", "mixed"] as const;
export type MainUse = (typeof MAIN_USES)[number];

/** How the size of a mouse felt in the hand: smaller, about right, larger (Kirby, 2026-10-06). */
export const SIZE_FEELS = ["small", "just_right", "large"] as const;
export type SizeFeel = (typeof SIZE_FEELS)[number];

/**
 * Brands a person can pick for a mouse that is not in the catalogue (Kirby,
 * 2026-10-06: a drop-down of the main brands, not free text). Slugs only; the
 * words people see belong to the page. The list is a candidate (未拍板) and
 * `other` stands for any brand not listed.
 */
export const OTHER_MOUSE_BRANDS = [
  "logitech",
  "razer",
  "steelseries",
  "corsair",
  "hyperx",
  "asus",
  "msi",
  "acer",
  "zowie",
  "glorious",
  "pulsar",
  "finalmouse",
  "vaxee",
  "endgame_gear",
  "cooler_master",
  "microsoft",
  "apple",
  "hp",
  "dell",
  "lenovo",
  "xiaomi",
  "anker",
  "elecom",
  "kensington",
  "other",
] as const;
export type OtherMouseBrand = (typeof OTHER_MOUSE_BRANDS)[number];

export const MAX_RATED_MICE = 5;
export const MAX_FEEDBACK_CHARS = 500;

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
  /** True when this is the mouse the person uses now. At most one per body. */
  current: z.boolean().default(false),
});

/**
 * The open comment, trimmed, 1 to `MAX_FEEDBACK_CHARS` characters. See the
 * header for why each refusal exists. It may hold line breaks and tabs.
 */
const commentText = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FEEDBACK_CHARS)
  .refine((s) => !/\p{Cc}/u.test(s.replace(/[\t\n\r]/g, "")), {
    message: "text must not hold control characters",
  })
  .refine((s) => !/\p{Cs}/u.test(s), {
    message: "text must be well-formed Unicode",
  })
  .refine((s) => !looksLikeContactDetails(s), {
    message: "text must not hold an email address or a phone number",
  });

/** A mouse that is not in the catalogue: its brand from the list, and how its size felt. */
const otherMouseSchema = z.strictObject({
  brand: z.enum(OTHER_MOUSE_BRANDS),
  sizeFeel: z.enum(SIZE_FEELS),
  /** True when this is the mouse the person uses now. */
  current: z.boolean().default(false),
});

/**
 * `POST /api/survey` body. At least one mouse is named, either as a catalogue
 * rating or as `otherMouse`; at most one of all of them is marked `current`.
 */
export const surveySubmissionSchema = z
  .strictObject({
    /** The scan whose hand profile is contributed. Ownership rule: routes.ts. */
    scanId: z.string().uuid(),
    consent: z.strictObject({
      accepted: z.literal(true),
      version: z.literal(SURVEY_CONSENT_VERSION),
    }),
    /** The grip the person says they use, if they say. */
    gripStyle: z.enum(GRIP_STYLES).optional(),
    mainUse: z.enum(MAIN_USES).optional(),
    ratings: z
      .array(ratingSchema)
      .max(MAX_RATED_MICE)
      .refine((rows) => new Set(rows.map((r) => r.slug)).size === rows.length, {
        message: "each mouse can be rated once",
      })
      .default([]),
    otherMouse: otherMouseSchema.optional(),
    /** One open comment. Never returned to other visitors. */
    feedback: commentText.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.ratings.length === 0 && body.otherMouse === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["ratings"],
        message: "name at least one mouse",
      });
    }
    const current =
      body.ratings.filter((r) => r.current).length +
      (body.otherMouse?.current ? 1 : 0);
    if (current > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["ratings"],
        message: "only one mouse can be the current one",
      });
    }
  });

/** `201` body: what the page may truthfully tell the person afterwards. */
export const surveySubmitResponseSchema = z.strictObject({
  stored: z.literal(true),
  /** True only when the contribution is tied to a signed-in account. */
  withdrawable: z.boolean(),
});

export type SurveySubmission = z.infer<typeof surveySubmissionSchema>;
export type SurveySubmitResponse = z.infer<typeof surveySubmitResponseSchema>;
