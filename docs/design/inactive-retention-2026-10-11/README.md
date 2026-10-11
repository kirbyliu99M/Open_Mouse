# Delete accounts and saved scans after 3 months of inactivity: spec (2026-10-11)

**Status: decisions confirmed by Kirby on 2026-10-12 ("依據建議執行", follow the
recommendations); still not implemented.** This is a specification, not an
implementation. Kirby asked on 2026-10-11 for a spec PR first and the implementation
later ("inactive 3 個月刪除，可以先開一個 PR，我們後續再實作"). The numbers and names
below must not be written anywhere public as a promise until the implementation PR
has passed review, Kirby has run the production migration, and Kirby has read the
dry-run counts. This PR adds no code and no migration file.

Evidence rule: every statement about today's behaviour cites `file:line` at
`main` `dbf2851`; `main` has since moved to `4ca890f`, which differs from it only under
`src/server/fit/`, where nothing here is cited. Where nothing in the repository shows a fact, it says
**Unconfirmed** and does not fill the gap by inference. Facts about Auth.js come
from the copy installed in the main checkout's `node_modules` (`@auth/core`
0.41.3, `next-auth` 5.0.0-beta.32), not from this repository's own code.

## 0. Summary

- Today a signed-in account and its scans are kept until the person deletes
  them (`src/app/account/page.tsx:39`, `:113`; `README.md:98`). Nothing removes an
  abandoned account. Only anonymous sessions expire
  (`src/server/scans/expiry.ts:22-28`).
- The database has no column that says when an account was last used. `users`
  has no timestamp at all (`src/db/schema.ts:160-171`).
- Proposal: add one column, `users.last_active_at`, keep it current on
  sign-in and (throttled to once a day) on any signed-in request, and add a
  daily Vercel cron `/api/cron/purge-inactive` that deletes accounts whose
  value is older than 90 days. One guarded `DELETE FROM users` per batch does the
  whole job, because every user-owned table already cascades from `users`.
- The cron ships switched off (`off`), then `dry-run`, then `delete`. Kirby
  reads the dry-run counts before `delete` is switched on.
- Section 7 records Kirby's decisions of 2026-10-12 ("follow the recommendations").
  Where the spec had a recommendation the decision is that one; where it had none,
  the entry says it is Claude's reading and Kirby may change it.
- The privacy statement does not carry this promise until the mechanism is live
  and has run in `delete` mode at least once (section 6).

## 1. Current state (evidence)

### 1.1 User-related tables

