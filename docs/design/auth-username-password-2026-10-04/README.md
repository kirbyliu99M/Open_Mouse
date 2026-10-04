# Sign-in with username and password: spec (2026-10-04)

This replaces the Google-only scope of #17. It is for the builders, and it is a
draft until Kirby approves it: every number below that is not in the Decisions
section is a **candidate (未拍板)**.

## Decisions (Kirby, 2026-10-04)

- **Google OAuth is paused.** Sign-in is a username and a password.
- **A user may enter an email as a backup.** The email is only stored. Nothing is
  sent until a sending system is built later ("先只存電郵，後續再建立系統").
- **Password reset is a request form that people handle by hand for now** ("可以變成是一份重設的表單的感覺，我們至少可以先用手動送出").

Claude's reading of the last point, **candidate**: a "forgot password" form stores
a request and always answers "received". An operator-only script lists the
requests and issues a one-time, expiring link, which Kirby sends by hand. There is
no admin web page.

## Not decided (未拍板, candidate)

The values in [Candidates](#candidates), whether the Google code is deleted, and
when the email-sending system is built.

## Scope

In:

- Sign up, sign in, sign out with a username and password.
- An optional email on sign-up (stored only).
- The "forgot password" request form, the reset page, and the two operator scripts.
- `/account`: the new forms, and "Delete everything" also deleting the account.
- Claiming the visitor's anonymous scan session on sign-up and sign-in (as today).

Out: other providers, magic links, sending any email, email verification, profile
editing, two-factor sign-in, an admin web page, "forgot username".

## Why this is more than a provider swap

- **Sessions.** Auth.js's Credentials provider can only be used with JWT sessions
  (its `UnsupportedStrategy` error:
  <https://authjs.dev/reference/core/errors#unsupportedstrategy>). `src/auth.ts`
  uses database sessions when the adapter is available, and its `session`
  callback reads `user.id`; both change.
- **A JWT cannot be revoked on the server.** A deleted user, or a user who just
  reset their password, would stay signed in until the token expires. The
  `session` callback therefore checks the user on every `auth()` call (see
  [Sessions](#sessions)).
- **`AUTH_SECRET` must be set in Production and Preview before sign-in is
  enabled.** Without it, `resolveAuthSecret` returns a random value per process in
  production, and a token signed by one serverless instance would fail on
  another. Only Kirby can set it.
- **New personal data.** The database will hold a username, a password hash and an
  optional email. The privacy copy must say so (see [Copy](#copy)).

## Data model (one additive migration)

- `users` gains `username` (text, unique, stored lowercase), `password_hash`
  (text) and `password_changed_at` (timestamptz). `email` already exists
  (nullable, unique); it is stored lowercase. Both new columns are nullable so that
  existing rows stay valid.
- `password_reset_requests`: `id` (uuid), `user_id` (text, null when nothing
  matched), `identifier` (text, as typed, at most 254 characters), `created_at`,
  `handled_at` (null until an operator issues a link).
- `password_reset_tokens`: `id`, `user_id` (references `users`, cascade),
  `token_hash` (SHA-256 of the token), `expires_at`, `used_at`.
- The Auth.js adapter tables stay as they are; Credentials sign-in does not use
  `accounts` or `auth_sessions`.
- The migration is applied to production **before** the code that needs it
  ships, the way migration 0006 was.

## Passwords

- Hash with Node's built-in `crypto.scrypt` (no new dependency; AGENTS.md pins
  every dependency), a random salt of at least 16 bytes per user, stored as one
  encoded string that carries its own parameters, so the cost can be raised later.
  Compare with `timingSafeEqual`.
- Cost parameters are a candidate: the commonly cited minimum for scrypt is
  N = 2^17, r = 8, p = 1 (OWASP Password Storage Cheat Sheet). Node's default
  `maxmem` is too small for that, so it must be raised. The builder confirms the
  figure and **measures the latency on the Vercel runtime**; the result goes in the
  PR.
- An unknown username is checked against a fixed dummy hash, so the response time
  does not reveal whether the account exists.
- A password is never logged, echoed, or put in an error message. Errors go
  through the existing `redactSecrets`.
- Auth routes run on the Node runtime, not the Edge runtime.

## Sessions

- `session: { strategy: "jwt" }`, with the Credentials provider. The adapter
  stays for the existing tables.
- `session.user.id` comes from the token's subject.
- The `session` callback returns only `user.id` and the expiry, never the raw
  token or any other field. A reviewer's simulation of today's callback (it
  returns the whole session object) with `@auth/core` 0.41.3 handed the raw
  `sessionToken` to browser JavaScript through `GET /api/auth/session`; that is
  not checked on a running server, and it does not matter in production while
  sign-in is off.
- On every `auth()` call the `session` callback loads the user by primary key and
  returns no session when the user is gone, or when the token was issued before
  `password_changed_at`. That is one indexed lookup per call; the builder measures
  it and may cache it for a short time if it matters (candidate: at most 10
  minutes). A deleted user who still holds a valid token must read as signed out:
  otherwise `createClaimedSession` and `claimSession` fail on the foreign key
  (Postgres 23503) and every `POST /api/scans` from that user returns 500 until
  the token expires (a finding of the #117 review).
- Token lifetime is a candidate (7 days).
- `events.signIn` still claims the visitor's anonymous scan session, by the
  httpOnly cookie only, through the shared `parseSessionId` check (#117). The
  builder must **prove with a test** that this event fires for a Credentials
  sign-in; if it does not, the sign-up and sign-in actions call the claim
  explicitly.

## Security requirements

- **Rate limits**, on the existing `rate_limits` table, keyed on an HMAC (as the
  other limits are): sign-in per IP and per username; sign-up per IP; reset
  request per IP. Candidates: 10 sign-in attempts per 10 minutes, 5 sign-ups per
  hour, 5 reset requests per hour. A limited caller writes nothing.
- **One error message for a failed sign-in**, whether the username is unknown or
  the password is wrong.
- **The reset request always answers "received"**, whether or not the identifier
  matched anything.
- **Forms are Next.js server actions**, which carry their own same-origin check;
  no new unauthenticated JSON endpoint is added for them.
- The form limits are in `src/lib/contracts/` (Claude writes that contract first):
  username, password and email schemas, shared by the client and the server.
- **Shared browsers.** The next person who signs in on a browser claims that
  browser's current anonymous scan session, as #17 designed ("Your current scan
  joins your account when you sign in"). #117 fixes only the reverse case, a
  signed-out cookie being reused by a later visitor. Whether sign-in should ask
  before claiming is a candidate (see the table).
- Sign-up says when a username is taken. That reveals the username exists, which
  is accepted for a username (it is not a secret).

## Password reset by hand

- `POST` of the form stores a row in `password_reset_requests` and answers
  "received". Requests older than 30 days are swept (candidate).
- `npm run auth:reset-requests` lists the pending requests (id, time, what was
  typed, whether it matched an account).
- `npm run auth:reset-link -- <username>` issues a link for that account: a random
  token of at least 32 bytes, stored only as its SHA-256, **valid 24 hours
  (candidate; the link is delivered by hand), single use**. Issuing a new link
  invalidates the user's earlier unused ones. It prints the URL once and marks the
  matching request handled.
- Both scripts read `DATABASE_URL_UNPOOLED` and are meant for Kirby or Claude on a
  trusted machine; nothing on the web can call them.
- `/account/reset?token=…` (a server action) checks the token, sets the new
  password, sets `password_changed_at`, and marks the token used. A wrong, used or
  expired token gets the same message.
- **Policy for the person sending the link (candidate):** send it only to the email
  stored on that account. An account with no email cannot be recovered, and the
  sign-up copy says so.

## Account deletion

`handleAccountDeleteAll` deletes the user's scan sessions today and leaves the
`users` row. With a password hash and an email in that row, "Delete everything"
must also delete the `users` row (its foreign keys cascade to the scan sessions
and to the Auth.js tables) and then sign the user out. A test proves that no
`users`, `password_reset_*` or `scan_*` row for that user remains.

## Copy

Strings are zh-TW first and a candidate until Kirby confirms them. The builder
follows `docs/design-guidelines.md`; no canvas design is part of this spec.

- The sign-up form says what is kept: the username, the password (as a one-way
  hash), the optional email (only to handle a password reset), and the scans.
- It says plainly that without an email, a forgotten password cannot be recovered.
- It does not claim that no personal data is collected, and it states no deletion
  time (Kirby's 2026-09-30 decision).
- `/account`'s current line "We keep your email address and your scans" is
  replaced; the "Sign-in is unavailable" state stays for when sign-in is not
  enabled.

## Tests and acceptance

- Unit: hash and verify (right, wrong, malformed stored value, parameter upgrade),
  username and email normalisation, the form schemas, the rate-limit keys, token
  issue and use (single use, expiry, replacement).
- Real Postgres (PGlite, with the repo's own migrations): sign-up uniqueness,
  including two sign-ups at once; reset token single use and expiry; account
  deletion leaves nothing; the session check refuses a deleted user and a token
  older than `password_changed_at`.
- **Mutation checks** reported in the PR: remove each security guard in turn
  (dummy hash, rate limit, token expiry, single use, session user check) and show
  a test fails.
- **Unmocked end to end, run by Claude on a real Postgres in a real browser, with
  a reload:** sign up, scan, reload, sign out, sign in, the scan is still there;
  wrong password; the reset flow through the two scripts. Not signed off by a mocked
  suite alone.
- `security-review` before sign-in is enabled in production.

## Delivery

AGENTS.md says a milestone that spans both sides is two PRs.

1. Claude's contract PR: the form schemas and limits.
2. Backend PR: migration, hashing, `src/auth.ts`, the session check, the reset
   tables and the two scripts.
3. UI PR: the forms, `/account`, the reset page, the copy.
4. Production steps, in order: migration applied; Kirby sets `AUTH_SECRET` and
   checks that `AUTH_URL`, if it is set in Vercel, is a full `https://…` URL (a
   reviewer's simulation: an invalid value makes `auth()` throw `Invalid URL`
   and fails scan submission; whether production sets it is not checked);
   `security-review`; sign-in enabled.

Work starts after #52 (#117) merges, because both touch `src/auth.ts`.

## Candidates

| Item                | Candidate                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| Password length     | 10 to 128 characters, no composition rules, not equal to the username          |
| Username            | 3 to 32 characters of `a-z 0-9 _ . -`, case-insensitive, a short reserved list |
| Token lifetime      | 7 days                                                                         |
| Reset link lifetime | 24 hours                                                                       |
| scrypt cost         | N = 2^17, r = 8, p = 1, after measuring on Vercel                              |
| Sign-up             | open to anyone, rate limited                                                   |
| Email already used  | accepted as "that email is already used" (a low-risk leak, it is not a login)  |
| Google code         | kept, unused, until Kirby says to delete it                                    |
| Claiming on sign-in | automatic, as today; or ask the user before adding the current scan            |
