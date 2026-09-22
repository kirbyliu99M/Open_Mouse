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

**Nothing beyond #3 has been merged.** `gh pr merge` is blocked by the Claude Code
permission classifier (`Merge Without Review`) because the reviewer approvals live in
session context, not as review objects on the PRs. Grant a Bash rule for `gh pr merge`
in `.claude/settings.json` and the cascade can run start to finish.

All five stale branches were test-merged against their bases on 2026-09-22: **#5 #8 #9
#12 #18 merge cleanly**, missing only `.gitignore` and `README.md` from their bases.

| PR                 | State                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| #3 m0-scaffold     | ✅ merged to main (`f5d9814`)                                                                     |
| #4 m1-data-layer   | base `main`, CI + Vercel green, `MERGEABLE`/`CLEAN`. **First in the cascade**                     |
| #5 m1-seed         | reviewed; retarget to `main` after #4, then merge                                                 |
| #6 contracts-v1    | CI was red on a Prettier warning in `docs/STATUS.md`; fixed (`6c17104`), now fully green          |
| #8, #9, #12        | reviewed; retarget to `main` after their parent merges                                            |
| #18 scan API       | review fix `19263aa`; ready after #6                                                              |
| #19 photo pipeline | out of draft, body rewritten with evidence (200 tests, full green `pull_request` run). Vercel red |
| #20 analysis       | ⚠️ **changes requested** on re-review — two confirmed hard-rule-2 bypasses; builder fixing them   |
| #21 fit engine     | reviewer approved. Hybrid left-hand exclusion accepted as intended                                |
| #22 results UI     | clean                                                                                             |
| #23 parallax       | approved; EXIF LONG fix landed (`fd0fa64`). Merge after its parent #9                             |
| #24 M6 auth        | reviewed: **approve with nits** (three LOW, all optional). Nits not applied — see below           |

### Open nits on #24, for a builder (not for the orchestrator to write)

1. `/api/account/scans` returns personal measurement data with no `Cache-Control: no-store`;
   the shared `json()` helper in `src/server/account/handlers.ts:4` sets only `content-type`,
   so one line there covers GET and DELETE.
2. `isAuthConfigured()` ignores `DATABASE_URL`, so a creds-but-no-DB deployment shows a
   sign-in button that throws on click. Not reachable in this deployment.
3. `src/app/layout.tsx` calls `auth()` on every request app-wide, forcing every route dynamic.

Adjudication: do 1, leave 2 and 3.

Production migrate + seed has **not** been run yet. Do it once #4/#5 are merged
(`npm run db:migrate`, `npm run db:seed`, with production env via `vercel.cmd env pull`
into an ignored file; never print credentials).

## Blockers: Kirby

0. **Permission grant for `gh pr merge`** — the whole cascade waits on this.
1. Neon two-branch setup: delete old preview branches, create `preview` from `main`,
   turn off per-deployment preview branching in the Vercel↔Neon integration, and point
   Preview-scope DB env vars at `preview`. Then redeploy #19 #21 #22 #23.
   Re-confirmed 2026-09-22: a fresh redeploy of #19 fails with `Resource provisioning
failed`, so this is still live, not a stale error.
2. Codex's Blender tooling is uncommitted in the main checkout (`tools/`, `public/`
   on `m4-asset-foundation`).
3. Gemini key (M1 gate), hand photos in `../Fixtures/hands/`, owned mice, Google
   OAuth creds, preview-protection decision.

## Next wave after merges

Integration: scan → fit → results → analysis end to end, with routes and the
analysis cache table.