| Table (`src/db/schema.ts`)                                | Holds                                                                                             | Link to a user                                                                                                                                                                       | Time column usable as activity                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `users` (160-171)                                         | `id` (text, random UUID), `name`, `email` (unique), `emailVerified`, `image`                      | is the user                                                                                                                                                                          | `emailVerified` only; what it records is **Unconfirmed**. No `created_at`, no `last_login`. |
| `accounts` (188-209)                                      | Google profile link and OAuth tokens (`refresh_token`, `access_token`, `id_token`: lines 197-202) | `user_id` NOT NULL, FK `users.id` ON DELETE CASCADE (191-193); index `accounts_user_id_idx` (207)                                                                                    | none                                                                                        |
| `auth_sessions` (211-217)                                 | session token, `expires`                                                                          | `user_id` NOT NULL, FK CASCADE (213-215); **no index on `user_id`**                                                                                                                  | `expires` only (see 1.5)                                                                    |
| `verification_tokens` (219-227)                           | `identifier`, `token`, `expires`                                                                  | **none** (no `user_id`, no FK). Whether any row is ever written is **Unconfirmed**: the only configured provider is Google (`src/auth.ts:50-57`).                                    | `expires`                                                                                   |
| `scan_sessions` (233-248)                                 | the container of scans                                                                            | `user_id` nullable, FK CASCADE (237); NULL = anonymous; CHECK `scan_sessions_anonymous_expire`: an anonymous row must have `expires_at` (242-245)                                    | `created_at` (238), `expires_at` (239)                                                      |
| `scans` (250-298)                                         | hand side, stated grip, stated palm thickness, `survey_contributed_at`                            | `session_id` NOT NULL, FK CASCADE (252-254). **No index on `session_id`** (no index on `scans` in any `drizzle/*.sql`).                                                              | `created_at` (297); no `updated_at`                                                         |
| `scan_measurements` (301-337)                             | millimetre values, calibration evidence                                                           | `scan_id` PK, FK CASCADE (304-306)                                                                                                                                                   | none                                                                                        |
| `fit_results` (341-374)                                   | ranked scores per scan and mouse                                                                  | `scan_id` FK CASCADE (345-347); unique `(scan_id, mouse_id, engine_version)` (364-368)                                                                                               | `created_at` (361)                                                                          |
| `analysis_cache` (395-410)                                | model-written prose per scan                                                                      | `scan_id` FK CASCADE (398-400); PK `(scan_id, key)` (407)                                                                                                                            | `created_at` (404)                                                                          |
| `rate_limits` (420-424)                                   | hashed key, window start, count                                                                   | none (key is a keyed hash of the caller's IP or similar: `src/server/analysis/drizzle-rate-limiter.ts:23-24`, `src/server/analysis/rate-limit.ts:86-96`); swept after 24 h (see 1.3) | `window_start` (bigint epoch ms)                                                            |
| `survey_contributions` (459-501)                          | binned hand size, grip, `main_use`, free-text `feedback`                                          | `user_id` nullable, FK CASCADE (464); index (477). No link to any scan (schema.ts:431-441).                                                                                          | `consented_at`, truncated to a UTC day by a CHECK (467, 484-487)                            |
| `survey_ratings` (508-543), `survey_other_mice` (551-576) | per-mouse rating; a mouse not in the catalogue                                                    | `contribution_id` FK CASCADE (511-513, 555-557) and their own `user_id`, FK CASCADE (517, 558)                                                                                       | none                                                                                        |

Not user data: `mice`, `scaffold_checks`.

### 1.2 What one `DELETE FROM users WHERE id = ?` removes

Every table above except `verification_tokens` and `rate_limits` is reachable by
a CASCADE chain from `users`: `accounts`, `auth_sessions`, `scan_sessions` ->
`scans` -> `scan_measurements`, `fit_results`, `analysis_cache`;
`survey_contributions` -> `survey_ratings`, `survey_other_mice` (and those two
also by their own `user_id`). `tests/unit/account-delete-user.test.ts:1-8` states
this and runs it on PGlite; the per-table counts it checks are listed at
`:30-42`. This is a single statement, so Postgres applies it atomically,
cascades included.

### 1.3 Existing retention mechanisms (anonymous data only)

- **Session TTL.** `SESSION_TTL_MS` is 20 h 30 min from creation
  (`src/server/scans/retention.ts:50`; applied at `src/server/scans/submit.ts:219-223`).
- **Expired means gone on reads.** `ownershipPredicate` requires
  `expires_at > now` for the cookie path (`src/server/scans/drizzle-repo.ts:20-40`).
- **Lazy sweep.** `POST /api/scans` runs `deleteExpiredAnonymousSessions`, at
  most once a minute per warm instance, failures swallowed
  (`src/server/scans/sweep.ts:11`, `:32-38`; `submit.ts:138-143`).
- **Cron endpoint.** `GET /api/cron/expire-sessions`
  (`src/app/api/cron/expire-sessions/route.ts:6-11`) runs
  `deleteExpiredAnonymousSessions` and `deleteEndedRateLimitWindows`
  (`src/server/scans/expire-cron.ts:48-60`). Auth is `Authorization: Bearer
$CRON_SECRET`, compared in constant time, closed when the secret is unset
  (`expire-cron.ts:24-39`). The SQL is
  `DELETE FROM scan_sessions WHERE user_id IS NULL AND expires_at <= now`
  (`drizzle-repo.ts:146-155`).
- **Schedules.** `vercel.json:7-12` has one cron, `0 3 * * *` (daily).
  `.github/workflows/expire-sessions.yml:15-18` calls the same endpoint at `17 * * * *`.
  `docs/STATUS.md:294` records that the hourly GitHub schedule "actually ran about
  5 times a day (longest gap 8.56 h)". `docs/STATUS.md:487` records why a daily
  Vercel cron alone was not enough for the old 24 h promise (Vercel Hobby allows
  one run a day; that plan limit is quoted from STATUS, not re-checked here).
  `AGENTS.md:59-65` budgets Actions minutes and says not to add scheduled
  workflows without Claude's sign-off.
- **Signed-in data never expires.** A claimed session has `expires_at` NULL
  (`drizzle-repo.ts:93-99`, `:167-183`; `expiry.ts:17-21`; `schema.ts:229-232`).

### 1.4 Existing deletion code

- **Delete one scan.** `DELETE /api/scans/{scanId}`: `handleScanDelete`
  (`src/server/scans/delete.ts:117-138`) -> `deleteOwnedScan`, one `DELETE` with an
  ownership subquery (`drizzle-repo.ts:245-267`). It does not remove a survey
  contribution made from the scan (`src/lib/contracts/survey.ts:43-50`).
- **Delete the anonymous session.** `handleSessionDelete`
  (`src/server/scans/session.ts:25-40`) -> `deleteSession`, which refuses a claimed
  session (`drizzle-repo.ts:136-144`).
- **Delete the account.** `DELETE /api/account/scans`
  (`src/app/api/account/scans/route.ts:22-31`) -> `handleAccountDeleteAll`
  (`src/server/account/handlers.ts:56-68`) -> `deleteAllScans`
  (`src/server/account/drizzle-repo.ts:70-97`): it counts the user's scans, then
  runs one `db.batch([...])` with three deletes (survey contributions by user,
  `scan_sessions` by user, the `users` row; `:89-95`), then clears the cookie.
  The comment at `:80-88` says the first two are explicit so the survey withdrawal is
  by name.
- **Withdraw survey answers only.** `DELETE /api/survey`
  (`src/server/survey/service.ts:197-211`). An anonymous contribution cannot be
  withdrawn (`survey.ts:51-52`).
- `db.batch` is one HTTP request that Neon runs atomically
  (`src/server/scans/drizzle-repo.ts:45-56`; `account/drizzle-repo.ts:80-83`). What
  the neon-http driver lacks is an interactive transaction (`AGENTS.md`, DB convention),
  and the migrator runs each migration statement as its own request
  (`drizzle/0007_natural_luminals.sql:18-20`).

### 1.5 What can serve as "activity" today

- **Nothing on `users`.** No `created_at`, no `last_login`, no `updated_at`
  (`schema.ts:160-171`).
- **Scans.** `scans.created_at` (297) and `scan_sessions.created_at` (238) say when a
  scan or session was made. Scans are never updated afterwards except for the
  survey mark (294-296).
- **Auth.js session rows.** The session strategy is `database` when the adapter
  builds (`src/auth.ts:47-49`); `session.maxAge` is not set anywhere in `src`, so
  Auth.js's default applies: 30 days, refreshed at most once a day
  (`@auth/core` `lib/init.js:38,75-76`). On a session read, if the row is due,
  `updateSession` sets `expires` to now + 30 days
  (`@auth/core` `lib/actions/session.js:67-95`). So `auth_sessions.expires - 30 d`
  approximates the last signed-in request, **only while the row exists**. This
  repository has no code that deletes `auth_sessions` rows (cascade from `users`
  only); that Auth.js deletes the row on sign-out and on presenting an expired
  token is read from `session.js:72-76` and the adapter, and was not run here.
- **Sign-in event.** `events.signIn` runs on each sign-in (`src/auth.ts:100-104`). Its
  errors are swallowed by Auth.js (per the comment at
  `src/server/auth/claim.ts:51-54`; not re-run here).
- **The `session` callback** runs when `auth()` reads a session and receives the
  full `users` row from the adapter (`src/auth.ts:83-85`; the adapter's
  `getSessionAndUser` selects `user: usersTable`, `@auth/drizzle-adapter`
  `lib/pg.js:109`).

### 1.6 Gaps this spec has to deal with

1. No column holds account activity (1.5).
2. A signed-in session rolls: Auth.js pushes `expires` out by 30 days at most once a
   day while the person keeps using the site (1.5). A person can therefore use the
   site daily for months without a new sign-in event. If `last_active_at` recorded
   only sign-ins (and scans), it would fall behind real use, and the safety net in
   3.2 would only hide that for as long as the session lives. "Last sign-in" alone
   is therefore the wrong definition (section 2.1 works out what happens).
3. `scans.session_id`, `scan_sessions.user_id` and `auth_sessions.user_id` have no
   index (`schema.ts:211-217`, `:233-248`, `:250-254`; no `CREATE INDEX` for them in
   any `drizzle/*.sql`). Each deleted `scan_sessions` row makes Postgres look for
   its scans without an index; each deleted `users` row makes it look for its
   `auth_sessions` and `scan_sessions` rows the same way; the purge's
   `NOT EXISTS` safety nets (3.2) filter `auth_sessions` and `scan_sessions` by
   `user_id`, so they scan those tables too. Fine at today's size, a cost to
   measure before it grows (**Unconfirmed:** row counts in production).
4. A deleted user's `fit_results` is many rows per scan (one per ranked mouse; the
   catalogue holds hundreds of rows: `docs/STATUS.md` quotes 402 ranked mice for one
   scan), which is why the batch size below is small.
