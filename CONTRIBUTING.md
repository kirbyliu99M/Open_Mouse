# Contributing to Open_Mouse

Open_Mouse is an early-preview, volunteer-run project. It is built with the help
of AI coding agents, which follow [`AGENTS.md`](AGENTS.md); people are welcome to
work under the same rules. Read [`docs/STATUS.md`](docs/STATUS.md) for what is in
flight before you start, and open an issue or ask first for anything larger than a
small fix.

- Found a bug? Use the bug report template. A measurement that looks wrong has its
  own template (numbers only, see below).
- Found a vulnerability? Do not open an issue. Follow [`SECURITY.md`](SECURITY.md).

## The five hard rules

The full text, with reasons, is in [`AGENTS.md`](AGENTS.md). A change that breaks
one of them will not be merged.

1. **Never commit licensed data.** The licensed reference CSV lives outside the
   repository (`../Dataset/`) and is gitignored. Never copy it in, paste rows of
   it into code, tests, docs or an issue, or let its values reach a seed file. It
   must never appear in `git log -p` either.
2. **The language model never computes.** Every number a user sees comes from
   tested TypeScript. Gemini receives finished values and writes prose about them.
   A test checks that no numeral appears in the model's output that was not in its
   input; do not weaken it.
3. **Critical-path logic is pure and tested.** Homography, landmark to millimetre
   extraction, the six scorers and shell parameter generation are pure functions,
   and a pure function on that path without a unit test is not done.
4. **Gates are hard stops, and evidence is numbers.** Where `docs/PLAN.md` sets a
   numeric gate, post the measured values in the pull request ("looks good" is not
   evidence). If a gate fails, revise the implementation, never the gate.
5. **Photos never leave the browser.** MediaPipe and the paper and marker detection
   run on the device; only derived millimetre values are sent. A change that sends
   an image to a server breaks a promise made in the UI: stop and raise it.

Also: TypeScript stays strict, with no `any` on the critical path; the database
client is Drizzle over Neon's HTTP driver (never `pg.Pool`); secrets stay on the
server; and user interface changes follow
[`docs/design-guidelines.md`](docs/design-guidelines.md), including its review
checklist.

## Data and privacy in issues and pull requests

Issues and pull requests are public and permanent.

- Do not attach or link photos of a hand, or of a person.
- Do not post names, email addresses, phone numbers, addresses or other personal
  data, yours or anyone else's.
- For a wrong measurement, post only the numbers and the device model, and only
  your own. Hand measurements are personal data too.
- Never paste credentials, connection strings or tokens. If one leaks, treat it as
  compromised and tell a maintainer.

## Setting up

Use Node.js 24 and npm. `README.md` has the commands; in short:

```sh
npm ci
npm run dev
```

**Each working tree runs its own `npm ci`.** Never link or share `node_modules`
between checkouts or worktrees: every install reconciles the folder against its own
branch's lockfile, so a shared folder is silently rewritten by whichever checkout
installs last.

## Checks to run before you ask for review

CI runs the whole gate (`.github/workflows/ci.yml`) once, when a maintainer marks
the pull request ready. Run the same checks locally first; all of them must pass:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run db:check
npm run db:generate && git status --porcelain -- drizzle   # must print nothing
npm audit --omit=dev
npm run test:e2e             # every Playwright project
npm run vercel-build         # outside a Vercel preview it skips the database steps, then runs `next build`
```

If you touched `src/db/schema.ts`, commit the generated migration and metadata
under `drizzle/` (see the Database section of `README.md`). Do not use schema push.

## Pull requests

CI minutes are limited: CI runs on pushes to `main` and on pull requests that are
not drafts, and nowhere else. A push to a feature branch or to a draft pull
request costs nothing.

1. Branch from `main`. Branch names look like `m2-calibration` or `fix-handedness`.
   A branch created before #78 (the CI budget change) must merge `main` in before
   its first push: a push runs the `ci.yml` of the pushed commit.
2. **Open the pull request as a draft**, and keep it a draft. You can push work in
   progress to it at any time; commit and push after each meaningful step.
3. Fill in the pull request template: acceptance criteria, evidence as numbers, the
   hard-rules checklist and every user-visible sentence you added or changed. Run
   the checks above before you ask for review.
4. **A maintainer marks the pull request ready, after review; you do not mark it
   ready yourself.** A reviewer who did not write the change checks it against its
   acceptance criteria and the hard rules. Marking it ready runs CI once, and the
   pull request is merged only with that run green and the Vercel preview live.

Keep a pull request to one milestone and one side of the frontend/backend seam. Do
not edit `src/lib/contracts/` in a feature pull request: changes to the shared
contracts get a pull request of their own.

## Licence

No licence has been chosen for this project yet (see `README.md`). Do not assume
one; if you want to contribute code, ask first. Third-party licences are listed in
[`NOTICE`](NOTICE).
