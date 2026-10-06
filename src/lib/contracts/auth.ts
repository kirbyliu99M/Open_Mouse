/**
 * Sign-in contract — the form limits for username + password sign-in
 * (docs/design/auth-username-password-2026-10-04/README.md, approved by Kirby
 * on 2026-10-04 with every value in its "Values" table). The forms are
 * Next.js server actions, not JSON routes, so what the builders code against is
 * these schemas: the client and the server run the same ones, and a rule lives
 * here or nowhere.
 *
 * Approved values: a password is 10 to 128 characters, with no composition
 * rules, and not equal to the username; a username is 3 to 32 characters of
 * `a-z 0-9 _ . -`, case-insensitive, with a short reserved list; the email is
 * optional and only stored (nothing is sent until a sending system exists).
 * Rate limits, token lifetimes and the scrypt cost are the backend's, not the
 * seam's: they stay in the spec's Values table.
 *
 * Candidates (未拍板), because the spec leaves them open:
 *   - what is on `RESERVED_USERNAMES` (the spec says "a short reserved list");
 *   - that a username may start or end with `.`, `_` or `-` (the spec limits
 *     only the characters and the length);
 *   - the shape of the reset token (`RESET_TOKEN_PATTERN`: the spec says a
 *     random token of at least 32 bytes, stored only as its SHA-256; the
 *     encoding, base64url, and the upper bound of 128 characters are Claude's
 *     choice).
 *
 * What the schemas do, so that nobody re-implements it:
 *   - A username is trimmed and lower-cased by the schema: the parsed value is
 *     the one that is stored and compared. Sign-in uses a looser schema
 *     (`signInSchema`) on purpose: a username that could never exist must fail
 *     like a wrong password does, with the one message the spec requires, and
 *     not with a message about the username's shape. So a handler maps EVERY
 *     failure of `signInSchema` to that one message, and never to a schema
 *     message.
 *   - `signInSchema` drops keys it does not know instead of refusing them: the
 *     installed Auth.js hands `authorize()` the whole request body, which
 *     carries `callbackUrl` (and `csrfToken` from a browser). The other form
 *     schemas refuse unknown keys.
 *   - No schema message carries the input, and a handler still never returns or
 *     logs a message from these schemas as it is: Zod's own message for an
 *     unrecognised key repeats the key's name, which is the caller's text. A
 *     handler maps issues to fixed strings of its own.
 *   - A password is never trimmed or changed. It is counted in characters
 *     (Unicode code points), not UTF-16 units, so five emoji are five. Lone
 *     surrogates are refused: they cannot round-trip through UTF-8, and two
 *     different passwords would hash alike.
 *   - A password equal to the username (after the username is normalised) is
 *     refused at sign-up. `passwordEqualsUsername` is exported for the reset
 *     step, which knows the account from the token and not from the form.
 *   - An email is optional; an empty string counts as absent (a form sends one).
 *     It is trimmed, lower-cased and limited to 254 characters, the spec's and
 *     the standard's maximum.
 *   - The two free-text fields that reach the database or an operator's
 *     terminal without a character set (the sign-in username and the reset
 *     request's identifier) refuse control, format (bidirectional marks,
 *     zero-width characters), line and paragraph separator characters and
 *     lone surrogates: a NUL cannot be stored in a Postgres text column, so it
 *     must fail in the schema and not as a failed write (the survey contract
 *     does the same), and `npm run auth:reset-requests` prints the identifier,
 *     so it must not hold a terminal escape or a forged line.
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

export const USERNAME_MIN_CHARS = 3;
export const USERNAME_MAX_CHARS = 32;
export const PASSWORD_MIN_CHARS = 10;
export const PASSWORD_MAX_CHARS = 128;
/** The longest an email address or a reset request's identifier may be. */
export const EMAIL_MAX_CHARS = 254;

/** Where the reset form lives; the token is the `token` query parameter. */
export const ACCOUNT_RESET_PATH = "/account/reset";

/**
 * Names nobody may sign up as (candidate, 未拍板): they read as the site's own
 * voice. Compared after the username is normalised.
 */
export const RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "security",
  "staff",
  "moderator",
  "owner",
  "official",
  "openmouse",
  "open_mouse",
  "anonymous",
  "null",
  "undefined",
] as const;

