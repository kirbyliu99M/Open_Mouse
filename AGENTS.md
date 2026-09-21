# AGENTS.md — Working Agreement

**Read this before every task. Read `docs/STATUS.md` next — it is the live state of the project.**

Open_Mouse measures a user's hand from guided photos, scores mice against those
measurements, renders a 3D simulation, and has Gemini write the analysis.
Full design: `docs/PLAN.md`.

## Roles

_Revised 2026-09-21 (second revision): Codex narrowed to Blender for cost; builders are Sonnet subagents dispatched by Claude._

| Agent | Owns | Never does |
|---|---|---|
| **Claude** — orchestrator | Plan, milestone specs, `src/lib/contracts/`, shape rubric, dispatching builders, reviewing their output, gate adjudication, `docs/STATUS.md` | Approves a PR it authored directly |
| **Sonnet builder subagents** | Backend and frontend implementation, one scoped task each, **each in its own git worktree** | Changes a contract; touches files outside its task; merges |
| **Sonnet reviewer subagent** | Independent review of every PR against its acceptance criteria and the hard rules | Reviews code it wrote |
| **Codex** — Blender only | M4a: `tools/blender/` shell and hand generation, GLB export, Blender MCP work | Anything outside `tools/blender/` and its generated assets |
| **Kirby** | Ground-truth photos, rubric spot-checks, silhouette review, dashboards, secrets, **merges**, final acceptance | — |

### Directory ownership

| Path | Owner |
|---|---|
| `src/lib/contracts/` | Claude only. The seam every builder codes against |
| `tools/blender/`, generated `public/models/**` | Codex |
| Everything else | Whichever builder subagent Claude assigns, scoped per task |
| `docs/STATUS.md` | Claude updates after each task lands |

### How a builder task runs

1. Claude writes a self-contained brief: goal, files in scope, contract to code
   against, acceptance criteria, non-goals.
2. The builder works in an isolated worktree on its own branch, keeps CI-equivalent
   checks green locally (typecheck, lint, prettier, vitest, drizzle check), pushes,
   and opens a PR.
3. A reviewer subagent that did not write the code reviews it; Claude adjudicates
   the findings; Kirby merges.

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

- **Branches:** `m<N>-<slug>` (e.g. `m0-scaffold`, `m2-calibration`).
- **PRs:** reference the milestone issue, state gate evidence, keep to one
  milestone *and one side of the seam*. CI green *and* Vercel preview live before
  requesting review. A milestone that spans both sides (M2, M6) is two PRs.
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
- [ ] **`docs/STATUS.md` updated** — milestone row, decisions, blockers
- [ ] No licensed data anywhere in the diff or in `git log -p`
