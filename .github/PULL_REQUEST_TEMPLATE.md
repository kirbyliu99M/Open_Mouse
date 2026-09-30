<!--
Open it as a DRAFT. You can push work in progress to it: CI does not run on
draft pull requests. Run the checks below on your machine before you ask for
review. A maintainer marks it ready after review; do not mark it ready yourself.
-->

## What and why

<!-- One or two sentences. Link the milestone issue: Closes #... or Refs #... -->

## Acceptance criteria

<!-- Copy the criteria from the milestone issue. Tick a box only when it is met. -->

- [ ]
- [ ]

## Evidence

<!-- Numbers, not adjectives. Post the measured values. -->

| Check                                                        | Result                          |
| ------------------------------------------------------------ | ------------------------------- |
| `npm run typecheck`, `lint`, `format:check`                  |                                 |
| `npm run test`                                               | files passed / tests passed     |
| `npm run test:e2e` (all Playwright projects)                 | passed / skipped / failed       |
| `npm run db:check`, and no drift after `npm run db:generate` |                                 |
| `npm audit --omit=dev`                                       | vulnerabilities found           |
| `npm run vercel-build`                                       | passed / failed                 |
| Gate evidence (only if this PR is gated by `docs/PLAN.md`)   | measured value against the gate |

## Hard rules

- [ ] No licensed data in the diff or in `git log -p`.
- [ ] The language model never computes: every number a user sees comes from tested TypeScript, and the no-new-numerals test is untouched.
- [ ] Critical-path logic is pure and has unit tests.
- [ ] Gate evidence is measured numbers, and no gate was changed to make this pass.
- [ ] Photos never leave the browser: no image is sent to any server.

## Also

- [ ] One milestone, and one side of the frontend/backend seam.
- [ ] `src/lib/contracts/` is not touched (contract changes get a PR of their own).
- [ ] Migrations are additive and seeds idempotent (or there is no schema change).
- [ ] No secrets or credentials in the diff. No photos or personal data in the description, screenshots or fixtures.
- [ ] `docs/STATUS.md` is not edited in this PR: the orchestrator updates it after the merge (see `AGENTS.md`). Put anything it should record in this description.

## User interface changes (delete this section if there are none)

- [ ] Follows the review checklist in `docs/design-guidelines.md`: feedback on press, errors name the problem and the fix, wayfinding, reduced-motion and contrast variants, and no internal vocabulary in user-facing text.
- [ ] Every user-visible sentence added or changed is listed below, old text and new text, for the owner to confirm.

<!-- | Where | Old | New | -->
