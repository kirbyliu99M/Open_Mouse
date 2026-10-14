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
 *     have an open box): one open comment (`MAX_FEEDBACK_CHARS`). No response
 *     schema in the contracts carries the comment, nor the brand and size feel
 *     of another mouse, except `surveyMineResponseSchema` (owner-only, below):
 *     they are read by the maintainers and by their owner, never shown to
 *     other visitors. Showing an aggregate of the brands later would need a
 *     contract PR of its own and Kirby's say. A signed-in contributor's
 *     withdrawal removes all of it.
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
 * therefore never empty. The similar-hand answer (recommend.ts) reports the
 * caller's own grip in its `basis`; the grip stored here is compared only if
 * the engine's same-grip rule is switched on, which is a candidate (the first
 * engine draft leaves it off, so hand size alone decides who is similar).
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
 *     leaves it where it was; an `otherMouse` is matched on its brand slug, so
 *     the same slug replaces the earlier answer and a new slug is added (every
 *     brand that is not listed is the one slug `other`, so a person keeps at
 *     most one unlisted-brand answer); `mainUse` is replaced by the latest
 *     answer, and kept when the later body gives none; each `feedback` is kept
 *     as written, since it is a message and not a profile. Withdrawal removes
 *     all of it.
 *   - Two edges of those candidate rules, spelled out because the body cannot
 *     say more: a body cannot say "I have no current mouse", and rating the
 *     current mouse again (or answering its brand slug again) with
 *     `current: false` does not clear its marker; the marker moves only when a
 *     later submission marks another mouse. A replaced rating takes the new
 *     answer's `satisfaction`, `duration` and `painPoints` (an absent
 *     `duration` clears the old one), never a merge of old and new; only the
 *     current marker is carried over, as just said.
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
export const commentText = z
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

/**
 * The most mice a signed-in person can keep on their account (ratings and
 * other mice together). Wider than `MAX_RATED_MICE`, which caps one
 * submission: a person who scans and answers more than once builds up more
 * than five. A candidate (未拍板). Known limit: only an edit enforces it. A
 * person who answers in many submissions with different mice can pass it
 * (the read-back answer then lists them all), and must take the count down
 * to this number before an edit is accepted.
 */
export const MAX_ACCOUNT_MICE = 30;

/**
 * Signed-in people can read back and edit their own answers (candidate, Kirby,
 * 2026-10-11: "可以改"). What this changes in the rules above:
 *   - `GET /api/survey` returns the caller's own answers, including the
 *     comment and the brand and size feel of other mice. They go to their
 *     owner only: still never to other visitors, and still in no aggregate.
 *   - `PUT /api/survey` replaces the caller's answers as a whole, not a merge:
 *     what the body leaves out is removed. That lets a person say what a
 *     submission cannot ("no mouse is my current one", a main use cleared),
 *     and it removes the two edges the repeat rules list above for edits.
 *   - It edits the answers kept per account (ratings, other mice, main use)
 *     and the comment of the account's latest contribution. It never touches
 *     a hand profile or a grip: those were read from a scan, so they change
 *     only through a new submission that names a scan.
 *   - It needs an existing contribution: with none there is no hand profile to
 *     attach, so the first answers are given on the results page (404 here).
 *   - No new consent tick: the tick was given at submission and the edit keeps
 *     its record. A new consent version asks again on the next submission.
 *   - Anonymous people cannot read or edit; their contribution is tied to no
 *     account (401).
 */

/** The caller's other mice as read back or edited: brand, size feel, current. */
const otherMiceSchema = z
  .array(otherMouseSchema)
  .max(MAX_ACCOUNT_MICE)
  .refine((rows) => new Set(rows.map((r) => r.brand)).size === rows.length, {
    message: "each brand can be answered once",
  });

/** `PUT /api/survey` body: the whole set of the caller's answers after the edit. */
export const surveyEditSchema = z
  .strictObject({
    /** Left out or `null`, it is cleared (`null` is what the read-back answer says for none). */
    mainUse: z.enum(MAIN_USES).nullish(),
    ratings: z
      .array(ratingSchema)
      .max(MAX_ACCOUNT_MICE)
      .refine((rows) => new Set(rows.map((r) => r.slug)).size === rows.length, {
        message: "each mouse can be rated once",
      })
      .default([]),
    otherMice: otherMiceSchema.default([]),
    /** Replaces the latest contribution's comment; left out or `null`, it is removed. */
    feedback: commentText.nullish(),
  })
  .superRefine((body, ctx) => {
    if (body.ratings.length + body.otherMice.length === 0) {
      // Taking everything back is `DELETE /api/survey`, not an edit.
      ctx.addIssue({
        code: "custom",
        path: ["ratings"],
        message: "name at least one mouse",
      });
    }
    if (body.ratings.length + body.otherMice.length > MAX_ACCOUNT_MICE) {
      ctx.addIssue({
        code: "custom",
        path: ["ratings"],
        message: `at most ${MAX_ACCOUNT_MICE} mice in all`,
      });
    }
    const current =
      body.ratings.filter((r) => r.current).length +
      body.otherMice.filter((m) => m.current).length;
    if (current > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["ratings"],
        message: "only one mouse can be the current one",
      });
    }
  });

/** `GET /api/survey` 200 body: the caller's own answers, `null` where none is kept. */
export const surveyMineResponseSchema = z.strictObject({
  mainUse: z.enum(MAIN_USES).nullable(),
  ratings: z.array(ratingSchema),
  otherMice: otherMiceSchema,
  feedback: z.string().nullable(),
});

/** `200` body of an edit. */
export const surveyEditResponseSchema = z.strictObject({
  stored: z.literal(true),
});

export type SurveySubmission = z.infer<typeof surveySubmissionSchema>;
export type SurveySubmitResponse = z.infer<typeof surveySubmitResponseSchema>;
export type SurveyEdit = z.infer<typeof surveyEditSchema>;
export type SurveyMineResponse = z.infer<typeof surveyMineResponseSchema>;
export type SurveyEditResponse = z.infer<typeof surveyEditResponseSchema>;