const USERNAME_PATTERN = /^[a-z0-9_.-]+$/;

const normaliseUsername = (s: string): string => s.trim().toLowerCase();

/** Control, format, line/paragraph separator and lone-surrogate characters. */
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const isSafeText = (s: string): boolean => !UNSAFE_TEXT.test(s);

/** The username a person picks at sign-up. Parsed value = stored value. */
export const usernameSchema = z
  .string()
  .transform(normaliseUsername)
  .pipe(
    z
      .string()
      .min(USERNAME_MIN_CHARS)
      .max(USERNAME_MAX_CHARS)
      .regex(USERNAME_PATTERN, {
        message: "a username holds only a-z, 0-9, _, . and -",
      })
      .refine((s) => !(RESERVED_USERNAMES as readonly string[]).includes(s), {
        message: "that username is reserved",
      }),
  );

/** Characters, not UTF-16 units: an emoji is one. */
const charCount = (s: string): number => Array.from(s).length;

/** The password a person picks (sign-up, reset). Never trimmed or changed. */
export const passwordSchema = z
  .string()
  .refine((s) => charCount(s) >= PASSWORD_MIN_CHARS, {
    message: `a password has at least ${PASSWORD_MIN_CHARS} characters`,
  })
  .refine((s) => charCount(s) <= PASSWORD_MAX_CHARS, {
    message: `a password has at most ${PASSWORD_MAX_CHARS} characters`,
  })
  .refine((s) => !/\p{Cs}/u.test(s), {
    message: "a password must not hold unpaired surrogates",
  });

/** True when the password is the username, case aside (both as typed). */
export function passwordEqualsUsername(
  username: string,
  password: string,
): boolean {
  return normaliseUsername(password) === normaliseUsername(username);
}

const emailText = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().max(EMAIL_MAX_CHARS).pipe(z.email()));

/** An optional email: absent, or an empty string, both mean none. */
export const optionalEmailSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  emailText.optional(),
);

/** Sign-up: the three fields of the form. */
export const signUpSchema = z
  .strictObject({
    username: usernameSchema,
    password: passwordSchema,
    email: optionalEmailSchema,
  })
  .superRefine((value, ctx) => {
    if (passwordEqualsUsername(value.username, value.password)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "a password must not be the username",
      });
    }
  });

/**
 * Sign-in: only the sanity limits that stop an oversized body from reaching
 * the hash (a password past the maximum can never have been set). A username
 * or password that cannot exist fails here or in the check the same way, so a
 * caller learns nothing about which part was wrong.
 */
export const signInSchema = z.object({
  username: z
    .string()
    .transform(normaliseUsername)
    .pipe(
      z
        .string()
        .min(1)
        .max(USERNAME_MAX_CHARS)
        .refine(isSafeText, { message: "that username cannot exist" }),
    ),
  // Zod counts characters, as `passwordSchema` does, so this is twice the
  // maximum a password can have: a loose limit that no set password reaches.
  password: z
    .string()
    .min(1)
    .max(PASSWORD_MAX_CHARS * 2)
    .refine((s) => !/\p{Cs}/u.test(s), {
      message: "that password cannot exist",
    }),
});

/**
 * "Forgot password": whatever the person typed to identify themselves, a
 * username or an email. Trimmed, then stored as typed (at most 254 characters,
 * counted after the trim); matching is the server's. The answer is always
 * "received". Control and similar characters are refused (see the header).
 */
export const resetRequestSchema = z.strictObject({
  identifier: z
    .string()
    .trim()
    .min(1)
    .max(EMAIL_MAX_CHARS)
    .refine(isSafeText, { message: "that cannot be an identifier" }),
});

/** Random bytes in a reset token (the spec: at least 32). */
export const RESET_TOKEN_BYTES = 32;
/** base64url of at least 32 bytes is at least 43 characters. */
export const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

/** The reset page: the token from the link and the new password. */
export const resetCompleteSchema = z.strictObject({
  token: z.string().regex(RESET_TOKEN_PATTERN),
  password: passwordSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetCompleteInput = z.infer<typeof resetCompleteSchema>;
