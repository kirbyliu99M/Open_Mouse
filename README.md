# Open_Mouse

Measure your hand with a phone photo. See which mice fit it.

Open_Mouse compares a measurement of your hand with the published dimensions of
each mouse in a catalogue of Logitech models, scores every mouse that isn't
excluded (wrong hand, vertical) on six aspects of fit, and explains the ranking
in plain language. The question behind it: can a measured hand beat "large
hands, buy a large mouse"?

It gives a fit estimate to help a buying decision. It is not a medical or health
tool and does not diagnose, treat or prevent anything.

## Status

**Early preview, not public.** The site is deployed but marked `noindex` (search
engines are told not to list it) and has not been announced. Do not treat its
output as validated:

- The hand measurement is still being validated.
- The fit weights are provisional, and some mice have shape descriptors that are
  still unclassified, so their ranking leans on dimensions.

The live project board is [`docs/STATUS.md`](docs/STATUS.md); the design is
[`docs/PLAN.md`](docs/PLAN.md). If you are an agent working on this repository,
read [`AGENTS.md`](AGENTS.md) first.

## How it works

**Main flow: blank paper, live camera** (`/scan/easy`). Lay your hand flat on a
blank sheet of A4 or Letter paper on a darker table and hold your phone above it.
The live camera finds the four paper edges and takes the photo once they are
locked. The paper's known size is the ruler.

- The photo is measured **in your browser**: MediaPipe finds 21 hand landmarks and
  a homography from the paper edges turns pixels into millimetres. Both run as
  WebAssembly or JavaScript on your device.
- Only derived numbers are sent to the server: which hand, the grip you chose,
  the millimetre measurements and a few numbers describing how the paper was
  found.
- The server scores every mouse that isn't excluded (wrong hand, vertical) on
  length, grip width, height and hump, front flare, thumb rest and weight. The
  weight score applies only when a weight preference is given, and the app does
  not currently ask for one.
- The results page shows the ranking with a reason for each score, and a short
  written explanation. Google's Gemini API writes that text from the finished
  numbers; a deterministic template is used when the service is unavailable or
  its daily cap is reached. The language model never does the arithmetic.

**Printed-sheet flow** (`/sheet`, then `/scan`). The earlier calibration: print a
sheet carrying six ArUco markers (four flat on the sheet, two on a flap you fold
up for the side shot; identical on A4 and Letter) and photograph your hand with
the sheet in frame. It is still available; whether to keep it is pending.
Until that is decided it is mainly used for checking the blank-paper
measurement against ground truth (a learning kit for that is in development).

**No paper: type your hand length.** A "No paper? Use a ruler instead" entry lets
you measure your hand length with a ruler (wrist crease to middle fingertip) and
type it in. You still take the photo: the typed length replaces the paper as the
scale, so this mode has no perspective correction and every other measurement
inherits your ruler error. It is behind a build-time flag,
`NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY=1`, and is **off by default** while the
photo measurement is validated.

## Privacy

- **Photos never leave your browser.** No endpoint accepts an image. The submit
  route takes numbers only and rejects any field it does not expect. In the
  no-paper mode the calibration that is sent is `user-length`, which includes
  `referenceMm`: the hand length you typed (the same number is then stored as your
  hand length).
- **What the server keeps for a scan:** which hand, the stated grip, the
  millimetre measurements, the ranking with its scores and reasons, and the cached
  explanation text. A random session id lives in an httpOnly cookie. Rate limits
  count requests per caller using a keyed hash (HMAC-SHA256) of the IP address,
  not the address itself. The key is the `RATE_LIMIT_KEY_SECRET` environment
  variable (see `.env.example`); when it is not set, the code falls back to a
  fixed, non-secret salt (the hash can then be reversed by brute force) and logs a
  warning. Whether production sets it is **unconfirmed**.
- **Deletion.** A scan made without an account belongs to a session that
  expires automatically. Once it has expired, the app treats the session and its
  scans as if they did not exist, so they can no longer be read. When the expired
  data is physically removed from the database, and how long database backups
  keep it, are not stated here: they will be set out in the privacy terms, which
  are not written yet. How long Neon's point-in-time restore (PITR) keeps
  data has **not been confirmed**. You can delete a scan at any time with
  "Delete this scan now" on its results page.
- **Accounts are optional, and sign-in is off on the production site.** Google
  sign-in exists in the code and stays off unless OAuth credentials are
  configured; it is not enabled in production (see `docs/STATUS.md`). If it is
  turned on, signing in stores: in the `users` table, your name, email address,
  whether the email is verified (`emailVerified`) and profile image; in the
  `accounts` table, your Google account ID (`provider_account_id`) and the OAuth
  data Google returns (access, refresh and ID tokens, token type, `expires_at`,
  `scope` and `session_state`); and in `auth_sessions`, a session token with its
  expiry. The schema also defines `verification_tokens`; whether Google sign-in
  writes to it was not confirmed. Google OAuth is a third party in that flow. A
  signed-in user's scans are kept until that user deletes them.
- **Third parties.** Google's Gemini API receives the derived measurements, the
  grip, and the specifications and scores of the shortlisted mice to write the
  explanation, never a photo (`src/server/analysis/input.ts`). The app is hosted on
  Vercel with a Neon Postgres database; this repository does not control their own
  logs. MediaPipe's library tries to send usage metrics to Google (its own privacy
  notice says so); the app's Content-Security-Policy blocks that request, see
  [`public/mediapipe/README.md`](public/mediapipe/README.md).
