# AGENTS.md — Working Agreement

**Read this before every task. Read `docs/STATUS.md` next — it is the live state of the project.**

Open_Mouse measures a user's hand from guided photos, scores mice against those
measurements, renders a 3D simulation, and has Gemini write the analysis.
Full design: `docs/PLAN.md`.

## Roles

_Revised 2026-09-21 (second revision): Codex narrowed to Blender for cost; builders are Sonnet subagents dispatched by Claude. Revised 2026-09-30: reviews run as the `pr-review` workflow, at most five agents at once, STATUS is Claude's alone._

| Agent | Owns | Never does |
|---|---|---|
| **Claude** — orchestrator | Plan, milestone specs, `src/lib/contracts/`, shape rubric, dispatching builders, reviewing their output, gate adjudication, `docs/STATUS.md`, **merging reviewed PRs into `main`** and running production migrate + seed after schema changes | Approves a PR it authored directly; merges a PR without an independent reviewer's approval |
| **Sonnet builder subagents** | Backend and frontend implementation, one scoped task each, **each in its own git worktree** | Changes a contract; touches files outside its task; merges |
| **Reviewers — `pr-review` workflow** | Independent review of every PR against its acceptance criteria and the hard rules: three Sonnet lenses in parallel, then a refuter for each of the six most severe findings (the rest reach Claude unverified). The script is Claude's local tooling, outside this repo; Claude adjudicates what survives | Reviews code it wrote |
| **Codex** — Blender, plus tasks Claude assigns (2026-09-23) | M4a: `tools/blender/` shell and hand generation, GLB export, Blender MCP work | Pushes (Claude runs git); edits `docs/STATUS.md` or `.github/` |
| **Kirby** | Ground-truth photos, rubric spot-checks, silhouette review, dashboards, secrets, final acceptance | — |

### Directory ownership

| Path | Owner |
|---|---|
| `src/lib/contracts/` | Claude only. The seam every builder codes against |
| `tools/blender/`, generated `public/models/**` | Codex |
| Everything else | Whichever builder subagent Claude assigns, scoped per task |
| `docs/STATUS.md` | **Claude only**, updated after merges through small docs-only PRs. Builders and Codex never edit it — parallel branches kept colliding here |

### How a builder task runs

1. Claude writes a self-contained brief: goal, files in scope, contract to code
   against, acceptance criteria, non-goals.
2. The builder works in an isolated worktree on its own branch and opens the PR
   as a **draft**. It keeps CI-equivalent checks green locally (typecheck, lint,
   prettier, vitest, drizzle check, and every Playwright project). Pushing work in
   progress to the draft is fine and, once #78 is merged, costs no CI minutes; the
   builder never marks the PR ready.
3. The `pr-review` workflow reviews it (agents that did not write the code), and
   Claude adjudicates the findings. Claude then marks the PR ready. That triggers
   CI once, and Claude confirms the run actually executed: a skipped job also
   reports success. Never put `[skip ci]` on a PR's HEAD commit: that PR's
   run never starts. Once findings are resolved and CI is green, Claude merges the
   PR into `main` (merge commit, stack order, retargeting the next PR to `main`).
   _Kirby's call, 2026-09-22: merge per PR once reviewed, don't let the stack pile up._

**Neon has exactly two branches: `main` (production) and `preview` (shared by every
PR preview).** Previews migrate and seed the shared `preview` branch. Seeds must stay
idempotent and migrations additive. If the preview schema drifts (two open PRs add
conflicting migrations), reset `preview` from `main` in the Neon console and
redeploy. Never create per-PR Neon branches: the Free plan caps branches at 10.

**At most five agents run at once** (Kirby, 2026-09-30): two builders plus up to three
workflow agents. A workflow caps its own concurrency with an in-script pool of three
and uses at most ten agents per run. Codex and AGY (the Gemini CLI, used only for web
searches) are external CLIs and do not count.

**GitHub Actions minutes are budgeted** (Kirby, 2026-09-30). Once #78 is merged, CI runs
on pushes to `main` and on PRs that are not drafts, so pushing to a feature branch or a
draft costs nothing. Until then, `main`'s old `ci.yml` runs on every push and every PR.
Live e2e against production runs locally (`BASE_URL=… npm run test:e2e:live`) rather
than through `live-e2e.yml`.
Do not add scheduled workflows without Claude's sign-off.

**Commit and push work in progress after each meaningful step** (a draft PR is fine early). Builders can be stopped mid-task by usage limits; anything uncommitted is at risk and pushed work resumes cleanly.

**Each worktree runs its own `npm ci`. Never link or share `node_modules`** — every `npm install` reconciles the whole folder against *its* branch's lockfile, so a shared folder is silently rewritten by whichever agent installs last.

**Separate working trees are mandatory.** Two agents in one checkout already
caused one agent's uncommitted work to be committed by another.

## The five hard rules

1. **Never commit licensed data.** The EloShapes CSV lives *outside* this repo
   (`../Dataset/`) and is gitignored twice over. It is a private validation
   fixture only. Never copy it in, never paste rows into code, tests, or docs,
   never let its editorial values reach a seed file. If you need it, read it
   from `../Dataset/` at runtime in a script that never runs in CI.

2. **The LLM never computes.** Every number a user sees originates in tested
   TypeScript. Gemini receives finished values and writes prose about them.
   There is a test asserting no numeral appears in model output that was not in
   the input — do not weaken it.

3. **Critical-path logic is pure and tested.** Homography, landmark→mm
   extraction, the six scorers, and shell parameter generation are pure
   functions. A pure function on the critical path without a unit test is not
   done.

4. **Gates are hard stops, and evidence is numbers.** M1, M2, and M4 have
   numeric gates in `docs/PLAN.md`. Post actual measured values in the PR. "Looks
   good" is not evidence. If a gate fails, the *implementation or rubric* gets
   revised — never the gate. Raise it with Claude instead.

5. **Photos never leave the browser.** MediaPipe and ArUco run client-side via
   WASM. Only derived millimetre values are POSTed. Any change that sends an
   image to a server breaks a promise made in the UI — stop and raise it.

## Conventions

- **UI/UX:** every frontend change follows `docs/design-guidelines.md` (Apple-derived; includes a review checklist).

- **Branches:** `m<N>-<slug>` (e.g. `m0-scaffold`, `m2-calibration`).
- **PRs:** reference the milestone issue, state gate evidence, keep to one
  milestone *and one side of the seam*. Review runs on the draft; CI runs once Claude marks it
  ready, and a PR merges only with that run green *and* the Vercel preview live. A milestone that spans both sides (M2, M6) is two PRs.
- **TypeScript:** strict. No `any` on the critical path.
- **DB:** Drizzle with `@neondatabase/serverless` HTTP driver.
  **Never `pg.Pool`** — connections are not reused between serverless invocations.
- **Secrets:** server-side only. `GEMINI_API_KEY` must never reach the client
  bundle. All Gemini calls go through route handlers.
- **Blender:** `bpy` 5.2.2, Python 3.13 only. Keep it out of the default CI job
  (340 MB wheel); generation runs on `workflow_dispatch`.

## Definition of done

- [ ] Acceptance criteria in the milestone issue all met
- [ ] Unit tests for every new pure function
- [ ] CI green; Vercel preview deploys
- [ ] Gate evidence posted as numbers (gated milestones)
- [ ] **`docs/STATUS.md` updated by Claude after the merge** — milestone row, decisions, blockers (builders report these in the PR description instead)
- [ ] No licensed data anywhere in the diff or in `git log -p`