5. The account page and the home flow currently say the opposite
   ("Your scans stay until you delete them", `src/app/account/page.tsx:39`;
   "Kept until you delete it.", `:113`; `README.md:98`). These lines change when
   this ships (section 6).

## 2. Policy (proposal, candidate)

### 2.1 What counts as activity

Candidate: **any signed-in request, and any sign-in.** Two ways to get there:

- **P1 (the narrow rule): sign-in, or creating a scan.** Cheapest to write, but it
  deletes too early once the safety net in 3.2 is in place. While a person keeps
  using the site, Auth.js extends their session each day, so the net
  (`no auth_sessions.expires > now`) blocks the purge. About 30 days after their
  last real use the session expires and the net stops blocking, while
  `last_active_at`, which under P1 records only the last sign-in or scan, is
  already older than 90 days if that sign-in was more than 60 days before the last
  use. Example: sign in on day 0, use the site daily until day 80, then stop. The
  session expires on day 110, `last_active_at` is 110 days old, and the account is
  deleted on day 110, which is 30 days after the last use, not 90. (Without the net
  the same person would be deleted on day 90 while still using the site.) Either
  way P1 breaks the 3-month promise, because the true last use is not recorded.
  P1 would only be correct if no session could outlive 60 days between sign-ins
  (for example a maximum session age), which is a separate product change.
- **P2 (recommended, candidate): `users.last_active_at` is written on sign-in and,
  throttled to at most once per 24 h per user, whenever `auth()` returns a session.**
  Creating a scan while signed in already calls `auth()` (`getUserId` in the scan
  route), so it counts without its own write. Viewing results while signed in
  counts. It costs one conditional `UPDATE` per active user per day, the same
  throttle Auth.js uses for its own session refresh (`session.js:77-92`).

What does not count under either: anything that happens without a session
(anonymous visits, an unsent form), and the purge job itself.

### 2.2 When the clock runs out

- Window: **90 days** (candidate; "3 months" would be the wording proposed for the
  privacy text, which does not exist yet, as a rounding of it. Calendar-month
  arithmetic, 89 to 92 days, is the alternative, see 7).
- All comparisons are on `timestamptz` instants in UTC. UTC has no daylight-saving
  jumps, so a day is 24 h; the Taipei time zone has none either.