- The app loads no analytics or advertising scripts. Its Content-Security-Policy
  allows no third-party origins for scripts or connections (it does allow inline
  scripts, which Next.js needs; see `next.config.ts`). For images it allows one
  origin, `lh3.googleusercontent.com`, from which a signed-in user's browser loads
  their Google profile picture, so Google's image host sees that browser's IP
  address and User-Agent (the request sends no referrer).

## Stack

Next.js 15 (App Router) and React 19, TypeScript (strict), Drizzle ORM with Neon
Postgres over the HTTP driver, Auth.js (Google, optional), MediaPipe Tasks Vision
and js-aruco2 in the browser, Google Gemini through `@google/genai` (server side
only), Zod for the shared contracts, Vitest and Playwright, deployed on Vercel.
Licences of what is redistributed: [`NOTICE`](NOTICE).

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev        # http://localhost:3000
```

Most pages and the whole test suite work without credentials. For anything that
reads or writes the database, copy `.env.example` to `.env.local` and fill in the
values for a development Neon branch. Never use production credentials locally.

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test                 # unit tests (Vitest)
npm run db:check             # migration history
npm run build
npx playwright install chromium
npm run test:e2e             # all Playwright projects against `next dev`
```

Playwright starts its own dev server on port 3100 (`PLAYWRIGHT_PORT` changes it,
so several worktrees can run side by side; `PLAYWRIGHT_REUSE_SERVER=1` attaches to
a server you started). Its projects are desktop Chromium, a Pixel 7 profile, and
three that feed Chromium's fake camera a fixture video. `npm run test:e2e:live`
runs a smaller suite against a real deployment with nothing mocked; it is also a
manual GitHub Actions workflow.

### Database

Edit `src/db/schema.ts`, run `npm run db:generate`, and commit the SQL and
metadata it writes to `drizzle/`. `npm run db:check` checks the history; CI
regenerates migrations and fails if the schema has drifted. Do not use schema
push. Neon has two branches: `main` (production) and `preview` (shared by every
pull request preview). A preview build migrates and seeds `preview` through
`npm run vercel-build`; production migrations are applied deliberately, by hand,
before releasing code that needs them. Seeds must stay idempotent and migrations
additive.

## Data provenance

The catalogue is seeded from **manufacturers' own published dimensions**, with
shape descriptors derived independently via
[`docs/shape-rubric.md`](docs/shape-rubric.md). No third-party database is
redistributed. Licensed reference data used during development stays outside this
repository and is never committed.

## Contributing and security

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities privately as
described in [`SECURITY.md`](SECURITY.md); do not open a public issue for them.

## Licence

**To be decided (pending).** No licence has been chosen yet, so no permission to
reuse the code is granted beyond what GitHub's Terms of Service give anyone who
can see a public repository. Third-party components keep their own licences; see
[`NOTICE`](NOTICE).

---

## 繁體中文摘要

Open_Mouse 用手機拍一張手部照片，量出手的尺寸，再和 Logitech 滑鼠型錄裡各型號的公開尺寸比對，
給出適合度排名，並用白話說明原因。它只提供購買時的適合度估計，不是醫療或健康工具，不做任何診斷或治療宣稱。

- **狀態：早期預覽，尚未公開。** 網站已部署，但標了 `noindex`，沒有對外宣傳。手部量測仍在驗證中，適合度權重也是暫定值，請不要當成已驗證的結果。
- **主流程：** 把手平放在深色桌面上的一張空白 A4 或 Letter 紙上，手機從上方拍，即時相機鎖定四個紙邊後自動拍照，以紙張的已知尺寸當尺。
- **印刷紙流程：** 舊的校正流程（`/sheet`、`/scan`；要印 6 個標記），仍可使用；是否保留尚未決定。目前主要用來對照空白紙流程的量測結果。
- **無紙輸入手長：** 仍要拍照，只是把你用尺量到的手長輸入，取代紙張當比例尺；有旗標 `NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY`，預設關閉。這個模式送出的 calibration 是 `user-length`，含 `referenceMm`（你輸入的手長）。
- **隱私：** 照片只在瀏覽器裡處理，不會上傳，伺服器只收到毫米數值。沒有帳號的掃描會自動過期，過期後就讀不到（讀取端把它當成不存在）；過期資料何時從資料庫實體刪除、備份保留多久（Neon 時間點還原 PITR 的保留期尚未確認），會在隱私條款中說明，而隱私條款尚未撰寫。也可以隨時在結果頁按「Delete this scan now」立即刪除。登入（Google OAuth，第三方）在正式站目前關閉；若開啟，會存姓名、Email 與是否驗證、頭像、Google 帳號 ID，以及 OAuth token 與相關欄位（scope、session_state）和登入 session。文字說明由 Google 的 Gemini API 根據量測值與分數寫成，不會送出照片。
- **授權：** 尚未決定（待定）。第三方元件的授權見 [`NOTICE`](NOTICE)。
- **開發：** Node.js 24 與 npm。`npm ci`、`npm run dev`；檢查用 `npm run typecheck`、`lint`、`format:check`、`test`、`db:check`、`test:e2e`。細節見上方英文段落與 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
