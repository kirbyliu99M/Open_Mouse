# Handoff: orchestrator session → next Claude account

2026-09-22. Read `AGENTS.md`, then `docs/STATUS.md`, then this file. Claude is the
orchestrator. Builders and reviewers are Sonnet subagents, each in its own worktree
under `Open_Mouse/.claude/worktrees/`. `git worktree list` maps each branch to its path.
Codex owns only `tools/blender/`.

## New rules from Kirby (already in AGENTS.md)

- **Claude merges PRs into `main`** once an independent reviewer approves and CI is
  green. Use merge commits, stack order, and retarget the next PR's base to `main`
  before merging it. After schema changes, run production migrate + seed.
- **Neon keeps two branches only: `main` + `preview`** (shared by all previews).
  The 10-branch Free cap is what broke previews on #19 #21 #22 #23.

## Merge progress (stack order)

| PR                                         | State                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| #3 m0-scaffold                             | ✅ merged to main (`f5d9814`)                                                                                           |
| #4 m1-data-layer                           | retargeted to `main`, marked ready. Main was merged in (STATUS conflict: kept branch side). **Merge once CI re-passes** |
| #5 m1-seed → #6 contracts-v1 → #8, #9, #12 | reviewed; retarget each to `main` after its parent merges, then merge. #6 also carries AGENTS.md/STATUS/this file       |
| #18 scan API                               | review fix pushed (`19263aa`); ready after #6                                                                           |
| #19 photo pipeline                         | reviewer approved; **update the stale PR body + mark ready**                                                            |
| #21 fit engine                             | reviewer approved. Hybrid left-hand exclusion accepted as intended                                                      |
| #22 results UI                             | clean                                                                                                                   |
| #23 parallax                               | approved; EXIF LONG pixel-dimension fix in flight (Sonnet), then merge                                                  |
| #20 analysis                               | numeral-check fixes in flight (Sonnet): number words, Unicode digits, %, `server-only`. **Needs re-review**             |
| #24 M6 auth                                | new, base `m2-scan-api`. **Needs independent review**                                                                   |

In-flight agents from the old session push to their own branches. Check
`git log origin/m5-analysis` and `git log origin/m2-parallax` for their commits. If
nothing has landed, re-dispatch from the PR review comments.

Production migrate + seed has **not** been run yet. Do it once #4/#5 are merged
(`npm run db:migrate`, `npm run db:seed`, with production env via `vercel.cmd env pull`
into an ignored file; never print credentials).

## Blockers: Kirby

1. Neon two-branch setup: delete old preview branches, create `preview` from `main`,
   turn off per-deployment preview branching in the Vercel↔Neon integration, and point
   Preview-scope DB env vars at `preview`. Then redeploy #19 #21 #22 #23.
2. Codex's Blender tooling is uncommitted in the main checkout (`tools/`, `public/`
   on `m4-asset-foundation`).
3. Gemini key (M1 gate), hand photos in `../Fixtures/hands/`, owned mice, Google
   OAuth creds, preview-protection decision.

## Next wave after merges

Integration: scan → fit → results → analysis end to end, with routes and the
analysis cache table.