- **One clock: the database's.** `last_active_at` is written by the database
  (`DEFAULT now()` and `SET last_active_at = now()`), so the cutoff is computed in
  the same SQL statement as `now() - interval '90 days'`, never as a timestamp the
  application passes in. An application server whose clock runs ahead of the
  database would otherwise delete accounts early. The pure function in 3.3 takes
  `now` as an argument only so that tests and the dry-run comparison can exercise
  the rule.
- An account is **eligible when `last_active_at < now() - interval '90 days'`**
  (strictly older). Exactly 90 days is not yet eligible; one millisecond more is.
  The cron runs once a day, so a person is deleted between day 90 and day 91 of
  inactivity, never before day 90.
- A `last_active_at` in the future (clock skew) is never eligible.

### 2.3 Scope

- **Deleted for an eligible account:** the `users` row (email, name, image),
  `accounts` (OAuth tokens), `auth_sessions`, every `scan_sessions` row it owns
  with their scans, measurements, fit results and analysis cache. All by cascade
  (1.2).
- **Unchanged:** anonymous sessions keep today's rule (20 h 30 min TTL, lazy sweep,
  `expire-sessions`). `rate_limits` keeps its 24 h sweep. Purge never touches a row with
  `user_id IS NULL`.
- **Not covered:** `verification_tokens` has no link to a user and may hold an
  `identifier` (an email-like value); whether it is ever written is
  **Unconfirmed** (1.1). If it is, expired rows need their own sweep (listed in 7).

### 2.4 Survey contributions made by the account (options, not decided)

A signed-in contribution is linked to the account by `user_id` and cascades with it
today when the person deletes their account (`account/drizzle-repo.ts:89-95`;
`survey.ts:43-50` says "Delete everything" MUST withdraw it). For an inactive
purge:

- **S1. Delete with the account.** Same as the person's own delete. Simplest
  and consistent with the contract's rule for a signed-in person. The shared
  survey data loses those answers.
