# AGENTS.md — Working Agreement

**Read this before every task. Read `docs/STATUS.md` next — it is the live state of the project.**

Open_Mouse measures a user's hand from guided photos, scores mice against those
measurements, renders a 3D simulation, and has Gemini write the analysis.
Full design: `docs/PLAN.md`.

## Roles

| Agent | Owns | Never does |
|---|---|---|
| **Claude** | Plan, milestone specs, acceptance criteria, shape rubric, scoring design, Gemini prompts, PR review, gate adjudication | Writes feature code |
| **Codex** | All feature code, tests, Blender scripts, docs updates | Merges its own PR; starts a milestone before the previous gate passes |
| **Kirby** | Ground-truth photos, rubric spot-checks, silhouette review, secrets, final acceptance | — |

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
  milestone. CI green *and* Vercel preview live before requesting review.
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