- **S2. Detach, keep.** Set `user_id` to NULL on the three survey tables before the
  user row goes. The contribution becomes anonymous and can no longer be withdrawn
  (`survey.ts:51-52`). Needs consent text that says so, and a test that the
  detach and the delete are one guarded statement (a data-modifying CTE, whose
  interaction with the cascade is **Unconfirmed** until tested on PGlite) or
  `ON DELETE SET NULL` foreign keys (a schema change that must not weaken the
  person's own "Delete everything").
- **S3. Keep the bins, drop the free text.** Detach as in S2 but also NULL the
  `feedback` column, the one field a person could have typed a name into
  (`survey.ts:27-31`).

The contribution rows hold no scan id and no time finer than a day
(`schema.ts:431-441`), so any of the three is workable; which one is a promise
to the contributor, so it is Kirby's decision.

### 2.5 Warning before deleting (options)

`users.email` exists (`schema.ts:165`) but the repository has no mail sender
(no mail package in `package.json`; `docs/design/auth-username-password-2026-10-04/README.md`
says nothing is sent "until a sending system is built later").

- **W1. No warning.** The rule is stated on `/account`, on the sign-in screen and on
  `/privacy`. The cheapest, and a person who has stopped visiting never sees it.
- **W2. Email warning at 75 or 80 days.** Needs a sending system, a sender
  domain, an unsubscribe story and privacy text for it: a separate project.
- **W3. Two-step delete.** Mark `purge_after` at day 90, delete 14 days later.
  Gives a window but nobody is told in it without W2. Adds state and a column.
- **W4. In-app banner.** Only reaches people who come back, who by definition have
  just reset the clock. Listed for completeness, not recommended.

## 3. Design

### 3.1 Data model (smallest change)

- `users.last_active_at timestamptz NOT NULL DEFAULT now()` and an index on it.
- `auth_sessions.user_id`, `scan_sessions.user_id` and `scans.session_id` indexes
  (gap 3). Optional; drop them from the migration if Kirby wants the smallest
  possible change.
- No new table. No change to any foreign key.

`NOT NULL DEFAULT now()` means every existing row gets the migration time, a new
user gets the creation time, and old code that inserts a user without naming the
column keeps working.

### 3.2 Where `last_active_at` is written

1. **`events.signIn`** (`src/auth.ts:100-104`): one `UPDATE users SET
last_active_at = now() WHERE id = $1`, next to the existing claim.
2. **`session` callback** (`src/auth.ts:83-85`), under P2: if
   `user.lastActiveAt` (already in the row the adapter passes) is more than 24 h
   old, run the same `UPDATE` with the 24 h condition repeated in SQL, inside a
   try/catch that never breaks the session. The callback is synchronous today and
   would become `async`.
3. Nothing else. `POST /api/scans`, the fit route and the survey route already
   call `auth()`.

Several simultaneous requests from one person can each see a stale
`last_active_at` and each run the `UPDATE`. That is harmless: every write sets
`now()`, so the result is the same, and the cost is one extra write for the first
page of the day.

Because Auth.js swallows event errors (1.5) and a write can fail, the purge also
checks two cheap safety nets, evaluated with the database clock like the cutoff:
no `scans.created_at >= now() - interval '90 days'` under the user's sessions, and
no `auth_sessions.expires > now()` for the user. Under P2 they should normally be
redundant. A missed write then costs at most one skipped purge, not a wrong
delete, but only while the net still covers the person: the `auth_sessions` net
covers about 30 days past the last signed-in request and the scan net covers
scans, so a swallowed sign-in write for someone who then stops using the site is
caught only if they have a recent scan.

### 3.3 The purge function and the shared delete

One module (proposed `src/server/account/purge.ts`) with two functions, no
second copy of the delete SQL:

- `deleteUserAccounts(db, userIds, guard?)`: `DELETE FROM users WHERE id = ANY($1)`
  plus, when `guard` is given, the eligibility predicate repeated in the same
  statement (`last_active_at < now() - interval '90 days' AND NOT EXISTS (...)`
  as in 3.2; the window is a parameter, the clock is the database's).
  `RETURNING id`. Cascades do the rest. The person's own "Delete everything"
  (`account/drizzle-repo.ts:70-97`) calls it with one id and no guard, and keeps
  its `db.batch` of the two explicit survey/`scan_sessions` deletes if Kirby wants
  the "by name" wording kept (the FK cascade makes them redundant,
  `account-delete-user.test.ts:1-8`; but with a guard the explicit deletes
  would run unguarded, so the purge uses the guarded single statement only).
- `selectInactiveUserIds(db, windowDays, limit)`: `SELECT id FROM users WHERE
last_active_at < now() - interval '90 days' AND <safety nets> ORDER BY
last_active_at LIMIT $limit` (the interval is built from `windowDays`, no
  application timestamp is passed).
- A pure `isInactiveAccount(row, now, windowMs)` mirrors the SQL for tests, the
  same split as `isExpiredAnonymousSession` (`expiry.ts:22-28`) and its SQL
  (`drizzle-repo.ts:146-155`).

### 3.4 The cron endpoint

`GET /api/cron/purge-inactive`, shaped like `expire-sessions`
(`route.ts:6-11`, `expire-cron.ts:48-60`):

- **Auth.** Same bearer check. Move `isAuthorized` /
  `timingSafeStringEqual` (`expire-cron.ts:24-39`) into a shared helper rather
  than copying it. Unset `CRON_SECRET` is 401.
- **Mode, by environment variable** `RETENTION_PURGE_MODE` = `off` | `dry-run` |
  `delete`, default `off` (a missing or unknown value is `off`). `off` returns 200
  `{ mode: "off" }` and touches nothing. A `?dryRun=1` query forces `dry-run`
  whatever the variable says. No query value can force `delete`.
- **Bounds (per run, not per day).** Candidate: at most 200 accounts per run, in
  chunks of 25 per `DELETE` statement, and stop starting new chunks after 20 s of
  wall time. The route sets `maxDuration` (the analysis route uses 30:
  `src/app/api/scans/[scanId]/analysis/route.ts:27`). A backlog drains over
  several runs; the response says `remaining: true`. **There is no daily cap:**
  the endpoint can be called more than once a day by anyone who holds
  `CRON_SECRET`. That one secret is shared with `expire-sessions`
  (`src/app/api/cron/expire-sessions/route.ts:9`), and the GitHub workflow that
  calls `expire-sessions` holds it as a repository secret
  (`.github/workflows/expire-sessions.yml:15-18`, `:36`). The workflow's URL is
  fixed to `expire-sessions` (`:58`), but a holder of the secret could call the
  purge endpoint. Two ways to close that, for Kirby (7): count deletions per UTC
  day and refuse past a daily number, or use a separate secret for this endpoint
  (a separate secret cannot be sent by Vercel Cron if Vercel Cron sends only
  `CRON_SECRET`, as the comment at `expire-cron.ts:41-43` says; so it would need
  a different caller or an additional check). `RETENTION_PURGE_MODE` stays the
  main control either way.
- **Dry-run response.** Counts and the first 20 candidates' ids as the first 8 hex
  characters of their SHA-256 (the form `src/server/log.ts:23-26` already uses for
  scan ids). Never an email, a name or a full id.
- **Failure.** A failed chunk stops the run with 500 and a class-name-only error
  (`log.ts` reduces errors that way). The next daily run starts from a fresh
  `SELECT`.

### 3.5 Order, transaction boundary and retries

For each chunk:

1. `selectInactiveUserIds` (read, no side effect).
2. `deleteUserAccounts(ids, guard)`: **one SQL statement.** Postgres applies the
   delete and every cascade atomically, so a chunk is all or nothing and no
   half-deleted account can exist. There is no multi-statement sequence for the
   neon-http driver to break.
3. Count what went (`RETURNING id` gives users; scans are counted by a `SELECT`
   before step 2, for the log only, and may differ by a concurrent write).

Idempotence and retry: re-running after a crash re-selects; accounts already gone
are not selected, accounts that became active (sign-in or request in between) fail
the guard in step 2 and are skipped. Nothing needs undoing.

The race "user signs in while the delete statement is running" relies on Postgres
re-checking the `WHERE` clause on the row version that wins a row lock when a
concurrent `UPDATE` commits first. That behaviour is **Unconfirmed here**: the test
database (PGlite) is a single connection that executes statements one after
another, so it cannot show it (5.2). Either a concurrent test on a real Postgres
(two connections) is added to the implementation PR, or Kirby accepts the risk. The
window is the length of one chunk's statement. This repeated predicate, plus the
safety nets (3.2), is the only protection against it, and also the only protection
if the `events.signIn` write fails and Auth.js swallows the error (1.5).

The reverse race (delete first, then the person's sign-in creates a session for a
vanished user) fails on the foreign key and the person signs in again as a new
account: rare, and not the data-loss direction.

The `fit_results` volume (gap 4) is why chunks are small: 25 accounts may mean
thousands of cascaded rows in one statement.

### 3.6 Scheduler

- **Primary: Vercel Cron.** Add a second entry to `vercel.json` (`0 4 * * *`,
  candidate; one hour after the existing job). Vercel sends the
  `CRON_SECRET` bearer (`expire-cron.ts:41-43`). A daily granularity is enough
  for a 90-day rule. Whether Vercel fires a Hobby cron at an exact minute is
  **Unconfirmed**; it does not matter here.
- **GitHub Actions: not used.** It already misses runs (`STATUS.md:294`), it is
  budgeted (`AGENTS.md:59-65`), and a missed day costs nothing for a 90-day rule.
  A manual `workflow_dispatch` could trigger a dry-run if Kirby wants one; that
  needs Claude's sign-off per `AGENTS.md:65`.
- `tests/unit/retention.test.ts` parses `expire-sessions.yml`; the new cron
  must not be added to that file, so that test is unaffected.

### 3.7 Observability

- The response body and one `log.info("retention.purge", {...})` line
  (`src/server/log.ts:578-582`, which already redacts emails, ids and tokens)
  carry only counts: `mode`, `candidates`, `usersDeleted`, `scansDeleted`,
  `chunks`, `remaining`, `ms`. No email, name, IP or full id.
- `info` lines go to stdout only. An `error` line (a failed chunk) is also sent to
  Sentry with `captureMessage` (`src/server/log.ts:564-572`), as the redacted
  line. Whether Sentry is enabled in production, and how long Sentry keeps events,
  are **Unconfirmed** (`docs/STATUS.md` says it is not recorded whether the DSN is
  set).
- Vercel's cron log keeps the response; how long Vercel keeps logs is
  **Unconfirmed**. If Kirby wants a record that outlives that, an optional
  `retention_runs` table (date, mode, the counts above, no personal data) is a
  separate additive migration.
- A purge that deletes nothing for a long time is normal. An alert on a
  sudden jump (for example more than 50 accounts in a day) is an option for 7.

## 4. Migration plan

Additive only. The file below is a **draft for the implementation PR, not added
to `drizzle/` here**; the real file is generated by `drizzle-kit generate` from
the schema change and wrapped as one guarded statement, the pattern of 0005 to
0007 (`drizzle/0007_natural_luminals.sql:18-23`), because the neon-http migrator
sends each statement as its own request with no surrounding transaction.

```sql
-- Draft (candidate). One DO block = one statement = atomic; every step guarded
-- so a re-run completes without error.
DO $$
BEGIN
  ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone
    DEFAULT now() NOT NULL;
  CREATE INDEX IF NOT EXISTS "users_last_active_at_idx"
    ON "users" USING btree ("last_active_at");
  CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx"
    ON "auth_sessions" USING btree ("user_id");
  CREATE INDEX IF NOT EXISTS "scan_sessions_user_id_idx"
    ON "scan_sessions" USING btree ("user_id");
  CREATE INDEX IF NOT EXISTS "scans_session_id_idx"
    ON "scans" USING btree ("session_id");
END $$;
```

- **Backfill: none (candidate).** Every existing account gets the migration time
  as its last activity, so the earliest possible purge is 90 days after the
  migration, and nobody is deleted by surprise. `users` has no creation time
  (1.1), so any earlier date would be inferred, which this spec does not do.
  Cost: accounts already abandoned for longer live up to 90 more days. Options:
  - **B0 (above):** no backfill.
  - **B1: derive an earlier date** with
    `GREATEST(max(scans.created_at), max(auth_sessions.expires) - interval '30 days')`
    per user, falling back to the migration time. It can only move a date earlier,
    so the first purge could delete long-abandoned accounts immediately; whether
    `auth_sessions.expires - 30 d` is a faithful last-use date depends on the Auth.js
    default staying 30 days and on the row still existing (1.5). Needs Kirby to read
    the dry-run before `delete`.
  - **B2: B1 only for accounts that have scans, B0 for the rest.**
- **Order: migrate first, then deploy.** The adapter's `getSessionAndUser` selects
  every column of `users` (`pg.js:109`), so new code on an unmigrated database
  would fail every session read, which signs everyone out; the same class of
  failure as the 0007 incident described at `schema.ts:271-292`. Old code on the
  migrated database is safe: it ignores the column, and its user inserts take the
  default. Migrate production before merging the PR (ask Kirby first, as
  `AGENTS.md` says for a migration PR).
- **Rollback.** Switch `RETENTION_PURGE_MODE` to `off` (instant, no deploy needed
  beyond the variable). Reverting the code is safe with the column left in place.
  Dropping the column and indexes is possible
  (`DROP INDEX IF EXISTS ...; ALTER TABLE users DROP COLUMN IF EXISTS last_active_at;`)
  only after no deployed code reads it; deleted accounts cannot be restored by any
  rollback, which is why `delete` mode comes last.

## 5. Test plan

Follows the repository's pattern: a pure function with unit tests
(`AGENTS.md` hard rule 3), real-Postgres tests on PGlite, and a handler test
with a fake repo.

### 5.1 Pure function `isInactiveAccount(row, now, windowMs)`

- exactly 90 days: not eligible; 90 days plus 1 ms: eligible; 90 days minus 1 ms: not.
  (The pure function takes `now` as an argument; the SQL uses the database clock,
  see 5.2 for the test that holds the two together.)
- just signed in (`last_active_at == now`): not eligible.
- a future `last_active_at`: not eligible.
- The same cases run under `TZ=Asia/Taipei` and `TZ=UTC`, and across a month end and
  a leap day (2028-02-29), to show the arithmetic uses instants, not local dates.
  If Kirby picks calendar-month arithmetic (7), add 31-to-30-day month ends.
- "never signed in": every row has `last_active_at` because the column is NOT NULL
  with a default; a test inserts a user the way the adapter does (no
  `last_active_at`) and checks it equals insert time. Whether a `users` row can
  exist without any sign-in is **Unconfirmed**; this test makes the case harmless.
- recent-scan and live-session safety nets (3.2) each block an otherwise eligible
  account.
- an anonymous session (`user_id IS NULL`) is never selected.

### 5.2 Integration on PGlite

Reuse `tests/unit/fixtures/pglite.ts` (`MIGRATION_FILES` reads `drizzle/`, so the
new file is picked up by name, `:15-17`; `applyMigrations(pg, from, to)` applies a
range, `:30-40`) and `tests/unit/fixtures/survey-world.ts` (`withTransactionalBatch`,
`:353-367`) as `tests/unit/account-delete-user.test.ts` does.
`tests/unit/migration-0010.test.ts` does not exist at `dbf2851`, so there is no
template of that name to follow; the closest are `survey-schema-db.test.ts` and
`account-delete-user.test.ts`.

- **Migration:** apply up to 0009, insert a user, apply the new file, check
  `last_active_at` is set to about now and not NULL; apply it a second time and
  check it completes (idempotent); check the four indexes exist.
- **Purge:** a user with a scan under every kind of child row (the
  `USER_TABLES` list of `account-delete-user.test.ts:30-42`): after
  `deleteUserAccounts` every count is 0, and another user's rows are untouched.
- **Idempotence:** run twice, the second run deletes 0.
- **Database clock only:** set `last_active_at` with SQL relative to the database's
  `now()` (`now() - interval '90 days'` is not eligible; `now() - interval '90 days'
  - interval '1 millisecond'` is eligible), and run the purge with the application
    clock faked a year ahead and a year behind: the outcome does not change, because no
    application timestamp reaches the SQL.
- **Guard after a late write:** `UPDATE users SET last_active_at = now()` between
  `selectInactiveUserIds` and `deleteUserAccounts`: the account survives. On PGlite
  (one connection, statements one after another) this proves only that the guard
  predicate is evaluated when the delete runs. It does **not** prove the
  lock-wait re-check of a truly concurrent `UPDATE` (3.5): that needs two
  connections on a real Postgres, or the risk is accepted.
- **Bounds:** 60 eligible accounts with limit 25: three runs, 25 / 25 / 10, in
  `last_active_at` order.
- **Dry-run:** deletes nothing; counts and hashed ids only; no email string
  anywhere in the response.
- **Anonymous data:** expired and live anonymous sessions are untouched by the
  purge, and `deleteExpiredAnonymousSessions` still does its job.
- **Survey option chosen in 7:** whichever of S1 to S3.

### 5.3 Cron endpoint authorization

As `tests/unit/scan-api.test.ts:454,466` does for `handleExpireSessions`: no
header, wrong secret, wrong scheme, unset `CRON_SECRET` are all 401 and the repo
is never called; correct secret is 200. Plus: mode `off` calls nothing; unknown
mode is `off`; `?dryRun=1` with mode `delete` deletes nothing; no query can switch
a deploy from `off` to `delete`.

### 5.4 Write path

`events.signIn` and the throttled `session` callback: written when older than 24 h,
not written when newer, a failing write never throws out of the callback.

## 6. Launch and the privacy statement

- **No promise before the mechanism.** The `/privacy` page does not exist yet
  (`src/app` has no `privacy` route at `dbf2851`); when it is written it does not
  state the 3-month rule until the checklist below is done. Until then the
  statements stay as `STATUS.md:294-298` records: no deletion time stated.
- **Copy that changes at launch (candidate wording is a separate decision):**
  `src/app/account/page.tsx:31-32`, `:39`, `:80-81`, `:113`;
  `src/app/how-it-works/page.tsx:101`;
  `src/app/results/[scanId]/ResultsScanProvider.tsx:310-311`; `README.md:81-82`,
  `:98`. The survey consent text (`survey.ts:91-96`) if S2 or S3 is chosen.
- **Backups (Kirby's decision as relayed on 2026-10-11: no separate backups;
  candidate wording "我們不另做備份" / "we do not make separate backups").** This
  spec does not change that decision. It limits what the sentence may claim,
  because deleting a row from the live database is not the same as every copy being
  gone:
  - The database provider may keep short-lived restore history of its own.
    `README.md:81-86` already says how long Neon's point-in-time restore keeps data
    "has **not been confirmed**". Kept here as **Unconfirmed**: the retention
    period of Neon's restore history, and whether a purged account can be
    recovered from it.
  - Vercel and Sentry hold logs with their own retention periods (3.7); both are
    **Unconfirmed**. The purge's log lines carry no email, name, IP or full id,
    but a log from before the purge (for example a sign-in or error line) is not
    touched by it.
  - So the privacy wording may say that the project makes no separate backups. It
    may not say "all copies are deleted after 3 months" unless the provider
    retention periods are confirmed first (checklist item 8).
- **Checklist (all candidate):**
  1. Decisions in section 7 recorded (done: Kirby, 2026-10-12, following the
     recommendations; items marked as Claude's reading stay open to change).
  2. Implementation PR reviewed; its migration applied to production by Kirby's
     say-so, then the deploy.
  3. `RETENTION_PURGE_MODE=dry-run` set in production; the cron called once with the
     bearer secret; **Kirby reads the counts** (candidates, scans, `remaining`) and
     the hashed-id sample, and says go or no-go.
  4. Check the guards work in production: a test account signs in, uses the site,
     and its `last_active_at` moves (read by Kirby or by a one-off check, not in logs).
  5. `delete` mode on, with the per-run cap (there is no daily cap unless Kirby
     picks one in section 7); first real run watched; counts match the dry-run
     within the cap.
  6. Only then the `/privacy` text and the copy changes ship.
  7. `docs/STATUS.md` records the date, the mode and the first counts (Claude's job,
     per `AGENTS.md`).
  8. **Check the `/privacy` backup wording** against what is confirmed: the
     database provider's restore-history retention, **Sentry's** event retention
     (and whether Sentry is on in production; `log.ts:564-572` sends `error` lines
     there) and **Vercel's** log retention. Each stays **Unconfirmed** until Kirby
     reads it in the provider's console or terms; the wording claims only what was
     confirmed.

## 7. Decisions (Kirby, 2026-10-12: follow the recommendations)

Kirby's reply on 2026-10-12 was "#190 依據建議執行". Each entry names where its
content comes from. **"Per the spec's recommendation"** means the spec already
recommended or adopted that choice and the decision is that one. **"Claude's
reading of 'follow the recommendations'; Kirby may change"** means the spec made no
explicit recommendation and Claude filled in the default that fits it; Kirby has not
confirmed that specific value and may change it.

1. **Activity rule: P2.** Any signed-in request, and any sign-in; `last_active_at`
   is written at most once per 24 hours, on sign-in or whenever `auth()` returns a
   session. With the rolling session (1.6) P1 would delete an account about 30 days
   after its last real use, not 90, once the safety net stops covering it (2.1).
   Source: per the spec's recommendation.
2. **Window: fixed 90 days**, measured on the database clock, strictly greater than,
   in UTC. Source: per the spec's recommendation (the candidate the spec adopted).
3. **Survey contributions of a purged account: S1.** They are deleted together with
   the account, the same as when a person deletes their own account (2.4). Source:
   Claude's reading of "follow the recommendations"; Kirby may change.
4. **Warning before deletion: W1 (no warning).** The rule is written on `/account`,
   on the sign-in screen and in `/privacy`. There is no mail system, and W1 is the
   only option that can ship with this work (2.5). Source: per the spec's
   recommendation.
5. **Backfill: B0 (none).** Every existing account takes the migration time as its
   last activity, so the earliest deletion is 90 days after the migration (4).
   Source: per the spec's recommendation (the candidate the spec adopted).
6. **Indexes: include all three in this migration**: `auth_sessions.user_id`,
   `scan_sessions.user_id` and `scans.session_id`, as in the draft in section 4.
   Source: Claude's reading of "follow the recommendations"; Kirby may change.
7. **Batch bounds (per run): at most 200 accounts, chunks of 25, 20 s.** No daily
   limit and no separate secret for the endpoint in this work. Rollout is `off`, then
   `dry-run`, then `delete` (3.4). Whether to add a daily limit or a separate secret
   is to be revisited after the dry-run result. Source: Claude's reading of "follow
   the recommendations"; Kirby may change.
8. **Alert on an unusually large purge, and the `retention_runs` table: not in this
   work.** Log lines carry counts only (3.7). Source: Claude's reading of "follow the
   recommendations"; Kirby may change.
9. **`verification_tokens`:** the implementation PR first checks whether any row is
   ever written. Only if one is, it adds an expiry sweep; if none is, the table is
   left alone. Source: Claude's reading of "follow the recommendations"; Kirby may
   change.
10. **GitHub Actions: stay unused for this job.** Source: per the spec's
    recommendation.
11. **Anonymous scans: unchanged.** The current 20 h 30 min rule stays. Source: per
    the spec (it changes nothing there).
12. **`RETENTION_PURGE_MODE` to `delete`: Kirby only, in Vercel.** Source: per the
    spec.
13. **Concurrent-delete race (3.5):** the implementation PR adds a two-connection test
    on a real Postgres. If the environment cannot do that, the PR description says
    honestly that it is not covered. Source: Claude's reading of "follow the
    recommendations"; Kirby may change.
14. **Backups wording:** `/privacy` says only that no separate backups are made, and
    the retention periods of the providers (Neon restore history, Vercel and Sentry
    logs) are looked up before launch. It must not say "all copies are deleted after
    3 months" (section 6, item 8). Source: per the spec.

---

This document is a specification, not an implementation. The decisions in section 7
were confirmed by Kirby on 2026-10-12 ("依據建議執行"); the entries marked as Claude's
reading may still change. Until the implementation PR has passed review, Kirby has
run the production migration and Kirby has read the dry-run counts, no number or name
in it may be written publicly as a promise.
